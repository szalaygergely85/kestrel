// engine/mesh/depthTier.test.js - OB-053 (docs/architecture.md 38.49): depth tiers pull the depth TEST of higher tiers forward.
// (1) f32 clip emulation: exact coplanar faces from different matrices flip winner per camera without tiers, never with them.
// (2) rasterJS twin: tier-2 face coplanar with a tier-0 face wins in either draw order; non-coplanar order and written depth unchanged.
// (3) DrawList tier defaults, shader strings. Run: node engine/mesh/depthTier.test.js
import { DrawList, DRAW_STATIC, DRAW_VOXEL, DRAW_INSTANCED } from './DrawList.js';
import { createRasterTarget, rasterDrawList } from './rasterJS.js';
import { StaticMeshBuilder, packFlat1, AO_NONE } from './MeshData.js';
import { KIND_FLOOR, KIND_MODEL, FACE_U } from '../render/GBuffer.js';
import { DEPTH_TIER, PROJ_NEAR, PROJ_FAR } from '../render/projection.js';
import { RASTER_WGSL, RASTER_VOXEL_WGSL, RASTER_INSTANCED_WGSL, RASTER_MASK_WGSL, RASTER_INSTANCED_MASK_WGSL, RASTER_CLOTH_WGSL,
  RASTER_SHADOW_WGSL, RASTER_BLOCK, RASTER_BASE_BLOCK, RASTER_Z_LINE, RASTER_TIER_LINE } from '../render/gpu/wgsl/raster.wgsl.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const f = Math.fround;

// ---- (1) f32 clip emulation, camera-relative origin like passRaster (origin subtracted in f64, then f32 matrices) ----
let seed = 12345;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const NEAR = PROJ_NEAR, FAR = PROJ_FAR, CA = -(FAR + NEAR) / (FAR - NEAR), CB = -2 * FAR * NEAR / (FAR - NEAR);
/** Depth in [0,1] after RASTER_Z_LINE of world point P drawn with a model translation `origin` (local = P - origin), all f32. */
function depthOf(cam, P, origin) {
  const [cx, cy, cz, yaw, pitch] = cam;
  const t = [f(origin[0] - cx), f(origin[1] - cy), f(origin[2] - cz)];
  const wx = f(f(P[0] - origin[0]) + t[0]), wy = f(f(P[1] - origin[1]) + t[1]), wz = f(f(P[2] - origin[2]) + t[2]);
  const cyw = f(Math.cos(yaw)), syw = f(Math.sin(yaw)), cp = f(Math.cos(pitch)), sp = f(Math.sin(pitch));
  const fx = f(cp * cyw), fy = f(cp * syw), fz = sp; // view forward
  const zv = f(-f(f(f(fx * wx) + f(fy * wy)) + f(fz * wz)));
  const zc = f(f(CA * zv) + CB), w = f(-zv);
  return f(f(f(0.5) * f(zc + w)) / w);
}
{
  const N = 500, FRAME_A = [1480.5, 1023.9, 0], FRAME_B = [1481.6, 1024.2, 2.4];
  let flipsNoTier = 0, tierWins = 0, maxDelta = 0, keptN = 0, kept = 0;
  for (let i = 0; i < N; i++) {
    const dist = 1 + rnd() * 299, yaw = rnd() * 6.2832, pitch = (rnd() - 0.5) * 1.2;
    const cam = [1481.85 + rnd() * 3, 1024.30 + rnd() * 3, 4.1 + rnd(), yaw, pitch];
    const P = [Math.round((cam[0] + Math.cos(yaw) * dist) / 0.2) * 0.2, Math.round((cam[1] + Math.sin(yaw) * dist) / 0.2) * 0.2, Math.round((2.4 + rnd() * 0.8) / 0.2) * 0.2];
    const dA = depthOf(cam, P, FRAME_A), dB = depthOf(cam, P, FRAME_B);
    if (dA < dB) flipsNoTier++; // untiered: the level-frame face wins this pixel
    if (f(dB - 2 * DEPTH_TIER) < dA) tierWins++; // tier-2 prop (RASTER_TIER_LINE: z -= tier * DT * w)
    maxDelta = Math.max(maxDelta, Math.abs(dA - dB));
    if (dist <= 20) { // a real 2 cm separation (tier-0 face nearer to the camera) keeps its order
      const nearP = [P[0] - Math.cos(yaw) * 0.02, P[1] - Math.sin(yaw) * 0.02, P[2]];
      keptN++; if (depthOf(cam, nearP, FRAME_A) < f(dB - 2 * DEPTH_TIER)) kept++;
    }
  }
  ok('without tiers some poses make the tier-0 frame win (the flicker)', flipsNoTier >= 1, `${flipsNoTier}/${N}`);
  ok('with tiers the tier-2 face wins on 100% of poses', tierWins === N, `${tierWins}/${N}`);
  ok('measured max |depthA - depthB| < DEPTH_TIER (margin covers f32 clip noise)', maxDelta < DEPTH_TIER, `max=${maxDelta} tier=${DEPTH_TIER}`);
  ok('2 cm real separation at <= 20 m keeps the true order with tier 2', kept === keptN, `${kept}/${keptN}`);
}

// ---- (2) rasterJS twin ----
function quad(id, kind, z) {
  const b = new StaticMeshBuilder(id);
  const mat = b.matIndex('m');
  b.addQuad([-6, -6, z, 6, -6, z, 6, 6, z, -6, 6, z], [0, 0, 1, 0, 1, 1, 0, 1], 0, 0, 1, 0, packFlat1(kind, FACE_U, mat), [0, AO_NONE, 0, 0, 0, 0, 0, 0]);
  return b.build();
}
const M = new Float64Array(16);
M[0] = 1 / 8; M[5] = 1 / 8; M[10] = 0.1; M[14] = -1; M[15] = 1; // same light-style ortho as rasterDepthOnly.test.js
function run(items) { // items: [{mesh, tier}] in draw order
  const l = new DrawList(8); l.begin();
  for (const it of items) { const d = l.push(it.mesh, DRAW_STATIC); d.rangeCount = it.mesh.triCount; d.depthTier = it.tier; }
  const t = createRasterTarget(64, 64, 1);
  rasterDrawList(l, t, { M });
  return t;
}
{
  const floor = quad('floor', KIND_FLOOR, 5), prop = quad('prop', KIND_MODEL, 5), i = 32 * 64 + 32;
  const a = run([{ mesh: floor, tier: 0 }, { mesh: prop, tier: 2 }]), b = run([{ mesh: prop, tier: 2 }, { mesh: floor, tier: 0 }]);
  ok('coplanar tier-2 prop beats tier-0 floor, floor drawn first', a.kind[i] === KIND_MODEL, `kind=${a.kind[i]}`);
  ok('coplanar tier-2 prop beats tier-0 floor, prop drawn first', b.kind[i] === KIND_MODEL, `kind=${b.kind[i]}`);
  const n0 = run([{ mesh: floor, tier: 0 }, { mesh: prop, tier: 0 }]), n1 = run([{ mesh: prop, tier: 0 }, { mesh: floor, tier: 0 }]);
  ok('control: without tiers the winner is draw order (the flicker source)', n0.kind[i] === KIND_FLOOR && n1.kind[i] === KIND_MODEL, `${n0.kind[i]} ${n1.kind[i]}`);
  ok('written depth plane equals the untiered one (only the test moves)', a.depth[i] === n0.depth[i] && b.depth[i] === n1.depth[i], `${a.depth[i]} ${n0.depth[i]}`);
  const nearFloor = quad('nf', KIND_FLOOR, 4.98); // 2 cm nearer to the light: the real order must win even against tier 2
  const c = run([{ mesh: prop, tier: 2 }, { mesh: nearFloor, tier: 0 }]), d = run([{ mesh: nearFloor, tier: 0 }, { mesh: prop, tier: 2 }]);
  const ref = run([{ mesh: prop, tier: 0 }, { mesh: nearFloor, tier: 0 }]);
  ok('non-coplanar (2 cm): nearer tier-0 face still wins, either order', c.kind[i] === KIND_FLOOR && d.kind[i] === KIND_FLOOR, `${c.kind[i]} ${d.kind[i]}`);
  let same = true; for (let k = 0; k < c.depth.length; k++) if (c.depth[k] !== ref.depth[k] || c.kind[k] !== ref.kind[k]) { same = false; break; }
  ok('non-coplanar: depth + kind planes identical with/without tiers', same);
  const l = new DrawList(4); l.begin(); const it = l.push(prop, DRAW_STATIC); it.rangeCount = prop.triCount; it.depthTier = 3;
  const s0 = createRasterTarget(64, 64, 1, { depthOnly: true }), s1 = createRasterTarget(64, 64, 1, { depthOnly: true });
  rasterDrawList(l, s0, { M, depthBias: { factor: 0, units: 0 } }); it.depthTier = 0; rasterDrawList(l, s1, { M, depthBias: { factor: 0, units: 0 } });
  ok('shadow pass (ctx.depthBias) ignores depthTier', s0.zbuf[i] === s1.zbuf[i]);
}

// ---- (3) DrawList defaults ----
{
  const l = new DrawList(4); l.begin();
  const v = l.push(null, DRAW_VOXEL), s = l.push(null, DRAW_STATIC), n = l.push(null, DRAW_INSTANCED);
  ok('push default tiers: voxel 2, static 0, instanced 1', v.depthTier === 2 && s.depthTier === 0 && n.depthTier === 1);
  l.begin(); const r = l.push(null, DRAW_STATIC);
  ok('reused item is reset to its type default', r.depthTier === 0);
}

// ---- shader strings ----
{
  const variants = { RASTER_WGSL, RASTER_VOXEL_WGSL, RASTER_INSTANCED_WGSL, RASTER_MASK_WGSL, RASTER_INSTANCED_MASK_WGSL, RASTER_CLOTH_WGSL };
  for (const [name, code] of Object.entries(variants)) {
    ok(`${name}: tier line directly follows the z line, once`, code.split(RASTER_Z_LINE + '\n  ' + RASTER_TIER_LINE).length === 2 && code.split(RASTER_TIER_LINE).length === 2);
  }
  ok('shadow variant has no tier line', !RASTER_SHADOW_WGSL.includes(RASTER_TIER_LINE));
  ok('tier line uses 2^-21 and scales by w', RASTER_TIER_LINE.includes(DEPTH_TIER.toExponential()) && RASTER_TIER_LINE.endsWith('* o.pos.w;'));
  ok('depthTier fills the hole after projMode: no other offset moves', RASTER_BLOCK.field('depthTier').word === 37 && RASTER_BLOCK.field('flat').word === 38 && RASTER_BLOCK.field('origin').word === 40 && RASTER_BLOCK.sizeBytes === 608 && RASTER_BASE_BLOCK.field('depthTier').word === 37);
}

console.log(`depthTier: ${pass} passed, ${fail} failed`);
if (fail) { for (const m of failures) console.log('  FAIL ' + m); process.exit(1); }
