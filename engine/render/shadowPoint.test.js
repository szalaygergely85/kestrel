// engine/render/shadowPoint.test.js (ME-16a): point-shadow JS twin. Re-spawns with gc flags for the zero-alloc check.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
const SELF = fileURLToPath(import.meta.url);
const FLAGS = ['--expose-gc', '--max-semi-space-size=64', '--min-semi-space-size=64', '--no-concurrent-recompilation'];
if (typeof global.gc !== 'function' || !process.execArgv.includes(FLAGS[1])) process.exit(spawnSync(process.execPath, [...FLAGS, SELF], { stdio: 'inherit' }).status ?? 1);
const S = await import('./shadowPoint.js');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };

// 1. every face basis is a proper rotation (r x u = f)
for (let f = 0; f < 6; f++) {
  const t = S.FACE_TABLE[f], r = t.r, u = t.u, w = t.f;
  ok(r[1] * u[2] - r[2] * u[1] === w[0] && r[2] * u[0] - r[0] * u[2] === w[1] && r[0] * u[1] - r[1] * u[0] === w[2], 'r x u = f face ' + f);
}
// 2. face pick for 26 directions + seams
let n26 = 0;
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  if (!x && !y && !z) continue; n26++;
  const t = S.FACE_TABLE[S.pointFaceOf(x, y, z)].f, dot = x * t[0] + y * t[1] + z * t[2];
  ok(dot === Math.max(Math.abs(x), Math.abs(y), Math.abs(z)), `pick ${x},${y},${z}`);
}
ok(n26 === 26, '26 dirs');
ok(S.pointFaceOf(1, 1, 1) === 0 && S.pointFaceOf(0, 1, 1) === 2 && S.pointFaceOf(0, -1, -1) === 3, 'tie order X<Y<Z');
ok(S.pointFaceOf(1, 0.999999, 0) === 0 && S.pointFaceOf(0.999999, 1, 0) === 2, 'seam');

// 3. matrix / planes / bounds / depth encoding
const O = [3.25, -2.5, 1.5], far = 6, m16 = new Float64Array(16), pl = new Float64Array(24), bd = new Float64Array(6);
for (let f = 0; f < 6; f++) {
  S.pointFaceMatrix(O, far, f, m16); S.pointFacePlanes(O, far, f, pl); S.pointFaceBounds(O, far, f, bd);
  const t = S.FACE_TABLE[f];
  const p = [0, 1, 2].map((i) => O[i] + t.f[i] * 3 + t.r[i] * 1 + t.u[i] * -2);
  const cx = m16[0] * p[0] + m16[4] * p[1] + m16[8] * p[2] + m16[12], cy = m16[1] * p[0] + m16[5] * p[1] + m16[9] * p[2] + m16[13];
  const cz = m16[2] * p[0] + m16[6] * p[1] + m16[10] * p[2] + m16[14], cw = m16[3] * p[0] + m16[7] * p[1] + m16[11] * p[2] + m16[15];
  ok(Math.abs(cw - 3) < 1e-12 && Math.abs(cx / cw - 1 / 3) < 1e-12 && Math.abs(cy / cw + 2 / 3) < 1e-12, 'ndc xy face ' + f);
  ok(Math.abs((0.75 + 0.25 * cz / cw) - S.pointDepthEncode(3, far)) < 1e-12, 'depth enc face ' + f);
  ok(Math.abs(S.pointDepthDecode(S.pointDepthEncode(3, far), far) - 3) < 1e-9, 'decode');
  ok(Math.abs(S.pointDepthEncode(S.PSH_NEAR, far) - 0.5) < 1e-12 && Math.abs(S.pointDepthEncode(far, far) - 1) < 1e-12, 'depth range [0.5,1]');
  let inside = true; for (let k = 0; k < 6; k++) if (pl[k * 4] * p[0] + pl[k * 4 + 1] * p[1] + pl[k * 4 + 2] * p[2] + pl[k * 4 + 3] < 0) inside = false;
  ok(inside, 'planes contain point face ' + f);
  const back = [0, 1, 2].map((i) => O[i] - t.f[i]); let outside = false;
  for (let k = 0; k < 6; k++) if (pl[k * 4] * back[0] + pl[k * 4 + 1] * back[1] + pl[k * 4 + 2] * back[2] + pl[k * 4 + 3] < 0) outside = true;
  ok(outside, 'planes reject behind face ' + f);
  ok(p[0] >= bd[0] && p[1] >= bd[1] && p[2] >= bd[2] && p[0] <= bd[3] && p[1] <= bd[4] && p[2] <= bd[5], 'bounds contain point');
}

// 4. wall at depth W on every face: round trip + sphere coverage
const res = 64, slot = 1, W = 4, depth = new Float32Array(2 * 6 * res * res).fill(S.pointDepthEncode(W, far));
const P = [0, 0, 0], N = [0, 0, 0], tmp = [0, 0, 0];
const opts = { ...S.POINT_SHADOW_DEFAULTS, biasM: 0.04, normalOffTexels: 0 };
let maxErr = 0;
for (let f = 0; f < 6; f++) for (const [tx, ty] of [[10, 50], [32, 32], [5, 5], [58, 20]]) {
  S.pointFaceTexelToWorld(O, f, res, tx, ty, 2, tmp);
  const v = [tmp[0] - O[0], tmp[1] - O[1], tmp[2] - O[2]], t = S.FACE_TABLE[f];
  ok(S.pointFaceOf(v[0], v[1], v[2]) === f, 'texel centre stays on its face');
  const c = v[0] * t.f[0] + v[1] * t.f[1] + v[2] * t.f[2], a = v[0] * t.r[0] + v[1] * t.r[1] + v[2] * t.r[2], b = v[0] * t.u[0] + v[1] * t.u[1] + v[2] * t.u[2];
  maxErr = Math.max(maxErr, Math.abs(Math.floor((a / c * 0.5 + 0.5) * res) - tx), Math.abs(Math.floor((b / c * 0.5 + 0.5) * res) - ty), Math.abs(c - 2));
}
ok(maxErr === 0, 'texel round trip err ' + maxErr);
let cover = 0, tot = 0;
for (let i = 0; i < 2000; i++) {
  const th = Math.acos(1 - 2 * ((i * 0.618034) % 1)), ph = i * 2.399963;
  const d = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)], m = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
  for (const [k, expect] of [[W * 0.7, 4], [W * 1.3, 0]]) { // major-axis distance k: before / behind the wall
    P[0] = O[0] + d[0] / m * k; P[1] = O[1] + d[1] / m * k; P[2] = O[2] + d[2] / m * k;
    tot++; if (S.pointShadowTaps(depth, res, slot, O, far, P, N, opts) === expect) cover++;
  }
}
ok(cover === tot, `6 faces cover the sphere: ${cover}/${tot}`);
ok(S.pointShadowTaps(depth, res, slot, O, far, [O[0] + 7, O[1], O[2]], N, opts) === 4, 'beyond far -> 4');
ok(S.pointShadowTaps(depth, res, slot, O, far, [O[0] + 0.01, O[1], O[2]], N, opts) === 4, 'inside near -> 4');

// 5. edge clamping: face lit (1.0), neighbouring layers/slot dark (0) -> edge receivers must read only their own face
const lit1 = new Float32Array(depth.length);
for (let f = 0; f < 6; f++) lit1.fill(1, (slot * 6 + f) * res * res, (slot * 6 + f + 1) * res * res);
let clampOk = true;
for (let f = 0; f < 6; f++) for (const e of [-1, 1]) for (const g of [-0.9999, 0, 0.9999]) {
  const t = S.FACE_TABLE[f], c = 3, a = e * c * 0.99999, bb = g * c;
  const p = [0, 1, 2].map((i) => O[i] + t.f[i] * c + t.r[i] * a + t.u[i] * bb);
  if (S.pointShadowTaps(lit1, res, slot, O, far, p, N, opts) !== 4) clampOk = false;
}
ok(clampOk, 'tap clamp stays inside the face');
{
  const d2 = new Float32Array(6 * res * res).fill(1), f = 4;
  d2[(f * res + 31) * res + 31] = 0; // straight up from O: uv centre sits between texels 31/32
  const lit = S.pointShadowTaps(d2, res, 0, O, far, [O[0], O[1], O[2] + 2], N, opts); ok(lit === 3, 'one dark tap -> 3, got ' + lit);
}

// 6. ranking
const MAXL = 16, L = { count: 6, on: new Uint8Array(MAXL).fill(1), pos: new Float32Array(MAXL * 4), col: new Float32Array(MAXL * 4), defX: new Float32Array(MAXL), defY: new Float32Array(MAXL), defZ: new Float32Array(MAXL), entity: new Uint8Array(MAXL) };
for (let i = 0; i < 6; i++) { L.defX[i] = i * 10; L.pos[i * 4 + 3] = 6; L.col[i * 4] = 1; }
const st = S.createShadowLightState(4), cam = { x: 0, y: 0, z: 0 };
S.selectShadowLights(L, cam, 2, st);
ok(st.slots[0] === 0 && st.slots[1] === 1 && st.count === 2, 'initial top-2: ' + [...st.slots]);
let swaps = 0, prev = [st.slots[0], st.slots[1]];
for (let x = 0; x <= 50; x += 0.5) { // walk past a lamp row: ~one handover per lamp, never duplicate holders
  cam.x = x; S.selectShadowLights(L, cam, 2, st);
  if (st.slots[0] !== prev[0]) swaps++; if (st.slots[1] !== prev[1]) swaps++; prev = [st.slots[0], st.slots[1]];
  ok(st.slots[0] !== st.slots[1], 'duplicate holder');
}
ok(swaps <= 8, 'slot stability walking a lamp row, swaps=' + swaps);
cam.x = 5; S.selectShadowLights(L, cam, 2, st); const hold = [st.slots[0], st.slots[1]]; let jit = 0;
for (let i = 0; i < 500; i++) { for (let k = 0; k < 6; k++) L.col[k * 4] = 1 + 0.03 * Math.sin(i * 1.7 + k * 2.1); S.selectShadowLights(L, cam, 2, st); if (st.slots[0] !== hold[0] || st.slots[1] !== hold[1]) jit++; }
ok(jit === 0, 'jitter changes holders: ' + jit);
for (let k = 0; k < 6; k++) L.col[k * 4] = 1;
cam.x = 0; S.selectShadowLights(L, cam, 2, st);
L.defX[4] = 5; L.entity[4] = 1; S.selectShadowLights(L, cam, 2, st); ok(st.slots.includes(4), 'entity light (x2) replaces: ' + [...st.slots]);
L.on[4] = 0; S.selectShadowLights(L, cam, 2, st); ok(!st.slots.includes(4) && st.count === 2, 'off light dropped, slot refilled');

// 7. dirty key
const k0 = new Int32Array(2), k1 = new Int32Array(2), key = (o, ox = 1, oy = 2, oz = 3, r = 6, h0 = 11, h1 = 22, sv = 5, wk = 0) => S.pointShadowKey(o, ox, oy, oz, r, h0, h1, sv, wk);
key(k0); key(k1, 1.004, 1.996, 3.003); ok(k0[0] === k1[0] && k0[1] === k1[1], 'sub-quantum jitter keeps key');
const changed = (...a) => { key(k1, ...a); return k0[0] !== k1[0] || k0[1] !== k1[1]; };
ok(changed(1.05), 'move changes'); ok(changed(1, 2, 3, 7), 'radius changes'); ok(changed(1, 2, 3, 6, 12), 'caster h0'); ok(changed(1, 2, 3, 6, 11, 23), 'caster h1');
ok(changed(1, 2, 3, 6, 11, 22, 6), 'struct'); ok(changed(1, 2, 3, 6, 11, 22, 5, 9), 'sway quantum');
const q = S.resolvePointShadowOptions({ n: 0 }, 'high'); ok(q.n === 0 && q.res === 256 && q.faceCap === 12, 'options');

// 7b. ME-16d ARCH: the encode must equal the ACTUAL shadow caster depth (SHADOW_Z_LINE of raster.wgsl.js, shared with the sun pass), f32, within 1 ULP
{
  const { SHADOW_Z_LINE } = await import('./gpu/wgsl/raster.wgsl.js');
  const shadowZ = new Function('o', SHADOW_Z_LINE), f32 = Math.fround;
  const O = [1.5, -2, 0.25], M = new Float64Array(16), far = 12, ulp = 2 ** -23;
  let worst = 0;
  for (let f = 0; f < 6; f++) {
    S.pointFaceMatrix(O, far, f, M);
    for (let i = 0; i <= 400; i++) {
      const c = S.PSH_NEAR + (far - S.PSH_NEAR) * i / 400, p = [O[0] + S.FACE_TABLE[f].f[0] * c, O[1] + S.FACE_TABLE[f].f[1] * c, O[2] + S.FACE_TABLE[f].f[2] * c];
      const o = { pos: { z: f32(M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]), w: f32(M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15]) } };
      shadowZ(o);
      worst = Math.max(worst, Math.abs(f32(o.pos.z / o.pos.w) - f32(S.pointDepthEncode(c, far))) / ulp);
    }
  }
  ok(worst <= 2, 'z-sweep: caster SHADOW_Z_LINE depth == pointDepthEncode within 2 ULP of 2^-23 (worst ' + worst.toFixed(2) + ')');
  ok(S.pointDepthEncode(S.PSH_NEAR, far) >= 0.5 - 1e-9, 'encode never below 0.5 (the old 0.5+0.5*ndc reached 0)');
  ok(Math.abs(S.pointDepthDecode(S.pointDepthEncode(4, far), far) - 4) < 1e-9, 'decode round trip');
  const src = {}; S.pointCasterOpts(src, 10, { meshLod0M: 18, meshCastM: 40, meshCastCap: 32 });
  ok(src.instCastM === 10 && src.fogFarM === 10 + S.POINT_FOG_MARGIN_M && src.meshLod0M === 18 && src.meshCastM === 40 && src.meshCastCap === 32, 'pointCasterOpts fills the shared fields');
}
// 8. zero alloc
const newUsed = () => { for (const x of v8.getHeapSpaceStatistics()) if (x.space_name === 'new_space') return x.space_used_size; return 0; };
L.on[4] = 1; L.entity[4] = 0; N[2] = 1;
const run = () => {
  for (let i = 0; i < 20; i++) {
    const f = i % 6; S.pointFaceMatrix(O, far, f, m16); S.pointFacePlanes(O, far, f, pl); S.pointFaceBounds(O, far, f, bd);
    P[0] = O[0] + 1 + i * 0.1; P[1] = O[1] + 0.5; P[2] = O[2] - 0.3; S.pointShadowTaps(depth, res, slot, O, far, P, N, opts);
    S.selectShadowLights(L, cam, 2, st); S.pointShadowKey(k1, 1, 2, 3, 6, 11, 22, 5, 0);
  }
};
for (let i = 0; i < 300; i++) run();
global.gc(); const a = newUsed(); for (let i = 0; i < 2000; i++) run(); const bytes = newUsed() - a;
ok(bytes < 16 * 1024, 'alloc bytes over 40000 calls: ' + bytes);
console.log(fails ? `shadowPoint: ${fails} FAILED` : 'shadowPoint: all OK');
process.exit(fails ? 1 : 0);
