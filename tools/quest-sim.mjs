// QL-T2 (architecture 38.44 item 11): headless quest simulator. Runs every quest of the real content through the real
// questBook on a fake world: talk -> accept -> feed the facts each objective needs -> hand in -> reward.
// Usage: node tools/quest-sim.mjs [--json]    (exit 1 when any quest FAILs)
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createQuestBook, AVAILABLE, READY, DONE, ACTIVE, STATUS_NAMES } from '../game/js/quest/sim/questBook.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from './validate-content.mjs';

/** Facts (events) one objective needs. World data is consulted for pickups, beasts and areas: a missing target is a FAIL. */
function factsFor(o, w, packOps) {
  const t = o.when;
  if (t.type === 'flag') return [{ type: 'flag:set', key: t.id, value: t.equals }];
  if (t.type === 'item') return [{ type: 'item:got', id: t.id }];
  if (t.type === 'area') {
    if (!w.areas.has(t.id)) throw new Error(`area "${t.id}" not defined`);
    return [{ type: 'area:entered', id: t.id }];
  }
  if (t.type === 'beasts') {
    for (const id of t.ids) if (!w.beasts.has(id)) throw new Error(`beast "${id}" not in world`);
    return t.ids.slice(0, t.count).map(id => ({ type: 'beast:died', id }));
  }
  if (t.type === 'collect' || t.type === 'deliver') {
    if (t.type === 'collect' && (w.pickups.get(t.id) || 0) < t.count) throw new Error(`needs ${t.count} "${t.id}" but ${w.pickups.get(t.id) || 0} placed`);
    if (t.type === 'deliver' && !w.actors.has(t.to)) throw new Error(`hand-in "${t.to}" not in world`);
    if (t.type === 'collect') packOps.add(t.id, t.count);
    return [{ type: 'item:count', id: t.id, n: packOps.count(t.id) }];
  }
  throw new Error('unknown objective type ' + t.type);
}

/** defs = expanded giver/legacy defs (main first or by id `main`), world = {actors,beasts,areas,pickups}. Returns rows + totals. */
export function simulateQuests(defs, world, mainId = 'm1') {
  const mainDef = defs.find(d => d.id === mainId);
  if (!mainDef) throw new Error('main quest "' + mainId + '" not found');
  const givers = defs.filter(d => d !== mainDef);
  let book;
  try { book = createQuestBook(mainDef, givers); }
  catch (e) { return { rows: [{ id: '(book)', title: '', steps: 0, ok: false, reason: e.message }], totals: { rewards: {}, hearts: 0 } }; }
  const pack = new Map();
  const packOps = book.packOps = {
    count: id => pack.get(id) || 0,
    add: (id, n) => { pack.set(id, (pack.get(id) || 0) + n); return n; },
    remove: (id, n) => { pack.set(id, Math.max(0, (pack.get(id) || 0) - n)); },
    equipped: () => true,
  };
  const rows = [], done = new Set(), totals = { rewards: {}, hearts: 0 };
  const row = (def, steps) => ({ id: def.id, title: def.title || '', steps, ok: false, reason: '' });
  // main quest: feed objectives in order as far as they can go (flags named quest.<id>.done come from a hand-in only)
  const pumpMain = () => {
    const st = book.questState(0);
    let moved = false;
    for (let i = st.completed.length; i < mainDef.objectives.length; i++) {
      const o = mainDef.objectives[i];
      if (o.when.type === 'flag' && /^quest\..*\.done$/.test(o.when.id) && !book.questState(0).flags[o.when.id]) break;
      try { for (const e of factsFor(o, world, packOps)) book.feed(e); } catch (e) { break; }
      moved = true;
    }
    // fake-world rule: Burl's escort (burl.arrived) ends with her back home (burl.home, burl.home.met), see burlEscort.js
    if (book.questState(0).flags['burl.arrived']) for (const key of ['burl.home', 'burl.home.met']) book.feed({ type: 'flag:set', key, value: true });
    return moved;
  };
  const runQuest = (def) => {
    const r = row(def, def.objectives.length);
    try {
      for (const q of def.requires || []) if (q.flag) book.feed({ type: 'flag:set', key: q.flag, value: true });
      const auto = !def.giver;
      if (!auto) {
        if (book.statusOf(def.id) !== AVAILABLE) throw new Error('not available, status ' + STATUS_NAMES[book.statusOf(def.id)]);
        if (!book.accept(def.id)) throw new Error('accept refused');
      } else if (book.statusOf(def.id) !== ACTIVE && book.statusOf(def.id) !== DONE) throw new Error('giverless quest not active, status ' + STATUS_NAMES[book.statusOf(def.id)]);
      for (const g of def.requireItem ? [def.requireItem] : []) { packOps.add(g, 1); book.feed({ type: 'item:got', id: g }); }
      for (const o of def.objectives) for (const e of factsFor(o, world, packOps)) book.feed(e);
      if (auto) {
        if (book.statusOf(def.id) !== DONE) throw new Error('giverless quest did not finish, status ' + STATUS_NAMES[book.statusOf(def.id)]);
      } else {
        if (book.statusOf(def.id) !== READY) throw new Error('not ready after all steps, status ' + STATUS_NAMES[book.statusOf(def.id)] + ' (' + book.questState(book.index(def.id)).completed.length + '/' + def.objectives.length + ' steps)');
        const reward = book.handIn(def.id);
        if (!reward) throw new Error('hand-in refused');
        for (const it of reward.items || []) { packOps.add(it.id, it.n); totals.rewards[it.id] = (totals.rewards[it.id] || 0) + it.n; }
        r.reward = (reward.items || []).map(i => i.id + (i.n > 1 ? 'x' + i.n : '')).join(',');
      }
      r.ok = true;
    } catch (e) { r.reason = e.message; }
    return r;
  };
  pumpMain();
  const pending = new Set(givers.map(d => d.id));
  const byId = new Map(givers.map(d => [d.id, d]));
  for (let progress = true; progress && pending.size;) {
    progress = false;
    for (const id of [...pending]) {
      const def = byId.get(id);
      const st = book.statusOf(id);
      if (st === 0) continue; // not open yet
      pending.delete(id); done.add(id); rows.push(runQuest(def)); progress = true;
      pumpMain();
    }
  }
  for (const id of pending) { const d = byId.get(id); const r = row(d, d.objectives.length); r.reason = 'never opened (status ' + STATUS_NAMES[book.statusOf(id)] + '): ' + JSON.stringify(d.requires || []); rows.push(r); }
  const mr = row(mainDef, mainDef.objectives.length);
  mr.ok = book.questState(0).completed.length === mainDef.objectives.length;
  if (!mr.ok) mr.reason = 'stalled at step "' + mainDef.objectives[book.questState(0).completed.length].id + '"';
  rows.unshift(mr);
  totals.hearts = totals.rewards['heart.piece'] || 0;
  return { rows, totals };
}

export function worldFacts(assets) {
  const w = { actors: new Set(), beasts: new Set(), areas: new Set(), pickups: new Map() };
  for (const world of Object.values(assets.worlds || {})) for (const e of world.entities || []) {
    w.actors.add(e.id);
    if (e.type === 'beast') w.beasts.add(e.id);
    const q = e.components?.questPickup;
    if (q) w.pickups.set(q.item, (w.pickups.get(q.item) || 0) + (q.n || 1));
  }
  for (const lv of Object.values(assets.levels || {})) for (const p of lv?.props || []) w.actors.add(p.id);
  return w;
}

async function main() {
  const json = process.argv.includes('--json');
  const assets = await loadDesignAssets();
  const dir = fileURLToPath(new URL('../content/quests', import.meta.url));
  const files = loadQuestFiles(dir);
  const packs = await loadPackQuests(dir, assets?.items?.defs);
  const errors = [...files.errors, ...packs.errors];
  const w = worldFacts(assets);
  for (const a of Object.keys(files.areas?.areas || {})) w.areas.add(a);
  const defs = [...files.quests, ...packs.quests].map(q => q.def);
  const { rows, totals } = simulateQuests(defs, w);
  if (json) console.log(JSON.stringify({ rows, totals, errors }, null, 1));
  else {
    console.log('id'.padEnd(22) + 'title'.padEnd(26) + 'steps '.padEnd(7) + 'result  reason/reward');
    for (const r of rows) console.log(r.id.padEnd(22) + r.title.slice(0, 24).padEnd(26) + String(r.steps).padEnd(7) + (r.ok ? 'OK      ' : 'FAIL    ') + (r.ok ? r.reward || '' : r.reason));
    const bad = rows.filter(r => !r.ok).length;
    console.log(`${rows.length} quest(s), ${rows.length - bad} OK, ${bad} FAIL; heart pieces ${totals.hearts}; rewards ${JSON.stringify(totals.rewards)}`);
    for (const e of errors) console.error('LOAD ' + e);
  }
  if (errors.length || rows.some(r => !r.ok)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
