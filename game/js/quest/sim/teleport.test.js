// SPELL-R4 (docs/architecture.md 38.80): Teleport target search. Run: node --expose-gc game/js/quest/sim/teleport.test.js
// Stub mesh world (exact wall plane / floor fn / water / bounds), a real GRID world (tower) and a real MESH world (world_m1 sweep).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { World, PHYSICS, createHasher } from '../../../../engine/index.js';
import { makeOk } from '../../../../engine/test/assert.js';
import { allocProbe } from '../../../../tools/allocProbe.mjs';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import paletteMod from '../../../../design/palette.js';
import detailPassMod from '../../../../design/detail-pass.js';
import lanternMod from '../../../../design/models/lantern.js';
import leverMod from '../../../../design/models/lever.js';
import boulderMod from '../../../../design/models/boulder.js';
import rubbleMod from '../../../../design/models/rubble.js';
import wreckageMod from '../../../../design/models/wreckage.js';
import relayMod from '../../../../design/models/relay.js';
import swordMod from '../../../../design/models/sword.js';
import m3PropsMod from '../../../../design/models/m3_props.js';
import terrainMod from '../../../../design/levels/overworld_far.js';
import boarMod from '../../../../design/models/voxel_beast.js';
import { SPELL_DEFS } from '../spellDefs.js';
import { createTeleport, NO_ROOM } from './teleport.js';

if (typeof global.gc !== 'function') { const r = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' }); process.exit(r.status ?? 1); }
paletteMod; detailPassMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; terrainMod; boarMod;
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const EYE = PHYSICS.eyeHeight, R = PHYSICS.radius;

/** Stub mesh world. wx: wall plane x = wx (null = none); floor(x,y) fn; ceil z (null = sky); water(x,y) -> depth; limit = circle bounds radius. */
function stub(o = {}) {
  const w = new World(); w.physicsMode = 'mesh';
  const wx = o.wx ?? null, floor = o.floor || (() => 0), ceil = o.ceil ?? null, water = o.water || (() => 0), limit = o.limit ?? null;
  w.bounds = limit === null ? null : { shape: 'circle', x: 0, y: 0, r: limit };
  w.supportAtOut = (g, opts, io) => { io[3] = floor(io[0], io[1]); io[4] = 0; io[5] = 0; io[6] = 1; io[7] = 0; io[8] = 0; io[9] = ceil === null ? NaN : ceil; };
  w.waterAt = (x, y, out) => { const d = water(x, y); if (d <= 0) return false; out.depth = d; return true; };
  w.collideCircle = (x, y, dx, dy, r, z, g, opts, out) => { out.x = x + dx; out.y = y + dy; out.blockedX = false; out.blockedY = false; out.nx = 0; out.ny = 0; if (wx !== null && out.x > wx - r) { out.x = wx - r; out.blockedX = true; } return out; };
  w.raySegmentRay = (seg, out) => { if (wx === null) return false; const ax = seg[0], bx = seg[3]; if (ax >= wx || bx < wx) return false; out.t = (wx - ax) / (bx - ax); out.x = wx; out.y = seg[1]; out.z = seg[2]; return true; };
  return w;
}
function rig(world, tier = 1, mana = 100) {
  const log = { mana: 0, said: [], blink: null, lost: null, n: 0 };
  const tp = createTeleport(world, { spendMana: (n) => { if (mana < n) return false; mana -= n; log.mana += n; return true; }, say: (t) => log.said.push(t),
    blink: (x, y, z) => { log.blink = [x, y, z]; log.n++; }, loseTrack: (x, y, r, s) => { log.lost = [x, y, r, s]; } });
  return { tp, log, cast: (e, a, t = tier) => tp.cast(t, Float64Array.from(e), Float64Array.from(a)) };
}
const EAST = [1, 0, 0];

{ // range per level, open ground
  for (let lv = 1; lv <= 3; lv++) {
    const r = rig(stub(), lv); const res = r.cast([0, 0, 0], EAST);
    ok(`lv${lv}: open ground lands at max range`, res === 0 && Math.abs(r.log.blink[0] - SPELL_DEFS.teleport.tiers[lv - 1].dist) < 1e-9 && r.log.mana === SPELL_DEFS.teleport.tiers[lv - 1].mana, JSON.stringify(r.log));
  }
}
{ // wall at 5 m: lands <= wall - radius, never past; cooldown
  const r = rig(stub({ wx: 5 }), 3); const res = r.cast([0, 0, 0], EAST);
  ok('wall at 5 m: lands before the wall', res === 0 && r.log.blink[0] <= 5 - R + 1e-9 && r.log.blink[0] >= 1, JSON.stringify(r.log.blink));
  ok('cooldown: second cast refused with no mana / no toast', r.cast([0, 0, 0], EAST) === 1 && r.log.n === 1 && r.log.said.length === 0 && r.log.mana === 6);
  for (let i = 0; i < 4 * 60 + 1; i++) r.tp.step();
  ok('cooldown ends after cd s', r.cast([0, 0, 0], EAST) === 0 && r.log.n === 2);
  const w0 = rig(stub({ wx: 0.8 })); ok('wall at 0.8 m: refused, toast, no mana', w0.cast([0, 0, 0], EAST) === 1 && w0.log.said[0] === NO_ROOM && w0.log.mana === 0 && w0.log.n === 0);
}
{ // mana short: nothing happens
  const r = rig(stub(), 1, 3); ok('no mana: refused, no blink', r.cast([0, 0, 0], EAST) === 1 && r.log.n === 0 && r.log.mana === 0);
}
{ // low ceiling rejects; ledge heights per level
  const r = rig(stub({ ceil: 1.5 })); ok('low ceiling: refused', r.cast([0, 0, 0], EAST) === 1);
  for (const [lv, h, want] of [[1, 0.5, true], [1, 0.8, false], [2, 1.4, true], [2, 1.8, false], [3, 2.9, true], [3, 3.5, false]]) {
    const q = rig(stub({ floor: (x) => (x >= 4 ? h : 0) }), lv); const res = q.cast([0, 0, 0], [1, 0, 0]);
    ok(`ledge ${h} m at level ${lv}: ${want ? 'climbs' : 'backs off before it'}`, want ? (res === 0 && q.log.blink[2] === h) : (res === 0 && q.log.blink[0] < 4 && q.log.blink[2] === 0), JSON.stringify(q.log.blink));
  }
}
{ // swim-deep water skipped; all water refused; out of bounds backs off
  const r = rig(stub({ water: (x) => (x >= 6 ? 2 : 0) }), 1); r.cast([0, 0, 0], EAST);
  ok('deep water: lands before it', r.log.blink && r.log.blink[0] < 6, JSON.stringify(r.log.blink));
  const sh = rig(stub({ water: (x) => (x >= 6 ? 0.5 : 0) }), 1); sh.cast([0, 0, 0], EAST);
  ok('shallow water (< swimIn) is fine', sh.log.blink && sh.log.blink[0] === 8);
  const aw = rig(stub({ water: () => 3 })); ok('all deep water: refused, no mana', aw.cast([0, 0, 0], EAST) === 1 && aw.log.mana === 0);
  const ob = rig(stub({ limit: 6 }), 3); ob.cast([0, 0, 0], EAST);
  ok('out of bounds: backs off inside', ob.log.blink && ob.log.blink[0] <= 6 - R - 0.05 + 1e-9, JSON.stringify(ob.log.blink));
}
{ // lv3 beasts lose track; lv1 not; vertical aim only refuses
  const r3 = rig(stub(), 3); r3.cast([2, 3, 0], EAST); ok('lv3: loseTrack(start, 6 m, 2 s)', r3.log.lost && r3.log.lost[0] === 2 && r3.log.lost[1] === 3 && r3.log.lost[2] === 6 && r3.log.lost[3] === 2);
  const r1 = rig(stub(), 1); r1.cast([0, 0, 0], EAST); ok('lv1: beasts keep tracking', r1.log.lost === null);
  ok('straight up: refused', rig(stub()).cast([0, 0, 0], [0, 0, 1]) === 1);
}
{ // far drop: ground must be within 1.5 m below the ray foot -> backs off
  const r = rig(stub({ floor: (x) => (x >= 4 ? -5 : 0) }), 3); r.cast([0, 0, 0], EAST);
  ok('far drop (floor > 1.5 m under the ray): not chosen', r.log.blink && r.log.blink[0] < 4 && r.log.blink[2] === 0, JSON.stringify(r.log.blink));
}
// ---- real GRID world (tower) ------------------------------------------------------------------------------------
const { assets } = await loadTestAssets();
{
  const w = World.load({ name: 't', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }], entities: [], state: {} }, assets, { physics: 'grid' });
  ok('grid fixture is grid mode', w.physicsMode === 'grid');
  let casts = 0, bad = 0, refused = 0;
  const wsc = { depth: 0 }, hit = { t: 0, x: 0, y: 0, z: 0 };
  for (let ox = -6; ox <= 14; ox += 2) for (let oy = -6; oy <= 14; oy += 2) for (let a = 0; a < 360; a += 30) {
    const x = 1480 + ox, y = 1018 + oy, z = w.floorAt(x, y);
    if (!(z > -50)) continue;
    const r = rig(w, 3), yr = a * Math.PI / 180;
    if (r.cast([x, y, z], [Math.sin(yr), -Math.cos(yr), 0]) === 0) {
      casts++;
      const [tx, ty, tz] = r.log.blink;
      // independent re-check: the straight eye-to-eye ray is clear, not in a solid sector, not in swim-deep water
      if (w.raySegmentRay(Float64Array.from([x, y, z + EYE, tx, ty, tz + EYE]), hit)) bad++;
      const sc = w.sectorAt(tx, ty); if (sc && sc.solid) bad++;
      if (w.waterAt(tx, ty, wsc) && wsc.depth >= PHYSICS.swim.swimIn) bad++;
    } else refused++;
  }
  ok(`grid sweep: ${casts} blinks, ${refused} refused, 0 through-wall / solid / deep water`, casts > 20 && bad === 0, `bad ${bad}`);
}
// ---- real MESH world sweep (world_m1) -------------------------------------------------------------------------
{
  const data = JSON.parse(fs.readFileSync(new URL('../../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
  const w = World.load(data, assets, { physics: 'mesh' });
  ok('mesh fixture is mesh mode', w.physicsMode === 'mesh');
  const pe = w.get('player'), sp = pe ? pe.data.transform : { x: 0, y: 0 };
  let casts = 0, bad = 0, refused = 0; const wsc = { depth: 0 }, io = new Float64Array(10), hit = { t: 0, x: 0, y: 0, z: 0 };
  const o = { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax, walkCos: Math.cos(PHYSICS.maxSlopeDeg * Math.PI / 180) }, m = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false };
  for (let ox = -30; ox <= 30; ox += 6) for (let oy = -30; oy <= 30; oy += 6) for (let a = 0; a < 360; a += 45) {
    const x = (sp.x || 0) + ox, y = (sp.y || 0) + oy; io[0] = x; io[1] = y; io[2] = 1e3; w.supportAtOut(false, null, io);
    const z = io[3]; if (!(z > -100)) continue;
    const r = rig(w, 3), yr = a * Math.PI / 180;
    if (r.cast([x, y, z], [Math.sin(yr), -Math.cos(yr), 0]) !== 0) { refused++; continue; }
    casts++; const [tx, ty, tz] = r.log.blink;
    if (w.waterAt(tx, ty, wsc) && wsc.depth >= PHYSICS.swim.swimIn) bad++;
    w.collideCircle(tx, ty, 0, 0, R, tz, true, o, m); if (Math.hypot(m.x - tx, m.y - ty) > 1e-3) bad++;
    if (w.raySegmentRay(Float64Array.from([x, y, z + EYE, tx, ty, tz + EYE]), hit)) bad++;
  }
  ok(`mesh sweep: ${casts} blinks, ${refused} refused, 0 inside collider / through wall / deep water`, casts > 20 && bad === 0, `bad ${bad}`);
}
{ // determinism + 0 alloc
  const run = () => { const h = createHasher(); const r = rig(stub({ wx: 7, water: (x) => (x >= 5 ? 2 : 0) }), 2); for (let i = 0; i < 5; i++) { r.cast([0, i, 0], EAST); for (let k = 0; k < 400; k++) r.tp.step(); } r.tp.hashInto(h); h.f64(r.log.blink[0]); return h.value(); };
  ok('hash twice equal', run() === run());
  const sink = new Float64Array(4), w9 = stub({ wx: 9 });
  const r = { tp: createTeleport(w9, { spendMana: () => true, say: () => {}, blink: (x, y, z) => { sink[0] = x; sink[1] = y; sink[2] = z; }, loseTrack: (x, y, rr, ss) => { sink[3] = ss; } }) }, e = Float64Array.from([0, 0, 0]), a = Float64Array.from([1, 0.1, 0.05]);
  const pr = allocProbe((n) => { for (let i = 0; i < n; i++) { r.tp.cast(3, e, a); for (let k = 0; k < 300; k++) r.tp.step(); } }, { n: 100, warm: 3 });
  // Cold path (one cast per cooldown): the only allocations are boxed double args into collideCircle / waterAt / boundsOvershoot (no io form exists, arch 38.61 2b); bounded, no growth.
  ok(`100 casts: bounded cold-path alloc, no growth (${pr.perCall.toFixed(0)} B per cast+300 steps)`, pr.perCall < 4096, pr.perCall);
}
console.log(`teleport.test: ${pass} pass, ${fail} fail`); if (fail) { console.log(failures.join('\n')); process.exitCode = 1; } else console.log('ALL PASS');
