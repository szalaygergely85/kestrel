// OB-202 follow-up audit: for EVERY item step (item / collect / deliver) in the real quest content, what does the compass point at
// (a) while gathering and (b) once the item is in the pack? Real quest loading (questBoot), real questBook + compassHud.target + itemSource,
// fake world built from the real placements (content/worlds, content/levels via structures, optional content/local overlay).
// FAIL: gather needle is null or sits on the giver / hand-in character, a step has no entry in content/items/sources.json,
// a {giver:true} source is not backed by giveOnTalk/giveOnAccept, or the have-item needle is not the hand-in.
// Run: node game/js/quest/itemStepTargets.test.js
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadQuestFiles } from '../questBoot.js';
import { loadDesignAssets } from '../../../tools/validate-content.mjs';
import { createCompassHud, FALLBACK_COMPASS_STYLE } from '../ui/compassHud.js';
import { resolveItemSource } from '../ui/itemSource.js';
import { createQuestBook, READY } from './sim/questBook.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const rd = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const assets = await loadDesignAssets();
const items = Object.values(assets.items?.defs || {}).map((d) => ({ id: d.id, slot: d.equip && d.equip.slot, tier: d.equip && d.equip.tier }));
const qb = await loadQuestFiles((u) => Promise.resolve(rd(u.replace(/^(\.\.\/)+/, ''))), { wantBarks: false, log: () => {}, items });
assert.ok(qb.questDef && qb.giverDefs, 'quest files load');
const sources = qb.itemSources;
assert.ok(sources && Object.keys(sources).length, 'content/items/sources.json loads through loadQuestFiles');
const areas = rd('content/quests/areas.json').areas;

// ---- fake world from real placements
const ents = new Map(); // id -> { data: { transform, components } }
const put = (id, e) => ents.set(id, { data: { transform: { x: e.x, y: e.y, z: typeof e.z === 'number' ? e.z : 0 }, components: e.components || {} } });
const world = rd('content/worlds/world_m1.world.json');
for (const e of world.entities || []) put(e.id, e);
for (const st of world.structures || []) { // level props -> '<placementId>.<propId>' at the structure origin
  if (!st.level || !existsSync(ROOT + 'content/levels/' + st.level + '.level.json')) continue;
  const o = st.origin || { x: 0, y: 0 };
  for (const p of rd('content/levels/' + st.level + '.level.json').props || []) put(st.id + '.' + p.id, { x: o.x + p.x, y: o.y + p.y, z: p.z, components: p.questPickup ? { questPickup: p.questPickup } : {} });
}
if (existsSync(ROOT + 'content/local/placements.json')) { // git-ignored overlay: same entity shape if present
  const ov = rd('content/local/placements.json');
  for (const e of Array.isArray(ov) ? ov : ov.entities || []) if (e && e.id && typeof e.x === 'number') put(e.id, e);
}
const trig = new Map((world.triggers || []).map((t) => [t.id, t]));
const sw = { get: (id) => ents.get(id) || null, forEachEntity: (fn) => { for (const [id, e] of ents) fn(e, id); } };
const PLAYER = { x: 1100, y: 1060 };
let book = null;
const areaPos = (a, out) => { const ar = areas[a]; const t = ar && trig.get(ar.trigger || a); if (!t) return false; out.x = t.x; out.y = t.y; out.z = NaN; return true; };
const giverEnt = (id) => sw.get(id === 'noteKeepLight' ? 'tower.noteKeepLight' : book.entityFor(id));
const resolver = { resolve(kind, id, out) {
  let e = null;
  if (kind === 'source') return resolveItemSource(sources, id, sw, PLAYER, out, areaPos);
  if (kind === 'giver') e = giverEnt(id);
  else if (kind === 'item' || kind === 'beast') e = sw.get(id);
  else if (kind === 'area') return areaPos(id, out);
  const t = e && e.data.transform; if (!t) return false; out.x = t.x; out.y = t.y; out.z = t.z; return true;
} };
const posOf = (npc) => { const e = npc && giverEnt(npc); return e ? e.data.transform : null; };
const near = (a, b) => !!a && !!b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;

// ---- audit
const m1stub = { version: 1, id: 'm1', name: 'm1', objectives: [{ id: 'a', text: 'a', when: { type: 'area', id: 'zz' } }] };
const rows = [], fails = [];
const hud = createCompassHud({ style: FALLBACK_COMPASS_STYLE });
const describe = (t, giverP, turnP) => (!t ? 'NONE' : near(t, giverP) ? 'GIVER' : near(t, turnP) ? 'HAND-IN' : t.x.toFixed(0) + ',' + t.y.toFixed(0));
const all = [{ id: 'm1', def: qb.questDef, main: true }, ...qb.giverDefs.map((d) => ({ id: d.id, def: d }))];
for (const q of all) {
  q.def.objectives.forEach((o, i) => {
    const w = o.when; if (!['item', 'collect', 'deliver'].includes(w.type)) return;
    const name = q.id + '#' + i + ' ' + w.type, need = w.count || 1;
    const stub = q.main ? { ...q.def, objectives: [o] } : { ...q.def, requires: undefined, objectives: [o] };
    book = q.main ? createQuestBook(stub, []) : createQuestBook(m1stub, [stub]);
    const qi = q.main ? 0 : 1;
    if (!q.main) { book.accept(q.id); book.track(q.id); }
    const g = q.def.giver || {}, giverP = posOf(g.npc), turnP = posOf(g.turnIn || g.npc);
    const given = [].concat(q.def.giveOnTalk || [], q.def.giveOnAccept || []).some((x) => x.id === w.id && x.n >= need);
    const src = sources[w.id];
    let gather;
    if (!src) { fails.push(name + ': item ' + w.id + ' has no entry in content/items/sources.json'); gather = 'NO SOURCE'; }
    else if (src.giver && !given) { fails.push(name + ': source says giver but the quest gives no ' + w.id); gather = 'NO SOURCE'; }
    else if (given) gather = 'given on accept';
    else {
      const t = hud.target(book, resolver);
      gather = describe(t, giverP, turnP);
      if (!t) fails.push(name + ': no needle while gathering ' + w.id + ' (source ' + JSON.stringify(src) + ' resolves nowhere in the world)');
      else if (near(t, giverP) || near(t, turnP)) fails.push(name + ': gather needle is on the giver/hand-in for ' + w.id);
    }
    book.feed(w.type === 'item' ? { type: 'item:got', id: w.id } : { type: 'item:count', id: w.id, n: need });
    let have;
    if (q.main) have = book.questState(qi).completed.length >= stub.objectives.length ? 'step done' : 'NOT DONE';
    else {
      const t = hud.target(book, resolver);
      have = book.status(qi) === READY ? describe(t, giverP, turnP) : 'NOT READY';
      if (book.status(qi) !== READY || !near(t, turnP)) fails.push(name + ': with ' + w.id + ' in the pack the needle is ' + have + ', want the hand-in');
    }
    rows.push([q.id, w.id + (need > 1 ? ' x' + need : ''), w.type, gather, have]);
  });
}
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('quest', 18) + pad('item', 16) + pad('type', 8) + pad('gather target', 20) + 'have-item target');
for (const r of rows) console.log(pad(r[0], 18) + pad(r[1], 16) + pad(r[2], 8) + pad(r[3], 20) + r[4]);
assert.ok(rows.length >= 21, 'audited ' + rows.length + ' item steps');
assert.deepEqual(fails, [], 'item step audit failures:\n  ' + fails.join('\n  '));
console.log('itemStepTargets: ok (' + rows.length + ' item steps)');
