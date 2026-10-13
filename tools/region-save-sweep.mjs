#!/usr/bin/env node
// tools/region-save-sweep.mjs (WMP-09): save/load sweep over 6 regions, headless Node. Per region: wake the relay, accept the errand, kill 1 of its kind,
// clear the far camp where one exists, save (real createSaveRelay slot), load into a fresh world, assert errand state + progress, camp cleared, relay woken,
// beasts sane. Beast SIM state is not in the game save (arch 38.59 WM-12): beasts come back alive and at home; only `deadBeasts` ids persist (applyDeadToBeasts).
//   node tools/region-save-sweep.mjs     exit 1 on FAIL. runSweep() is also used by tools/region-save-sweep.test.mjs.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { World } from '../engine/index.js';
import { Events } from '../engine/dev.js';
import paletteMod from '../design/palette.js';
import farMod from '../design/levels/overworld_far.js';
import geoMod from '../design/levels/world_geo.js';
import detailPassMod from '../design/detail-pass.js';
import lanternMod from '../design/models/lantern.js';
import leverMod from '../design/models/lever.js';
import voxelPropsMod from '../design/models/voxel_props.js';
import boulderMod from '../design/models/boulder.js';
import rubbleMod from '../design/models/rubble.js';
import wreckageMod from '../design/models/wreckage.js';
import relayMod from '../design/models/relay.js';
import swordMod from '../design/models/sword.js';
import m3PropsMod from '../design/models/m3_props.js';
import farTowerMod from '../design/models/far_tower.js';
import ferrumLightsMod from '../design/models/ferrum_lights.js';
import titleMod from '../design/models/title.js';
import voxelWorldMod from '../design/models/voxel_world.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { loadPackQuests, loadQuestFiles, loadDesignAssets } from './validate-content.mjs';
import { registerQuestBehaviours } from '../game/js/quest/index.js';
import { gridVariant, placeLoaded } from '../game/js/quest/bandPose.js';
import { createSaveRelay } from '../game/js/saveRelay.js';
import { spawnRegionalBeasts } from '../game/js/quest/sim/regionalBeasts.js';
import { planWorldLife } from '../game/js/quest/sim/worldGen.js';
import { clearedKey, ensureGoblinCamps } from '../game/js/life/goblinCamps.js';
import { ACTIVE, READY } from '../game/js/quest/sim/questBook.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; farMod; geoMod; detailPassMod; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; farTowerMod; ferrumLightsMod; titleMod; voxelWorldMod;

/** 6 regions (errand key -> geo region id; `camp` = far camp id where the region has one). */
export const SWEEP = [
  { errand: 'glasswater', geo: 'glasswater' }, { errand: 'northwood', geo: 'northwood' }, { errand: 'ashMile', geo: 'ashMile', camp: 'campFar.ashMile' },
  { errand: 'signalHill', geo: 'signalHill', camp: 'campFar.signalHill' }, { errand: 'heath', geo: 'westHeath', camp: 'campFar.heath' }, { errand: 'downs', geo: 'downs' },
];

export async function runSweep() {
  const { assets } = await loadTestAssets();
  registerQuestBehaviours();
  const geo = globalThis.ASSETS.levels.world_geo;
  if (geo && geo.util) geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
  const raw = assets.world('world_m1');
  const def = raw.terrainGrid && raw.bounds && raw.bounds.shape === 'polygon' ? raw : gridVariant(raw, geo);
  const dir = fileURLToPath(new URL('../content/quests', import.meta.url));
  const packs = await loadPackQuests(dir, (await loadDesignAssets()).items?.defs); // item defs (tier/slot) for the reward templates
  const rd = (f) => JSON.parse(readFileSync(dir + '/' + f, 'utf8'));
  const giverDefs = [...loadQuestFiles(dir).quests.filter((q) => !q.path.endsWith('/m1.quest.json')).map((q) => q.def), ...packs.quests.map((q) => q.def)]; // authored givers first (pack errands may require them)
  const questDef = rd('m1.quest.json');
  const fails = [], ok = (c, m) => { if (!c) fails.push(m); };
  ok(packs.errors.length === 0, 'packs expand: ' + packs.errors.join('|'));
  const mem = new Map(), storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const mkWorld = () => World.load(def, assets, { physics: 'mesh', events: new Events() });
  const addBeasts = (w) => { // same order as main.js: shared plan (authored-only avoid), spawn only the missing ids
    const { herd: list, camps } = planWorldLife(w, geo, 12);
    spawnRegionalBeasts(w, geo, 12); ensureGoblinCamps(w, camps, w.terrain);
    return { list, camps };
  };
  const sitePose = (g) => { // relay site of the region (geo sites t 'L', st = region id), else the region rect centre
    const s = geo.sites.find((q) => q.t === 'L' && q.st === g.geo);
    if (s) return { x: s.x, y: s.y };
    const r = geo.regions.find((q) => q.id === g.geo).r; return { x: (r[0] + r[2]) / 2, y: (r[1] + r[3]) / 2 };
  };
  const rows = [];
  for (const g of SWEEP) {
    const qid = 'sq.reg.' + g.errand, qd = giverDefs.find((d) => d.id === qid);
    ok(!!qd, qid + ' exists'); if (!qd) continue;
    const kind = qd.objectives[0].when.kind, need = qd.objectives[0].when.count;
    const w1 = mkWorld(); const gen = addBeasts(w1);
    const A = createSaveRelay({ storage, questDef, giverDefs }); A.onWorldLoaded(); A.quest.world = w1;
    const flag = `waystone.ws_${g.errand}.woken`;
    w1.state[flag] = true; A.quest.feed({ type: 'flag:set', key: flag, value: true });
    ok(A.quest.book.accept(qid), g.errand + ': accept after wake');
    const victim = gen.list.find((b) => b.species === kind) || { id: kind + 'R0' };
    A.handlers().onEvent('beast:died', { id: victim.id });
    { const v = w1.get(victim.id); if (v && v.data.components.health) v.data.components.health.hp = 0; } // what beastSim does on a kill; the sim state itself is not saved
    const status0 = A.quest.book.statusOf(qid);
    ok(status0 === ACTIVE || (need === 1 && status0 === READY), g.errand + ': active after 1/' + need + ' (status ' + status0 + ')');
    let campId = null;
    if (g.camp) { const c = gen.camps.find((x) => x.id === g.camp); ok(!!c, g.camp + ' generated'); if (c) { campId = c.id; w1.state[clearedKey(c.id)] = true; } }
    const p = sitePose(g), t = w1.get('player').data.transform;
    t.x = p.x; t.y = p.y; t.z = w1.terrain.groundAt(p.x, p.y);
    ok(A.save(w1), g.errand + ': save written');
    // ---- load into a fresh world ----
    const B = createSaveRelay({ storage, questDef, giverDefs }); B.onWorldLoaded();
    const w2 = B.load(assets, { physics: 'mesh', events: new Events() }); ok(!!w2, g.errand + ': slot loads'); if (!w2) continue;
    B.onWorldLoaded(); B.quest.world = w2;
    ok(B.quest.book.statusOf(qid) === status0, g.errand + ': errand status kept');
    ok(JSON.stringify(B.quest.book.toSave().quests[qid] ?? null) === JSON.stringify(A.quest.book.toSave().quests[qid] ?? null), g.errand + ': errand progress count kept');
    ok(w2.state[flag] === true, g.errand + ': relay woken kept');
    if (campId) ok(w2.state[clearedKey(campId)] === true, campId + ': camp cleared kept');
    if (need > 1) { // progress keeps counting after the load
      for (let i = 1; i < need; i++) B.handlers().onEvent('beast:died', { id: kind + 'L' + i });
      ok(B.quest.book.statusOf(qid) === READY, g.errand + ': reaches READY after load');
    }
    // beasts: a fresh world regenerates the same regional beasts, alive, at home, unique ids, finite positions; the dead id stays in the save
    const gen2 = addBeasts(w2), seen = new Set(); let beasts = 0, bad = 0;
    w2.forEachEntity((e) => {
      if (e.type !== 'beast') return;
      if (e.id === victim.id) return; // dead one: hp 0 is saved, the id is in deadBeasts and applyDeadToBeasts hides it after the sim reset
      beasts++; if (seen.has(e.id)) bad++; seen.add(e.id);
      const tr = e.transform, h = e.components.brain && e.components.brain.home;
      if (!Number.isFinite(tr.x) || !Number.isFinite(tr.y) || !Number.isFinite(tr.z)) bad++;
      else if (h && Math.hypot(tr.x - h[0], tr.y - h[1]) > 1) bad++;
      const hp = e.components.health; if (hp && !(hp.hp > 0)) bad++; // sim state is not saved: all come back alive (WM-12 rule)
    });
    ok(beasts > 0 && bad === 0, `${g.errand}: ${beasts} beasts sane (${bad} bad)`);
    ok(B.deadBeasts.includes(victim.id), g.errand + ': dead beast id kept for applyDeadToBeasts');
    ok(gen2.list.length === gen.list.length && gen2.list.every((b, i) => b.id === gen.list[i].id), g.errand + ': regional beasts regenerate identically');
    ok(JSON.stringify(gen2.list) === JSON.stringify(gen.list), g.errand + ': herd homes identical fresh vs restored');
    ok(JSON.stringify(gen2.camps) === JSON.stringify(gen.camps) && gen.camps.length > 0, g.errand + ': every campFar.* position identical fresh vs restored (' + gen.camps.length + ')');
    for (const b of gen.list) { const e = w2.get(b.id), h = e && e.data.components.brain.home; ok(h && h[0] === b.x && h[1] === b.y, g.errand + ': restored herd home ' + b.id); }
    for (const c of gen.camps) for (const m of c.members) { const e = w2.get(m.id), h = e && e.data.components.brain.home; ok(h && h[0] === c.at[0] + m.at[0] && h[1] === c.at[1] + m.at[1], g.errand + ': restored camp member ' + m.id); }
    const t2 = w2.get('player').data.transform;
    ok(Math.abs(t2.x - p.x) < 0.5 && Math.abs(t2.y - p.y) < 0.5, `${g.errand}: pose kept (${t2.x.toFixed(1)},${t2.y.toFixed(1)} vs ${p.x},${p.y})`);
    rows.push(`${g.errand} beasts ${beasts} pose ${p.x},${p.y}`);
    if (w1.dispose) w1.dispose();
    if (w2.dispose) w2.dispose();
  }
  { // old save with a pose outside the polygon -> last woken relay (placeLoaded)
    const w = mkWorld();
    const t = { x: 5, y: 5, z: 0, yawDeg: 10, pitchDeg: 0 };
    ok(placeLoaded(w, t, () => ({ x: 1262, y: 1033, z: 3, yawDeg: 90 })) && t.x === 1262 && t.y === 1033 && t.yawDeg === 90, 'outside-bounds pose -> last woken relay');
    const t3 = { x: 1262, y: 1033, z: 3, yawDeg: 10, pitchDeg: 0 };
    ok(!placeLoaded(w, t3, () => ({ x: 1, y: 1 })) && t3.x === 1262, 'inside pose is kept');
    const t4 = { x: 5, y: 5, z: 0, yawDeg: 0, pitchDeg: 0 }; placeLoaded(w, t4, null); ok(t4.x === 5, 'no relay yet: pose untouched, no crash');
    if (w.dispose) w.dispose();
  }
  return { fails, rows };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/region-save-sweep.mjs')) {
  const t0 = Date.now(), r = await runSweep();
  for (const x of r.rows) console.log('ok   ' + x);
  for (const f of r.fails) console.log('FAIL ' + f);
  console.log(`region-save-sweep: ${r.fails.length ? 'FAIL' : 'PASS'} ${r.rows.length} regions, ${r.fails.length} failures, ${Date.now() - t0} ms`);
  process.exit(r.fails.length ? 1 : 0);
}
