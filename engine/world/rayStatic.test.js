// GI-PROBE-02c: World.rayStaticFirst (terrain DDA + collider BVH) vs raySegmentRay, cost, alloc. Run: node --expose-gc engine/world/rayStatic.test.js
import { World } from './World.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { GIBake, evalSH } from './giBake.js';
import { makeOk } from '../test/assert.js';
import paletteMod from '../../design/palette.js';
import terrainDef from '../../design/levels/overworld_far.js';
import detailPassMod from '../../design/detail-pass.js';
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
import { allocProbe } from '../../tools/allocProbe.mjs';

globalThis.window = globalThis.window || globalThis;
paletteMod; terrainDef; detailPassMod; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; farTowerMod; ferrumLightsMod;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const w = World.load(assets.world('world_m1'), assets, { physics: 'mesh' });
const bb = w.structures[0].bbox, cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
w.prepareStaticRays(cx - 40, cy - 40, cx + 40, cy + 40, 0.5);

let sd = 777; const rnd = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
const N = 500, S = new Float64Array(N * 6), L = [];
for (let i = 0; i < N; i++) { // half around the tower, half over open terrain; <= 1.9 m so raySegmentRay's 0.1 m march is not capped
  const k = i * 6, ax = i & 1 ? cx + (rnd() - 0.5) * 30 : bb.x0 + rnd() * 6, ay = i & 1 ? cy + (rnd() - 0.5) * 30 : cy + rnd() - 0.5;
  const az = (i & 1 ? w.terrain.groundAt(ax, ay) + 0.3 : w.structures[0].origin.z + 1.2) + rnd();
  S[k] = ax; S[k + 1] = ay; S[k + 2] = az;
  S[k + 3] = ax + (rnd() - 0.5) * 3.4; S[k + 4] = ay + (rnd() - 0.5) * 3.4; S[k + 5] = az + (rnd() - 0.5) * 3.4 - (i & 1 ? 0.8 : 0);
}
const io = new Float64Array(12), sg = new Float64Array(6), o = { t: 0, x: 0, y: 0, z: 0 };
const load = (k) => { for (let j = 0; j < 6; j++) sg[j] = S[k + j]; io[0] = sg[0]; io[1] = sg[1]; io[2] = sg[2]; io[3] = sg[3] - sg[0]; io[4] = sg[4] - sg[1]; io[5] = sg[5] - sg[2]; io[6] = 1; };
let bad = 0, hits = 0, mixed = 0, ter = 0, col = 0;
for (let i = 0; i < N; i++) {
  load(i * 6);
  const len = Math.hypot(io[3], io[4], io[5]), a = w.raySegmentRay(sg, o), b = w.rayStaticFirst(io);
  if (a) hits++;
  if (b) { if (io[11] === 1) ter++; else col++; }
  if (a !== b) { bad++; mixed++; if (mixed < 4) console.log('  mismatch', i, a, b, a ? o.t : '', b ? io[7] : '', 'z0', S[i*6+2].toFixed(2), 'g', w.terrain.groundAt(S[i*6], S[i*6+1]).toFixed(2), 'str', !!w.structureAt(S[i*6], S[i*6+1]), 'hitXY struct', a ? !!w.structureAt(o.x, o.y) : '', a ? (o.z - w.terrain.groundAt(o.x,o.y)).toFixed(3) : ''); }
  else if (a && Math.abs(o.t - io[7]) * len > 0.01) { bad++; if (bad < 4) console.log('  dt', i, o.t, io[7], len, 'flag', io[11], 'str', !!w.structureAt(o.x, o.y)); }
}
ok('rayStaticFirst == raySegmentRay on 500 rays (hit/miss, t within 1 cm)', bad <= 2 && hits > 40 && ter > 10 && col > 10, `bad ${bad} hits ${hits} terrain ${ter} collider ${col}`);
{
  load(0); io[6] = 1e-4;
  ok('maxT limits the ray', !w.rayStaticFirst(io));
  // vertical ray straight down hits terrain with an upward unit normal
  const x = cx + 25, y = cy + 25;
  io[0] = x; io[1] = y; io[2] = w.terrain.groundAt(x, y) + 5; io[3] = 0; io[4] = 0; io[5] = -1; io[6] = 20;
  const h = w.rayStaticFirst(io);
  ok('vertical ray: terrain hit, t~5, unit normal up', h && io[11] === 1 && Math.abs(io[7] - 5) < 0.01 && io[10] > 0.5 && Math.abs(Math.hypot(io[8], io[9], io[10]) - 1) < 1e-6, `${io[7]} n ${io[8].toFixed(2)},${io[9].toFixed(2)},${io[10].toFixed(2)}`);
}
{ // speed + alloc
  const run = (n) => { for (let i = 0; i < n; i++) { load((i % N) * 6); w.rayStaticFirst(io); } };
  run(2000);
  const t0 = performance.now(); run(20000); const ms = (performance.now() - t0) / 20000;
  console.log(`  rayStaticFirst ${ms.toFixed(4)} ms/ray`);
  ok(`rayStaticFirst <= 0.02 ms/ray`, ms <= 0.02, `${ms.toFixed(4)} ms (raySegmentRay is ~0.6 ms on the full world)`);
  if (typeof global.gc === 'function') {
    const pr = allocProbe(run, { n: 20000 });
    // ALLOC_EXEMPT: the terrain DDA allocates 0; the residue is bvh.raycastRay's known ~128 B/ray boxed doubles (engine/physics, ASK ARCHITECT in raySegment.test.js)
    ok('rayStaticFirst: alloc <= 130 B/ray (all BVH residue)', pr.perCall <= 130, `${pr.perCall.toFixed(2)} B/call`);
  }
}
{ // a roofed fixture now darkens: GIBake via rayStaticFirst (hit normal from the io, no surfaceAt), roof slab 0.6 m over the probe
  const mk = (roof) => ({
    groundAt: () => 0,
    rayStaticFirst(io) { // flat ground z=0 + optional roof slab z=1.6 (x,y in 2..6, normal down)
      let best = 2, nz = 1, hit = false;
      if (io[5] < 0) { const t = -io[2] / io[5]; if (t >= 0 && t <= io[6]) { best = t; hit = true; } }
      if (roof && io[5] > 0) { const t = (1.6 - io[2]) / io[5], x = io[0] + io[3] * t, y = io[1] + io[4] * t; if (t >= 0 && t <= io[6] && x > 2 && x < 6 && y > 2 && y < 6) { best = t; nz = -1; hit = true; } }
      if (!hit) return false;
      io[7] = best; io[8] = 0; io[9] = 0; io[10] = nz; io[11] = 1; return true;
    },
  });
  const cfg = { x0: 0, y0: 0, w: 1, h: 1, cellM: 8, layerDz: [1], keyHours: [12], sunDir: (h, o) => { o[0] = 0.6; o[1] = 0; o[2] = 0.8; return o; } };
  const vis = (roof) => { const b = new GIBake(mk(roof), cfg); while (!b.step(1000)); return evalSH(b.raw().sky, 0, 0, 0, 1); };
  const open = vis(false), roofed = vis(true);
  ok('roofed fixture darkens vs open (rayStaticFirst path)', open > 0.8 && roofed <= 0.2, `open ${open.toFixed(3)} roofed ${roofed.toFixed(3)}`);
}
console.log(`rayStatic.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log('  FAIL', f); process.exit(1); }
