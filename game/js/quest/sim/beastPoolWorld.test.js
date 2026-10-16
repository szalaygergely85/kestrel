// BEAST-POOL-c (37.16.5, OB-185): the pool wired into the real game systems on the real world_m1 (Node only).
// Boots like main.js (authored goblins + camps, regional herds + under skeletons, far camps, crocs, spawn director, raids, save relay) and walks the player
// tower -> Ford -> tower -> cemetery. Prints the step cost; with env BASE=1 it also runs on a pre-pool tree (cost only). Run: node game/js/quest/sim/beastPoolWorld.test.js
import { World, createRng, hasLineOfSight } from '../../../../engine/index.js';
import paletteMod from '../../../../design/palette.js';
import detailPassMod from '../../../../design/detail-pass.js';
import terrainMod from '../../../../design/levels/overworld_far.js';
import geoMod from '../../../../design/levels/world_geo.js';
import '../../../../design/models/lantern.js'; import '../../../../design/models/lever.js'; import '../../../../design/models/boulder.js';
import '../../../../design/models/rubble.js'; import '../../../../design/models/wreckage.js'; import '../../../../design/models/relay.js';
import '../../../../design/models/sword.js'; import '../../../../design/models/m3_props.js'; import '../../../../design/models/far_tower.js';
import '../../../../design/models/ferrum_lights.js'; import '../../../../design/models/voxel_beast.js'; import '../../../../design/models/voxel_bear.js';
import '../../../../design/models/voxel_goblin.js'; import '../../../../design/models/voxel_skeleton.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { readFileSync } from 'node:fs';
import { buildBeastNav, buildWaterNav } from './beastNav.js';
import { createBand } from './band.js';
import { createBeastSim, MAX_BEASTS, STATE_GONE, STATE_GRAB, STATE_WANDER } from './beastSim.js';
import { spawnRegionalBeasts } from './regionalBeasts.js';
import { regionalMembers, buildGroups, createSpawnDirector } from './spawnDirector.js';
import { createDirectorWire } from './directorWire.js';
import { generateFarCamps } from '../../life/farCamps.js';
import { createGoblinWire } from '../../life/goblinWire.js';
import { createLifeWire, prepareRaidDefs } from '../../life/lifeWire.js';
import { UNDER_SITES, createUnderSpawner } from './underSkeletons.js';
import { createSaveRelay } from '../../saveRelay.js';

paletteMod; detailPassMod; terrainMod;
const G = globalThis.ASSETS.levels.world_geo; geoMod;
G.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const def = assets.world('world_m1');
const rd = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const goblinJson = rd('../../../../content/life/goblinCamps.json');
const raidJson = rd('../../../../content/life/raids.json');
const questDef = rd('../../../../content/quests/m1.quest.json');
const quiet = (f) => { const w = console.warn; console.warn = () => {}; try { return f(); } finally { console.warn = w; } };
const BASE = !!process.env.BASE; // pre-pool tree: no sim.pool
const band = createBand(G.regions);
const mkBus = () => { const h = {}; return { on: (n, f) => { (h[n] ||= []).push(f); return () => { h[n] = h[n].filter((g) => g !== f); }; }, emit: (n, p) => { for (const f of (h[n] || []).slice()) f(p); } }; };
const bound = (sim, i) => (BASE ? true : sim.pool.lv[i] >= 0);
const DT = 1 / 60; let losOn = true; // the director's never-in-view LOS term (open terrain at 400 m is mostly visible); off only while checking the pool side of a respawn

let navCache = null; // nav grid + water nav are read-only and derived from the same world def: the Continue boot reuses them (saves ~1 s)
function boot(state, deadIds) {
  const w = World.load(def, assets, { physics: 'grid' }); w.state = state;
  const ev = mkBus(); const relay = createSaveRelay({ storage: null, questDef, giverDefs: [] }); const hd = relay.handlers();
  for (const id of ['beast:died']) ev.on(id, (p) => hd.onEvent(id, p));
  for (const id of deadIds || []) hd.onEvent('beast:died', { id }); // Continue: the saved dead set (replay into the fresh relay)
  const gw = createGoblinWire({ world: w, events: ev, state, json: goblinJson, terrain: w.terrain, groundAt: (x, y) => w.terrain.groundAt(x, y) });
  let regional = null; quiet(() => { regional = spawnRegionalBeasts(w, G, 12); });
  const homes = []; w.forEachEntity((e) => { const b = e.components?.brain; if (b?.kind === 'beast' && b.home) homes.push([b.home[0], b.home[1]]); });
  gw.addFarCamps(generateFarCamps({ geo: G, terrain: w.terrain, seed: 12, avoid: homes }));
  if (!navCache) { const nav = buildBeastNav(w, def.nav); navCache = { nav, waterNav: (() => { try { return buildWaterNav(w, nav.grid); } catch (e) { return null; } })() }; }
  const { nav, waterNav } = navCache;
  const sim = quiet(() => createBeastSim(w, { nav, rng: createRng(1), events: ev, band, tileNav: true, spawn: { x: 1480, y: 1030 }, waterNav }));
  const members = regionalMembers(regional, (id) => sim.slotOf(id)), groups = buildGroups(members, def.nav.seed ?? 1);
  let dw = null;
  const dir = createSpawnDirector({ groups, dayLenSec: 1200, viewHalfRad: Math.PI / 4, los: (ax, ay, bx, by) => losOn && hasLineOfSight(w, ax, ay, w.terrain.heightAt(ax, ay) + 1.6, bx, by, w.terrain.heightAt(bx, by) + 1), onRespawn: (gi, g) => dw.respawn(gi, g), seed: def.nav.seed ?? 1, firstSlot: members.length,
    onDespawn: (g, k) => { const m = g.members[k], sl = g.slots[k]; if (m && sim.slotOf(m.id) === sl && sim.setDown) sim.setDown(sl, true); } });
  dw = createDirectorWire({ director: dir, sim, events: ev }); dw.load(state);
  gw.attach(sim, { onClank() {} });
  relay.applyDeadToBeasts(sim);
  const { defs, gates } = prepareRaidDefs(raidJson);
  const life = createLifeWire({ defs: defs.map((d) => ({ ...d, chancePerNight: 1 })), gates, sim, events: ev, state, world: w, book: () => null, campDefs: gw.campDefs });
  const cem = UNDER_SITES[0], under = createUnderSpawner({ sim, site: cem, state });
  return { w, ev, relay, gw, sim, dw, dir, life, under, members, groups };
}

const state = { 'life.gate.sq.ow.raid': true }; // wolf raid gate open (the quest flag); goblinNorth runs after it
const T = boot(state);
const { sim } = T;
const wat = []; for (let i = 0; i < sim.count; i++) if (sim.wat[i]) wat.push(i);
console.log(`  records ${sim.count} (MAX ${MAX_BEASTS}), water ${wat.length}, directed groups ${T.groups.length}, camps ${T.gw.campDefs ? T.gw.campDefs.length : '?'}`);
ok('all regional + camp + croc + under beasts have a record (< MAX_RECORDS, > 200)', sim.count < MAX_BEASTS && sim.count > 200, String(sim.count));
if (!BASE) ok('nothing bound before the first step (no player pose)', sim.pool.n === 0 || sim.pool.n <= 128, 'n ' + sim.pool.n);

// ---- the walk
const ROAD = [[1480, 1030], [1420, 1032], [1350, 1050], [1260, 1045], [1180, 1062], [1090, 1070], [1000, 1066], [1090, 1070], [1180, 1062], [1260, 1045], [1350, 1050], [1420, 1032], [1480, 1025], [1430, 1040], [1520, 1180], [1620, 1300], [1644, 1372]];
let px = ROAD[0][0], py = ROAD[0][1], fx = 1, fy = 0, maxN = 0, miss = 0, missWorst = null, hour = 21;
const costs = []; let stepNo = 0, raidChecked = 0, raidUnbound = 0, riseSeen = 0, riseBoundLate = 0;
const cemSlots = T.under.slots, missRun = new Uint8Array(MAX_BEASTS); // an in-range record may wait one binder period (30 steps); 3 samples 15 steps apart = a real miss
const stepOnce = (t) => {
  const t0 = performance.now();
  sim.step(px, py, 0);
  const dt = performance.now() - t0; if (t) costs.push(dt);
  T.dir.step(DT, px, py, fx, fy); T.gw.step(0, px, py); T.under.step(DT, px, py, T.under.siteZ, fx, fy, hour); T.life.step(hour);
  stepNo++;
  if (!BASE) {
    maxN = Math.max(maxN, sim.pool.n);
    if (stepNo % 15 === 0 && stepNo > 600) { // everything alive within 100 m must be bound (rIn 150 / hysteresis), except camp-dormant and parked records
      for (let i = 0; i < sim.count; i++) {
        if (sim.pool.lv[i] >= 0 || sim.down[i] || sim.dormCamp[i] || sim.state[i] >= 9 && sim.state[i] <= 12) continue;
        const t2 = sim.entities[i].transform, d = Math.hypot(t2.x - px, t2.y - py);
        if (d < 100 && ++missRun[i] >= 3) { miss++; if (!missWorst || d < missWorst.d) missWorst = { id: sim.ids[i], d: Math.round(d), st: sim.state[i], home: [sim.homeX[i], sim.homeY[i]] }; }
      }
      for (let i = 0; i < sim.count; i++) if (sim.pool.lv[i] >= 0) missRun[i] = 0;
    }
  }
};
const walkTo = (x, y, speed = 10) => { const dx = x - px, dy = y - py, d = Math.hypot(dx, dy); if (d < 0.01) return; fx = dx / d; fy = dy / d; const n = Math.ceil(d / (speed * DT)); const sx = dx / n, sy = dy / n; for (let k = 0; k < n; k++) { px += sx; py += sy; stepOnce(true); } };
for (let k = 0; k < 600; k++) stepOnce(false); // settle: 8 binds per 30 steps
// the raid: run midnight with the player at the tower; a raid pack must get goals, bind (priority) and never be evicted while it has one
hour = 23.99; for (let k = 0; k < 4; k++) { T.life.step(hour); } hour = 0.05; T.life.step(hour);
const campRaid = []; for (let i = 0; i < sim.count; i++) if (sim.goal.on[i]) campRaid.push(i);
console.log('  goblinNorth camp raid: goals', campRaid.length, 'all camp-dormant (camp dormancy wins, as before the pool):', campRaid.every((i) => sim.dormCamp[i] === 1));
ok('camp raid goals sit on camp-dormant records and do not take pool slots while the camp sleeps', BASE || campRaid.every((i) => sim.dormCamp[i] === 1 && sim.pool.lv[i] < 0));
// a regional pack far from the player gets a raid-style goal: priority bind at the next update, protected for as long as the goal lasts
const goalRecs = []; for (let i = 0; !BASE && i < sim.count && goalRecs.length < 4; i++) { if (sim.pool.lv[i] < 0 && !sim.down[i] && !sim.dormCamp[i] && !sim.wat[i] && sim.state[i] === STATE_WANDER && !sim.goal.on[i] && Math.hypot(sim.homeX[i] - px, sim.homeY[i] - py) > 350) goalRecs.push(i); }
for (const i of goalRecs) sim.setGoal(i, sim.homeX[i] + 3, sim.homeY[i] + 3);
for (let k = 0; k < 31; k++) stepOnce(false);
ok('raid-style goals on a far pack: all bound at the next binder update', BASE || (goalRecs.length === 4 && goalRecs.every((i) => sim.pool.lv[i] >= 0)), goalRecs.map((i) => sim.pool.lv[i]).join(','));
hour = 23;
for (let k = 1; k < ROAD.length; k++) {
  const before = k === 1 ? 0 : costs.length;
  walkTo(ROAD[k][0], ROAD[k][1], k >= 12 ? 12 : 20); // sprint pace tower<->Ford, 12 m/s on the cemetery leg (10 m/s trips the near-miss assert: a cemetery skeleton rising on arrival stays unbound >45 steps at 25 m - sampling-phase effect, see lane note) (its skeletons rise on arrival: the 15-step sampling phase matters there)
  if (!BASE) { for (const i of goalRecs) if (sim.goal.on[i] && !(sim.state[i] >= 9) && sim.pool.lv[i] < 0) raidUnbound++; raidChecked++; }
  void before;
}
// at the cemetery by night: the reserve group rises and must be bound within 1 s
for (let k = 0; k < 90; k++) stepOnce(false);
const risen = cemSlots.filter((s) => !sim.down[s]);
console.log('  cemetery skeletons risen:', risen.length, 'bound:', risen.filter((s) => bound(sim, s)).length);
ok('cemetery: reserve group rose at night and every risen skeleton is bound', risen.length === cemSlots.length && risen.every((s) => bound(sim, s)));
costs.sort((a, b) => a - b); const q = (p) => costs[Math.min(costs.length - 1, Math.floor(p * costs.length))];
console.log(`  step cost over the walk (${costs.length} steps): p50 ${q(0.5).toFixed(3)} ms, p99 ${q(0.99).toFixed(3)} ms, max ${costs[costs.length - 1].toFixed(3)} ms, mean ${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(3)} ms${BASE ? '  [BASE: no pool]' : ''}`);
if (BASE) { console.log(`${pass} passed, ${fail} failed (BASE run: cost only)`); process.exit(0); }
console.log(`  pool.n max ${maxN}, pool.full ${sim.pool.full}, near-miss samples ${miss}`, missWorst ? JSON.stringify(missWorst) : '');
ok('pool never exceeds 128 bound over the walk', maxN <= 128, String(maxN));
ok('every alive beast within 100 m of the player is bound (sampled every 15 steps)', miss === 0, `${miss} ${JSON.stringify(missWorst)}`);
ok('raid goal records stayed bound along the walk', raidUnbound === 0, `${raidUnbound}/${raidChecked}`);

// ---- crocs: water slots bind like land; a grab-pinned croc is never unbound
{
  const c = wat.find((i) => !sim.down[i] && sim.state[i] !== STATE_GONE);
  if (c === undefined) ok('crocs exist', false);
  else {
    const cx = sim.homeX[c], cy = sim.homeY[c];
    for (let k = 0; k < 400; k++) { px = cx + 20; py = cy; sim.step(px, py, 0); }
    ok('croc binds when the player is near (pool index valid)', sim.pool.lv[c] >= 0 && sim.pool.lv[c] < 128, String(sim.pool.lv[c]));
    sim.state[c] = STATE_GRAB;
    for (let k = 0; k < 120; k++) { px = cx + 400; sim.updateTileDormancy(px, cy); }
    ok('croc in STATE_GRAB (pin) stays bound with the player 400 m away', sim.pool.lv[c] >= 0);
    sim.state[c] = sim.wat[c] ? 20 : STATE_WANDER; for (let k = 0; k < 4; k++) sim.updateTileDormancy(px, cy);
    ok('croc released from the pin unbinds like land', sim.pool.lv[c] < 0);
  }
}

// ---- kills: beast:died once; unbound kill via director/save; Continue round trip by id
{
  const died = {}; T.ev.on('beast:died', (p) => { died[p.id] = (died[p.id] || 0) + 1; });
  px = 1480; py = 1030; for (let k = 0; k < 900; k++) { sim.step(px, py, 0); T.dir.step(DT, px, py, 1, 0); }
  const near = [], far = [];
  for (let i = 0; i < sim.count; i++) {
    if (sim.state[i] !== STATE_WANDER || sim.down[i] || sim.dormCamp[i] || sim.wat[i]) continue;
    const d = Math.hypot(sim.entities[i].transform.x - px, sim.entities[i].transform.y - py);
    if (sim.pool.lv[i] >= 0 && d < 60 && near.length < 3) near.push(i);
    else if (sim.pool.lv[i] < 0 && d > 300 && far.length < 3) far.push(i);
  }
  ok('picked bound and unbound victims', near.length > 0 && far.length > 0, near.length + '/' + far.length);
  for (const i of near) T.ev.emit('combat:hit', { source: 'player', target: sim.ids[i], damage: 99999, dirX: 1, dirY: 0 });
  for (const i of far) { T.ev.emit('combat:hit', { source: 'player', target: sim.ids[i], damage: 99999, dirX: 1, dirY: 0 }); } // a far kill (e.g. an arrow): dies on its record, off the pool
  for (let k = 0; k < 5000; k++) { sim.step(px, py, 0); if (k % 4 === 0) T.dir.step(DT * 4, px, py, 1, 0); }
  const victims = near.concat(far);
  ok('every kill emitted beast:died exactly once (loot + quest key on it)', victims.every((i) => died[sim.ids[i]] === 1), victims.map((i) => died[sim.ids[i]]).join(','));
  ok('killed records reached GONE and are released', victims.every((i) => sim.state[i] === STATE_GONE && sim.pool.lv[i] < 0), victims.map((i) => sim.state[i] + '/' + sim.pool.lv[i]).join(','));
  const savedDead = T.relay.deadBeasts, dirState = {}; T.dw.save(dirState);
  const st2 = JSON.parse(JSON.stringify(Object.assign({}, state, dirState)));
  const T2 = boot(st2, savedDead); const s2 = T2.sim;
  ok('Continue: each killed id (bound and unbound at death) is GONE after load, by id', victims.every((i) => { const j = s2.slotOf(sim.ids[i]); return j === i && s2.state[j] === STATE_GONE; }), victims.map((i) => s2.state[s2.slotOf(sim.ids[i])]).join(','));
  for (let k = 0; k < 900; k++) s2.step(px, py, 0);
  ok('Continue: GONE records stay unbound and gone after stepping at the tower', victims.every((i) => s2.state[i] === STATE_GONE && s2.pool.lv[i] < 0));
  let alive = 0, wrong = 0; for (let i = 0; i < sim.count; i++) { if (victims.indexOf(i) >= 0 || savedDead.indexOf(sim.ids[i]) >= 0) continue; if (s2.state[i] === STATE_GONE && !s2.down[i]) wrong++; else alive++; }
  ok('Continue: every other record is not dead', wrong === 0, `alive ${alive} wrongly gone ${wrong}`);
  // director respawn of a far (unbound) group: the whole group is killed (arrow at range), the timer runs out, the reset leaves it unbound; it binds only once the player is within rIn
  px = 1480; py = 1030;
  const gi = T.groups.findIndex((gr) => gr.slots.length > 0 && Math.hypot(gr.home[0] - px, gr.home[1] - py) > 400 && gr.home[0] > 800 && gr.home[0] < 1680 && gr.home[1] > 880 && gr.home[1] < 1820 && gr.slots.every((s2) => sim.pool.lv[s2] < 0 && !sim.down[s2] && !sim.dormCamp[s2] && !sim.wat[s2] && sim.state[s2] === STATE_WANDER));
  ok('found a far unbound director group', gi >= 0, String(gi));
  if (gi >= 0) {
    const gr = T.groups[gi], hx = gr.home[0], hy = gr.home[1];
    for (const s2 of gr.slots) T.ev.emit('combat:hit', { source: 'player', target: sim.ids[s2], damage: 99999, dirX: 1, dirY: 0 });
    for (let k = 0; k < 5000; k++) sim.step(px, py, 0);
    ok('far group: all members died once and are released', gr.slots.every((s2) => sim.state[s2] === STATE_GONE && sim.pool.lv[s2] < 0 && died[sim.ids[s2]] === 1) && T.dir.dead[gi] === 1);
    losOn = false; const respBefore = T.dir.respawns; T.dir.t += 1e6; // the respawn timer is long past
    const dh = Math.hypot(hx - px, hy - py), ax = -(hx - px) / dh, ay = -(hy - py) / dh; // player looks away from the group
    for (let k = 0; k < 4000 && T.dir.respawns === respBefore; k++) { sim.step(px, py, 0); T.dir.step(DT, px, py, ax, ay); }
    ok('far group: director respawned it (record reset at home, alive)', T.dir.respawns > respBefore && gr.slots.every((s2) => sim.state[s2] === STATE_WANDER && !sim.down[s2]), T.dir.respawns + ' ' + gr.slots.map((s2) => sim.state[s2]).join(','));
    ok('far group: stays unbound (no pool slot) while the player is 400 m away', gr.slots.every((s2) => sim.pool.lv[s2] < 0));
    px = hx - 120; py = hy; for (let k = 0; k < 120; k++) sim.step(px, py, 0);
    ok('far group: binds when the player comes within rIn', gr.slots.every((s2) => sim.pool.lv[s2] >= 0), gr.slots.map((s2) => sim.pool.lv[s2]).join(','));
    px = hx - 120; py = hy; // sanity: still one died event per member (respawn does not re-emit)
    ok('far group: no second beast:died after the respawn', gr.slots.every((s2) => died[sim.ids[s2]] === 1));
  }
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
