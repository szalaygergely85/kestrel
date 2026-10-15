// CONTENT-LINT-01: every owner-bug content rule of 2026-10-14 in one command.
// Run: node tools/content-lint.mjs [--json] [--strict] [--scatter] [--only R1,R5] [--no-warn]
//   one line per finding `RULE id (x,y): message`; exit 1 on any ERROR finding (--strict: warnings fail too).
//   --scatter also checks the generated scatter trees (R1, slow: bakes every band, ~1 min).
// Rules are pure functions over a context object (see buildContext) so tools/content-lint.test.mjs can feed fixtures.
// Levels: R8 R9 R10 are 'warn' (design judgement), all others 'error'. Override with LEVELS below.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export * from './content-lint-rules.js';
import { MAX_FLOAT, GIVER_MAX_UP, GIVER_WALK_R, ENT_MAX_FLOAT, BURY_MIN, BURY_MAX, OBJECT_GIVER_MAX, SMOKE_SRC_R, CHIMNEY_R, CHIMNEY_MIN, CHEST_R, RULES, LEVELS, TITLES, RAW_DOTTED, RAW_CAMEL, rawIn, r5One, r10Quest, r12One, r14Quest, meshTopAt, lint, line } from './content-lint-rules.js';

// ---- real-content context (heavy: loads the world like the existing probes) ----
const root = fileURLToPath(new URL('..', import.meta.url));
const jsonFiles = (dir) => { const o = []; (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (p.endsWith('.json')) o.push(p); } })(dir); return o; };
const SKIP_KEYS = /^(note|_note|id|node|goto|next|requires|when|entities|model|anim|trigger|kind|type|speaker|flag|set|once)$/;
/** Player-facing prose: every string with a space in quests/dialogue/inspect json (keys that are ids/notes skipped). */
export function proseOf(file, json, rel) {
  const out = [];
  (function rec(v, k, p) {
    if (typeof v === 'string') { if (!SKIP_KEYS.test(k) && v.includes(' ')) out.push({ where: rel + p, text: v }); }
    else if (Array.isArray(v)) v.forEach((x, i) => rec(x, k, p + '[' + i + ']'));
    else if (v && typeof v === 'object') for (const kk in v) rec(v[kk], kk, p + '.' + kk);
  })(json, '', '');
  return out;
}

export async function buildContext(opts = {}) {
  globalThis.window = globalThis.window || globalThis;
  const { World } = await import('../engine/index.js');
  const { BandBakeJob } = await import('../engine/dev.js');
  await import('../design/palette.js'); await import('../design/detail-pass.js'); await import('../design/levels/overworld_far.js'); await import('../design/levels/world_geo.js');
  for (const m of ['lantern', 'lever', 'boulder', 'rubble', 'wreckage', 'relay', 'voxel_props', 'voxel_tower', 'pickups_voxel', 'sword', 'm3_props', 'far_tower', 'ferrum_lights', 'voxel_beast', 'voxel_bear']) await import(`../design/models/${m}.js`);
  const { loadTestAssets } = await import('./testing/content-node.mjs');
  const { spawnRegionalBeasts, inPolygon } = await import('../game/js/quest/sim/regionalBeasts.js');
  const { generateFarCamps } = await import('../game/js/life/farCamps.js');
  const { activeCamps } = await import('../game/js/life/goblinCamps.js');
  const { labelOf } = await import('../game/js/quest/errands.js');
  const { floatingProps } = await import('./probe-floating-props.mjs');
  const { loadDesignAssets, loadPackQuests, loadQuestFiles } = await import('./validate-content.mjs');
  const { supportBoxes } = await import('./prop-ground-lint.mjs');
  const G = globalThis.ASSETS.levels.world_geo, T = globalThis.ASSETS.levels.overworld_far;
  G.util.installGeo(T.util);
  // JSON-pack levels/worlds merged into the globals by an earlier loadTestAssets (e.g. validate-content --lint) would trip fromJSON's dual-source check
  const strip = (o, keys) => { const r = { ...(o || {}) }; for (const k of keys) delete r[k]; return r; };
  const names = (dir, ext) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length));
  const pre = { levels: strip(globalThis.ASSETS.levels, names('content/levels', '.level.json')), worlds: strip(globalThis.ASSETS.worlds, names('content/worlds', '.world.json')) };
  Object.assign(globalThis.ASSETS, pre);
  const { assets } = await loadTestAssets();
  const post = { levels: globalThis.ASSETS.levels, worlds: globalThis.ASSETS.worlds };
  (await import('../game/js/quest/index.js')).registerQuestBehaviours();
  const def = assets.world('world_m1');
  const w = World.load(def, assets, { physics: 'grid', events: { on() { return () => {}; }, emit() {} } });
  const quiet = (fn) => { const cw = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = cw; } };
  quiet(() => spawnRegionalBeasts(w, G, 12));
  const gz = (x, y) => { w.ensureBandFor(x, y); return w.terrain.groundAt(x, y); };

  // entities (authored + generated regional beasts) with absolute positions
  const entities = [];
  w.forEachEntity((e) => { const t = e.transform; if (t) entities.push({ id: e.id, x: t.x, y: t.y, z: t.z, components: e.components || {} }); });
  const byId = new Map(entities.map((e) => [e.id, e]));
  const pos = (id) => byId.get(id) || null;
  const characters = new Set(entities.filter((e) => e.components.dialogue).map((e) => e.id));

  // R1: floating placed props (probe-floating-props) + placed trees (probe-floating) + optional scatter
  // prop-ground-lint loads its own assets (the tower/world_m1 JSON merge would collide with ours): hand it the pre-load globals
  Object.assign(globalThis.ASSETS, pre);
  const fp = await floatingProps();
  Object.assign(globalThis.ASSETS, post);
  const floating = fp.map((p) => ({ id: p.id, kind: 'prop', x: p.x, y: p.y, gap: p.float }));
  for (const s of def.structures) {
    if (!s.mesh || !/Tree|Pine/.test(s.mesh) || !s.origin) continue;
    const sc = s.scale || 1, r = 0.74 * sc; let lo = Infinity;
    for (let k = -1; k < 8; k++) { const a = k * Math.PI / 4, h = w.terrain.heightAt(s.origin.x + (k < 0 ? 0 : r * Math.cos(a)), s.origin.y + (k < 0 ? 0 : r * Math.sin(a))); if (h < lo) lo = h; }
    floating.push({ id: s.id, kind: 'tree', x: s.origin.x, y: s.origin.y, gap: +(s.origin.z - 0.24 * sc - lo).toFixed(2) });
  }
  if (opts.scatter) {
    const sp = w.terrain.recipe.recipe.forest.trees.species, bp = def.bounds.pts, util = T.util, seen = new Set();
    for (let cy = -1; cy < 16; cy += 2) for (let cx = -2; cx < 19; cx += 2) {
      if (!inPolygon(bp, cx * 128 + 320, cy * 128 + 192)) continue;
      const job = BandBakeJob.create(w, cx, cy, 5, 3, null); job.step(1e9); const b = job.bundle(), s = b.scatter; if (!s) continue;
      for (let i = 0; i < s.count; i++) {
        const key = s.x[i].toFixed(2) + ',' + s.y[i].toFixed(2); if (seen.has(key)) continue; seen.add(key);
        const r = sp[s.species[i]].trunkR; let lo = Infinity;
        for (let k = -1; k < 8; k++) { const a = k * Math.PI / 4, h = util.gridHeight(b.near, s.x[i] + (k < 0 ? 0 : r * Math.cos(a)), s.y[i] + (k < 0 ? 0 : r * Math.sin(a))); if (h !== null && h < lo) lo = h; }
        if (lo !== Infinity) floating.push({ id: 'scatter@' + key, kind: 'scatter', x: s.x[i], y: s.y[i], gap: +(s.z[i] - lo).toFixed(2) });
      }
    }
  }

  // text: quests (packs + legacy), dialogue, inspect, tower level; JS constants for R4
  const qdir = path.join(root, 'content/quests');
  const packs = await loadPackQuests(qdir, (await loadDesignAssets()).items?.defs);
  const legacy = loadQuestFiles(qdir).quests.map((q) => q.def); // OB-155r: the 10 legacy quests (m1, tower.blade, burl.boars, sq.burl.blue, mq.*) are checked like the packs
  const packIds = new Set(packs.quests.map((q) => q.def.id));
  const quests = [...packs.quests.map((q) => q.def), ...legacy.filter((d) => !packIds.has(d.id))];
  const texts = [];
  for (const q of quests) texts.push(...proseOf(null, { title: q.title, returnText: q.returnText, lines: q.lines, objectives: q.objectives?.map((o) => ({ text: o.text, journal: o.journal })) }, q.id + ' '));
  for (const f of jsonFiles(path.join(root, 'content/dialogue'))) texts.push(...proseOf(f, JSON.parse(fs.readFileSync(f, 'utf8')), path.relative(root, f) + ' '));
  // the tower level json holds designer notes (legend descs) next to player prose: scanned for R4 only (dev: true skips R3)
  { const f = path.join(root, 'content/levels/tower.level.json'); texts.push(...proseOf(f, JSON.parse(fs.readFileSync(f, 'utf8')), path.relative(root, f) + ' ').map((t) => ({ ...t, dev: true }))); }
  const inspect = JSON.parse(fs.readFileSync(path.join(root, 'content/dialogue/inspect.json'), 'utf8'));
  for (const [k, t] of Object.entries(inspect.texts)) { for (const s of [t.title, t.prompt, ...(t.lines || [])]) if (typeof s === 'string') texts.push({ where: 'inspect.json ' + k, text: s }); }
  const jsTexts = [];
  {
    const RW = await import('../game/js/quest/relayWake.js'), WS = await import('../game/js/quest/wire/waystone.js'), { NOTICE_TEXT } = await import('../game/js/ui/noticeText.js');
    const add = (where, s) => { if (typeof s === 'string') jsTexts.push({ where, text: s }); };
    for (const k of ['PROMPT_WAKE', 'PROMPT_TOUCH', 'PROMPT_STONE', 'PROMPT_LOOK', 'HINT_NEED_CRYSTAL', 'HINT_NEED_WAYSTONE', 'HINT_NEED_TALK']) add('relayWake.' + k, RW[k]);
    add('relayWake.HINT_NO_CRYSTAL', RW.HINT_NO_CRYSTAL?.text); (RW.NOTICE || []).forEach((s, i) => add('relayWake.NOTICE' + i, s));
    add('wakeCard', RW.wakeCard('ws_ford', true)); add('wakeCard', RW.wakeCard('x', false));
    for (const [k, v] of Object.entries(WS.RELAY_TITLES)) add('RELAY_TITLES.' + k, v);
    for (const [k, v] of Object.entries(WS.RELAY_WAKE)) add('RELAY_WAKE.' + k, v);
    for (const k of ['RELAY_SAVED', 'TOAST_SAVED', 'TOAST_HEALED']) add('waystone.' + k, WS[k]);
    for (const [k, n] of Object.entries(NOTICE_TEXT)) { add('notice.' + k, n.title); (n.lines || []).forEach((s) => add('notice.' + k, s)); }
    for (const m of fs.readFileSync(path.join(root, 'design/items.js'), 'utf8').matchAll(/\b(name|desc|none): *'([^']*)'/g)) add('items.js ' + m[1], m[2]);
  }

  // R5: dialogue/inspect entities + quest givers/turn-ins that exist as entities
  const giverIds = new Set(entities.filter((e) => e.components.dialogue || e.components.inspect).map((e) => e.id));
  for (const q of quests) for (const id of [q.giver?.npc, q.giver?.turnIn]) if (id && byId.has(id)) giverIds.add(id);
  const walkable = (x, y, z) => { const g0 = gz(x, y); for (let a = 0; a < 360; a += 15) for (const d of [1.2, 2, 2.8]) { if (Math.abs(gz(x + Math.cos(a * Math.PI / 180) * d, y + Math.sin(a * Math.PI / 180) * d) - g0) < 0.3) return true; } return false; };

  // R9: quest targets (positions) + early = band < 5 and no requires on the level-5 flag / a gated quest
  const areas = JSON.parse(fs.readFileSync(path.join(qdir, 'areas.json'), 'utf8')).areas;
  const trig = new Map((def.triggers || []).map((t) => [t.id, t]));
  const LV5 = /level5|lvl5|fireball|burl\.lvl/i, qById = new Map(quests.map((q) => [q.id, q]));
  const gated = (q, seen = new Set()) => {
    if (!q || seen.has(q.id)) return false; seen.add(q.id);
    if ((q.band || 0) >= 5) return true;
    return (q.requires || []).some((r) => (r.flag && LV5.test(r.flag)) || (r.quest && gated(qById.get(r.quest), seen)));
  };
  const posAny = (id) => { const e = pos(id); if (e) return e; const a = areas[id], t = a && trig.get(a.trigger); return t ? { x: t.x, y: t.y } : null; };
  // R14 inputs: pack quests get Accept/Exit from quest-snippets.json (generated text); legacy ones need a hand-written accept flag/choice in a dialogue file
  const dlgRaw = jsonFiles(path.join(root, 'content/dialogue')).map((f) => fs.readFileSync(f, 'utf8')).join(' ');
  const MQ_AUTO = new Set(); // OB-155m: MQ_AUTO removed from errands.js (no auto hand-ins)
  const acceptOf = (q) => !!q.giver?.npc && (packIds.has(q.id) || q.objectGiver ? true : dlgRaw.includes(`s.${q.id}.accept`) || dlgRaw.includes(`"q.${q.id}.accept"`) || new RegExp(String.raw`"(quest|startQuest|accept)"\s*:\s*"` + q.id.replace(/\./g, String.raw`\.`) + '"').test(dlgRaw));
  const qs = quests.map((q) => {
    const ids = new Set([q.giver?.npc, q.giver?.turnIn]);
    for (const o of q.objectives || []) { const wn = o.when || {}; if (wn.type === 'area' || wn.type === 'deliver') ids.add(wn.type === 'area' ? wn.id : wn.to); for (const b of wn.ids || []) ids.add(b); }
    const targets = [...ids].filter(Boolean).map((id) => ({ id, ...(posAny(id) || {}) })).filter((t) => t.x !== undefined);
    return { id: q.id, umbrella: Array.isArray(q.sections) && q.sections.length > 0 && !q.giver, band: q.band, requires: q.requires, giver: q.giver, objectGiver: !!q.objectGiver, accept: acceptOf(q), auto: MQ_AUTO.has(q.id), reward: q.reward, objectives: q.objectives, targets, early: !gated(q) };
  });

  // R8: chests vs enemies (authored + regional herds + goblin camps + far camps), puzzles, givers
  const camps = JSON.parse(fs.readFileSync(path.join(root, 'content/life/goblinCamps.json'), 'utf8'));
  const guards = [];
  for (const e of entities) {
    const b = e.components.brain;
    if (b?.kind === 'beast') guards.push({ x: (b.home || [e.x, e.y])[0], y: (b.home || [e.x, e.y])[1], kind: 'beast' });
    if (/lever|plate|waystone/i.test(e.id) || e.components.waystone) guards.push({ x: e.x, y: e.y, kind: 'puzzle', id: e.id });
    if (e.components.dialogue) guards.push({ x: e.x, y: e.y, kind: 'giver' });
  }
  const far = generateFarCamps({ geo: G, terrain: w.terrain, seed: 12, avoid: guards.map((g) => [g.x, g.y]) });
  for (const c of [...activeCamps(camps), ...far]) guards.push({ x: c.at[0], y: c.at[1], kind: 'camp' });
  for (const q of qs) for (const id of [q.giver?.npc]) { const p = id && pos(id); if (p) guards.push({ x: p.x, y: p.y, kind: 'giver' }); }

  // R12: entity base (z + model bottom x scale) vs ground + coarse AABB tops of placed meshes under 5 footprint samples (like the OB-155 scratch probe)
  const boxes = supportBoxes(def.structures, globalThis.ASSETS.meshes || {});
  const entSupport = entities.filter((e) => e.components.voxel && !e.components.brain).map((e) => {
    const v = e.components.voxel, mdl = globalThis.ASSETS.models?.[v.model]?.voxel, sc = v.scale || 1;
    const base = e.z + (mdl ? -(mdl.anchor?.[2] || 0) * (mdl.cellM || 0.1) * sc : 0);
    let support = -Infinity, above = null;
    for (const [dx, dy] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
      const x = e.x + dx, y = e.y + dy; support = Math.max(support, gz(x, y));
      { const fl = w.floorAt(x, y); if (typeof fl === 'number' && fl <= base + BURY_MAX && fl > support) support = fl; } // level/structure floor (tower interior levels)
      for (const b of boxes) if (b.x0 <= x && b.x1 >= x && b.y0 <= y && b.y1 >= y) {
        const top = meshTopAt(b.mesh, b.s, x, y, b.z1); // exact triangle top under this footprint sample (stairs, bevelled slabs), not the coarse AABB top
        if (top === null) continue;
        if (top <= base + BURY_MIN) support = Math.max(support, top); else if (top <= base + BURY_MAX && dx === 0 && dy === 0) above = Math.max(above ?? 0, top - base);
      }
    }
    return { id: e.id, x: e.x, y: e.y, base, support, floorAbove: above };
  });
  // R13: inspect/quest anchors (inspect.json entity lists, components.inspect / questPickup) with a model or a visible mesh/voxel within 1 m
  const anchorIds = new Set(entities.filter((e) => e.components.inspect || e.components.questPickup).map((e) => e.id));
  for (const t of Object.values(inspect.texts)) for (const id of t.entities || []) anchorIds.add(id);
  const hasModel = (e) => !!(e.components.voxel || e.components.mesh || e.components.sprite);
  const anchors = [...anchorIds].map((id) => byId.get(id)).filter(Boolean).map((e) => ({
    id: e.id, x: e.x, y: e.y, hasModel: hasModel(e),
    nearVisual: (def.structures || []).some((s) => s.origin && Math.hypot(s.origin.x - e.x, s.origin.y - e.y) <= 1) || entities.some((o) => o !== e && hasModel(o) && Math.hypot(o.x - e.x, o.y - e.y) <= 1),
  }));

  // R15 inputs (ED-LOGIC-01d): the real content/logic/*.logic.json files + the real vocab; refs from the world (areas = trigger ids, groups = reserve beasts)
  const logic = await (async () => {
    const { LOGIC_VOCAB } = await import('../game/js/logic/vocab.js');
    const dir = path.join(root, 'content/logic'), blocks = [];
    for (const n of fs.readdirSync(dir).filter((x) => x.endsWith('.logic.json')).sort()) {
      if (/^example./.test(n)) continue; // placeholder ids, not loaded by the game
      for (const b of JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))) blocks.push({ ...b, file: n });
    }
    const props = JSON.parse(fs.readFileSync(path.join(dir, 'props.json'), 'utf8'));
    const tower = JSON.parse(fs.readFileSync(path.join(root, 'content/levels/tower.level.json'), 'utf8'));
    const groups = new Set(entities.filter((e) => e.components.brain && e.components.brain.reserve === true && e.components.brain.group).map((e) => e.components.brain.group));
    const propIds = new Set([...Object.keys(props), ...(tower.props || []).map((p) => 'tower.' + p.id)]);
    const propStates = {}; for (const [id, d] of Object.entries(props)) propStates[id] = new Set(Object.keys(d).filter((k) => k !== 'initial'));
    return { blocks, vocab: LOGIC_VOCAB, propStates, refs: { area: new Set(trig.keys()), quest: new Set(qs.map((q) => q.id)), prop: propIds, group: groups } };
  })();
  // R16 inputs (NAME-LINT): resolved player-facing names (item defs, quest titles, region names, NPC labels), not the keys
  const nameList = [];
  const r16Items = assets.items?.defs || (await loadDesignAssets()).items?.defs || {};
  for (const [id, d] of Object.entries(r16Items)) if (d.name) nameList.push({ where: id, kind: 'item', name: d.name });
  for (const q of quests) if (q.title) nameList.push({ where: q.id, kind: 'quest', name: q.title });
  for (const r of G.regions) if (r.name) nameList.push({ where: r.id, kind: 'region', name: r.name });
  for (const id of characters) { const l = labelOf(id); nameList.push({ where: id, kind: 'npc', name: l.charAt(0).toUpperCase() + l.slice(1) }); }
  return {
    fxModels: new Set(Object.entries(globalThis.ASSETS.models || {}).filter(([, m]) => m && m.fx === true).map(([k]) => k)),
    formatQuests: quests, names: nameList, logic, entSupport, anchors, entities, structures: def.structures, floating, texts, jsTexts, quests: qs, itemDefs: assets.items?.defs || (await loadDesignAssets()).items?.defs,
    labelOf, giverIds, pos, groundAt: gz, walkable, characters, levelIds: new Set((JSON.parse(fs.readFileSync(path.join(root, 'content/levels/tower.level.json'), 'utf8')).props || []).map((p) => p.id)), chests: entities.filter((e) => /^chest/.test(e.id)), guards,
    riverX: (y) => T.util.riverX(y), riverHalf: 10,
  };
}

async function main() {
  const argv = process.argv.slice(2), has = (k) => argv.includes(k);
  const oi = argv.indexOf('--only');
  const only = oi >= 0 ? argv[oi + 1].split(',') : null;
  const ctx = await buildContext({ scatter: has('--scatter') });
  let res = lint(ctx, { only });
  if (has('--no-warn')) res = res.filter((f) => f.level !== 'warn');
  const counts = {}; for (const r of Object.keys(RULES)) counts[r] = res.filter((f) => f.rule === r).length;
  if (has('--json')) console.log(JSON.stringify({ counts, findings: res }, null, 1));
  else {
    for (const f of res) console.log(line(f));
    console.log('content-lint: ' + res.length + ' finding(s) ' + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
  }
  const fail = res.filter((f) => f.level === 'error' || has('--strict')).length;
  process.exit(fail ? 1 : 0);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
