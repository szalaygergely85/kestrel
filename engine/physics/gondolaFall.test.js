// BUG-GONDOLA-FALL regression: fall / run-off / walk into the tower gondola area (REAL world_m1, mesh physics, real
// integrate + resolveBodyContacts). Never below the floor, never inside the gondola box, always ends grounded.
// Root cause (route in the backlog row): the owner fell from the upper stair (z 5.4) beside the gondola, landed on the
// edge of a small prop box (x 1494.12..1494.68, y 1025.32..1025.88, z 0..0.76) whose face is 0.12 m from a 0.6 m stepped
// tower wall: depenetration squeezed the capsule through that wall, the airborne floor probe (up = 1e-6) missed the
// step top above the feet and the player fell out of the world. Fix: probeSupport looks up to stepUpMax above the feet.
// Run: node engine/physics/gondolaFall.test.js
import { World, PHYSICS_DEFAULTS, integrate, resolveBodyContacts } from '../index.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import terrainDef from '../../design/levels/overworld_far.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import m3PropsMod from '../../design/models/m3_props.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import titleMod from '../../design/models/title.js';
import voxelWorldMod from '../../design/models/voxel_world.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
paletteMod; terrainDef; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod; relayMod;
detailPassMod; swordMod; m3PropsMod; farTowerMod; ferrumLightsMod; titleMod; voxelWorldMod;
const { assets } = await loadTestAssets();
const P = PHYSICS_DEFAULTS, DT = P.fixedDt;
const world = World.load(assets.world('world_m1'), assets, { physics: 'mesh' });

let checks = 0, failures = 0;
const fails = [];
const ok = (c, m) => { checks++; if (!c) { failures++; if (fails.length < 8) fails.push(m); } };

// Gondola box (tower.level.json prop "gondola": c/half in prop space, yaw 90) in world metres.
const g = world.entity('tower.gondola');
const gt = g.transform, yaw = gt.yawDeg * Math.PI / 180, cs = Math.cos(yaw), sn = Math.sin(yaw);
const lc = [-0.7225, -0.08653045877758833, 0.558270426175426], lh = [1.02, 0.49843946288150076, 0.558270426175426];
const bcx = gt.x + cs * lc[0] - sn * lc[1], bcy = gt.y + sn * lc[0] + cs * lc[1];
const hxw = Math.abs(cs * lh[0]) + Math.abs(sn * lh[1]), hyw = Math.abs(sn * lh[0]) + Math.abs(cs * lh[1]);
const boxTop = gt.z + lc[2] + lh[2];
const insideBox = (x, y, z) => Math.abs(x - bcx) < hxw - 0.02 && Math.abs(y - bcy) < hyw - 0.02 && z < boxTop - 0.05 && z > gt.z + 0.05;

function makePlayer(x, y, z, vz, vx = 0, vy = 0) {
  return { id: 'p', type: 'player', transform: { x, y, z, yawDeg: 0, pitchDeg: 0 },
    components: { body: { radius: P.radius, height: P.height, eyeH: P.eyeHeight, vx, vy, vz, grounded: false, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: z } } };
}
/** Simulates `steps` fixed steps; returns {z, minZ, inside, grounded}. `ctl` = {forward,yawDeg,jump}. */
function sim(p, steps, ctl) {
  const c = { forward: 0, strafe: 0, run: true, jump: false, yawDeg: 0, ...ctl };
  let minZ = p.transform.z, inside = false;
  for (let i = 0; i < steps; i++) {
    integrate(p, DT, c, world, P); resolveBodyContacts(world, p, P);
    const t = p.transform;
    if (t.z < minZ) minZ = t.z;
    if (insideBox(t.x, t.y, t.z)) inside = true;
  }
  return { x: p.transform.x, y: p.transform.y, z: p.transform.z, minZ, inside, grounded: p.components.body.grounded };
}
function check(tag, r, x, y) {
  const fl = world.floorAt(r.x ?? x, r.y ?? y);
  ok(r.minZ > -0.31, `${tag}: fell below the floor (minZ ${r.minZ.toFixed(2)})`);
  ok(!r.inside, `${tag}: inside the gondola box`);
  ok(r.grounded, `${tag}: not grounded after the drop`);
  ok(fl != null && r.z >= fl - 0.02 && r.z < fl + 3, `${tag}: ended at z ${r.z.toFixed(2)}`);
}

// 1. Straight drops from the upper stair level (5.4 .. 6 m) at 0 / -14 / -18 m/s: a coarse grid around the gondola plus a fine
// 0.03 m grid over the squeeze spot (small prop box + stepped tower wall, the owner's fall point).
const dropAt = (z0, vz, x, y) => {
  const fl0 = world.floorAt(x, y);
  if (fl0 == null || fl0 > 1.5) return; // upper stair cells / outside: not a ground landing spot
  check(`drop z${z0} vz${vz} (${x.toFixed(2)},${y.toFixed(2)})`, sim(makePlayer(x, y, z0, vz), 300), x, y);
};
for (const z0 of [5.4, 6]) for (const vz of [0, -14, -18]) {
  for (let dx = -3; dx <= 1.5; dx += 0.1) for (let dy = -2.8; dy <= 2.2; dy += 0.1) dropAt(z0, vz, bcx + dx, bcy + dy);
  for (let x = 1493.6; x <= 1495.2; x += 0.03) for (let y = 1025.0; y <= 1026.5; y += 0.03) dropAt(z0, vz, x, y);
}

// 2. Run-off: leave the upper stair edge (x 1493.9, y 1025.4, z 5.4) running in 16 directions at run speed.
for (let a = 0; a < 360; a += 22.5) for (const dy of [-0.4, 0, 0.4]) {
  const x = 1493.88, y = 1025.44 + dy;
  const p = makePlayer(x, y, 5.4, 0);
  check(`runoff yaw ${a} dy ${dy}`, sim(p, 300, { forward: 1, yawDeg: a }), x, y);
}

// 3. Walk / jump into the gondola on the floor from 8 sides, 3 m away.
for (let a = 0; a < 360; a += 45) for (const jump of [false, true]) {
  const rad = a * Math.PI / 180, sx = bcx + Math.sin(rad) * 3, sy = bcy - Math.cos(rad) * 3, sf = world.floorAt(sx, sy);
  if (sf == null || sf > 0.3 || sf < -0.01) continue; // start must be flat open ground (others are outside / on the heap)
  const p = makePlayer(sx, sy, sf, 0);
  p.components.body.grounded = true;
  const yawDeg = Math.atan2(bcx - sx, -(bcy - sy)) * 180 / Math.PI;
  const r = sim(p, 360, { forward: 1, yawDeg, jump });
  ok(r.minZ > -0.31 && !r.inside && r.z > -0.31, `walk-in from ${a} jump ${jump}: minZ ${r.minZ.toFixed(2)} inside ${r.inside}`);
}

if (failures) { console.error(`FAIL gondolaFall: ${failures}/${checks}`); for (const f of fails) console.error('FAIL:', f); process.exit(1); }
console.log(`gondolaFall.test: ${checks} checks passed`);
