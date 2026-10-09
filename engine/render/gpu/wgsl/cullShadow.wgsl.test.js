// WG-4b: cullShadow.wgsl.js string rules + layout + helper fns evaluated in JS (wgslProbe) against the CPU twin (instances.js fillShadowBands).
// node engine/render/gpu/wgsl/cullShadow.wgsl.test.js
import assert from 'node:assert/strict';
import { CULL_SHADOW_WGSL, CULL_SHADOW_BLOCK, CULL_SHADOW_BUFFERS } from './cullShadow.wgsl.js';
import { CULL_ARGS_WORDS } from './cull.wgsl.js';
import { WGSL_MODULES } from './index.js';
import { compileFn } from './wgslProbe.js';
import { classifyAABB, CULL_OUT } from '../../../mesh/culling.js';
import { makeInstanceGroup, fillShadowBands, INSTANCE_STRIDE, SHADOW_BAND_HYST_M } from '../../../mesh/instances.js';

// string rules (38.5)
assert.ok(WGSL_MODULES.some((m) => m.name === 'cullShadow' && m.code === CULL_SHADOW_WGSL), 'registered');
assert.ok(!/%|\bround\s*\(|dpdx|dpdy|fwidth|textureSample|texelFetch|gl_|\bmod\s*\(/.test(CULL_SHADOW_WGSL));
assert.ok(/@compute @workgroup_size\(64\)\s*\nfn cs_main\(@builtin\(global_invocation_id\) gid: vec3u\)/.test(CULL_SHADOW_WGSL));
assert.ok(/const STRIDE: u32 = 16u;/.test(CULL_SHADOW_WGSL));
assert.deepEqual(CULL_SHADOW_BUFFERS, ['read', 'rw', 'rw', 'rw', 'rw']);
assert.ok(/@group\(0\) @binding\(0\) var<storage, read> src: array<u32>/.test(CULL_SHADOW_WGSL));
assert.ok(/@group\(0\) @binding\(1\) var<storage, read_write> band: array<u32>/.test(CULL_SHADOW_WGSL));
assert.ok(/@group\(0\) @binding\(4\) var<storage, read_write> args: array<atomic<u32>>/.test(CULL_SHADOW_WGSL));
assert.ok(/@group\(1\) @binding\(0\) var<uniform> u: CullShadowU/.test(CULL_SHADOW_WGSL));
assert.ok(/atomicAdd\(&args\[u\.slot[01] \+ 1u\], 1u\)/.test(CULL_SHADOW_WGSL), 'instanceCount is word +1 of the indirect args slot');
assert.equal(CULL_SHADOW_BLOCK.field('planes').word, 0); assert.equal(CULL_SHADOW_BLOCK.field('eye').word, 24);
assert.equal(CULL_SHADOW_BLOCK.field('count').word, 32); assert.equal(CULL_SHADOW_BLOCK.sizeBytes % 16, 0);
assert.equal(SHADOW_BAND_HYST_M, 2);

// probe: the band update + plane test against fillShadowBands, incl. persistent hysteresis state over a moving eye
let seed = 4242; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const planes = new Float64Array([1, 0, 0, 60, -1, 0, 0, 60, 0, 1, 0, 40, 0, -1, 0, 40, 0, 0, 1, 10, 0, 0, -1, 100]);
const R = 3.5, LOD0 = 25, CAST = 48;
const u = { planes: [], eye: { x: 0, y: 0, z: LOD0, w: CAST }, params: { x: R, y: SHADOW_BAND_HYST_M, z: 0, w: 0 }, swayPad: 0 };
for (let i = 0; i < 6; i++) u.planes.push({ x: planes[i * 4], y: planes[i * 4 + 1], z: planes[i * 4 + 2], w: planes[i * 4 + 3] });
const aabbOutside = compileFn(CULL_SHADOW_WGSL, 'aabbOutside', { u });
const bandUpdate = compileFn(CULL_SHADOW_WGSL, 'bandUpdate', { u });
const N = 3000, g = makeInstanceGroup('trees', N); g.count = N;
const f32 = Math.fround;
for (let i = 0; i < N; i++) g.ib.f32.set([1, 0, 0, f32((rnd() - 0.5) * 140), 0, 1, 0, f32((rnd() - 0.5) * 100), 0, 0, 1, f32(rnd() * 12 - 2)], i * INSTANCE_STRIDE);
const bandGpu = new Uint32Array(N); let kept = 0, band1 = 0;
for (let step = 0; step < 12; step++) {
  const ex = f32(-30 + step * 6.5), ey = f32(step * 1.3 - 8);
  u.eye.x = ex; u.eye.y = ey;
  fillShadowBands(g, ex, ey, LOD0, CAST, planes, R);
  const want0 = [], want1 = [];
  const rowKey = (a, i) => Array.from(a.subarray(i * INSTANCE_STRIDE, (i + 1) * INSTANCE_STRIDE)).join(',');
  const got0 = [], got1 = [];
  for (let i = 0; i < N; i++) {
    const o = i * INSTANCE_STRIDE, tx = g.ib.f32[o + 3], ty = g.ib.f32[o + 7], tz = g.ib.f32[o + 11];
    const dx = tx - u.eye.x, dy = ty - u.eye.y;
    const b = bandUpdate(Math.fround(Math.sqrt(Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy)))), bandGpu[i]);
    bandGpu[i] = b;
    if (b === 2) continue;
    if (aabbOutside(tx, ty, tz)) continue;
    (b ? got1 : got0).push(rowKey(g.ib.u32, i));
  }
  for (let i = 0; i < g.shadowCount[0]; i++) want0.push(rowKey(g.shadowIb[0].u32, i));
  for (let i = 0; i < g.shadowCount[1]; i++) want1.push(rowKey(g.shadowIb[1].u32, i));
  assert.deepEqual(got0.sort(), want0.sort(), 'band 0 set step ' + step);
  assert.deepEqual(got1.sort(), want1.sort(), 'band 1 set step ' + step);
  assert.deepEqual(Array.from(bandGpu), Array.from(g.shadowBand.subarray(0, N)), 'persistent band state step ' + step);
  kept += want0.length + want1.length; band1 += want1.length;
}
assert.ok(kept > 3000 && band1 > 300, `fixture mixes bands: kept ${kept}, band1 ${band1}`);
// direct hysteresis cases
for (const [d, prev, exp] of [[10, 0, 0], [26.9, 0, 0], [27.1, 0, 1], [22.5, 1, 0], [24.5, 1, 1], [49.9, 1, 1], [50.1, 1, 2], [45.5, 2, 1], [46.5, 2, 2], [10, 2, 0], [60, 0, 2]]) {
  const want = (() => { let b = prev; if (b === 2 && d < CAST - 2) b = 1; if (b === 1 && d < LOD0 - 2) b = 0; if (b === 0 && d > LOD0 + 2) b = 1; if (b === 1 && d > CAST + 2) b = 2; return b; })();
  assert.equal(want, exp, `fixture sanity d=${d} prev=${prev}`);
  assert.equal(bandUpdate(d, prev), exp, `band d=${d} prev=${prev}`);
}
// S8-B2-06 swayPad: fillShadowBands(.., swayPad) == the kernel with u.swayPad (sphere grows, bands unchanged)
{
  u.swayPad = 1; u.eye.x = 0; u.eye.y = 0;
  const gp = makeInstanceGroup('trees', N); gp.count = N; gp.ib.f32.set(g.ib.f32.subarray(0, N * INSTANCE_STRIDE));
  const keep = (pad) => { const gg = makeInstanceGroup('t2', N); gg.count = N; gg.ib.f32.set(g.ib.f32.subarray(0, N * INSTANCE_STRIDE)); fillShadowBands(gg, 0, 0, LOD0, CAST, planes, R, pad); return gg.shadowCount[0] + gg.shadowCount[1]; };
  const k0 = keep(0), k1 = keep(1);
  let want = 0; const bd = new Uint32Array(N);
  for (let i = 0; i < N; i++) { const o = i * INSTANCE_STRIDE; const b = bandUpdate(Math.fround(Math.hypot(g.ib.f32[o + 3], g.ib.f32[o + 7])), bd[i]); if (b !== 2 && !aabbOutside(g.ib.f32[o + 3], g.ib.f32[o + 7], g.ib.f32[o + 11])) want++; }
  assert.equal(k1, want, 'padded kernel == padded CPU twin'); assert.ok(k1 > k0, `the pad rescues edge instances (${k0} -> ${k1})`);
  u.swayPad = 0;
}

// ---- ALPHA-01f (d): per-range indirect args, shadow kernel (module side only; passCull.js's slot allocation is host work) ----
// Structural anchors: unlike cull.wgsl.js (two append sites per LOD: plain + dither band), the shadow kernel has exactly ONE
// append site per band, so each bump loop appears exactly once. rangeCount 0/1 is a 0-iteration loop: bit-identical to the
// pre-ALPHA-01f(d) single-record kernel.
assert.equal(CULL_ARGS_WORDS, 5);
assert.ok(/const ARGS_WORDS: u32 = 5u;/.test(CULL_SHADOW_WGSL));
const SRC0_LOOP = /for \(var r = 1u; r < u\.rangeCount0; r\+\+\) \{ atomicAdd\(&args\[u\.slot0 \+ r \* ARGS_WORDS \+ 1u\], 1u\); \}/g;
const SRC1_LOOP = /for \(var r = 1u; r < u\.rangeCount1; r\+\+\) \{ atomicAdd\(&args\[u\.slot1 \+ r \* ARGS_WORDS \+ 1u\], 1u\); \}/g;
assert.equal((CULL_SHADOW_WGSL.match(SRC0_LOOP) || []).length, 1, 'rangeCount0 bump loop at the one band-0 append site');
assert.equal((CULL_SHADOW_WGSL.match(SRC1_LOOP) || []).length, 1, 'rangeCount1 bump loop at the one band-1 append site');
assert.equal(CULL_SHADOW_BLOCK.field('rangeCount0').word, CULL_SHADOW_BLOCK.field('swayPad').word + 1, 'appended after swayPad: earlier word offsets unchanged');
assert.equal(CULL_SHADOW_BLOCK.field('rangeCount1').word, CULL_SHADOW_BLOCK.field('rangeCount0').word + 1);
assert.equal(CULL_SHADOW_BLOCK.sizeBytes % 16, 0);
{
  const mut = CULL_SHADOW_WGSL.replace('for (var r = 1u; r < u.rangeCount0; r++)', 'for (var r = 1u; r < 1u; r++)');
  assert.notEqual(mut, CULL_SHADOW_WGSL, 'mutation anchor found exactly once');
  assert.equal((mut.match(SRC0_LOOP) || []).length, 0, 'mutated text no longer matches the rangeCount0 anchor');
}

// JS kernel executor: a literal transcription of cs_main's band classification + compaction, driven by THIS FILE's own
// compiled aabbOutside/bandUpdate (so a change to those predicates is caught the same way the probes above catch it);
// the per-range bump mirrors the production text exactly (SRC0_LOOP/SRC1_LOOP above).
function runShadowCull(u2, srcF, srcU, count, bandU, dst0U, dst1U, argsU, bump) {
  const aO = compileFn(CULL_SHADOW_WGSL, 'aabbOutside', { u: u2 }), bU = compileFn(CULL_SHADOW_WGSL, 'bandUpdate', { u: u2 });
  let w0 = 0, w1 = 0;
  for (let i = 0; i < count; i++) {
    const o = i * INSTANCE_STRIDE;
    const tx = srcF[o + 3], ty = srcF[o + 7];
    const dx = tx - u2.eye.x, dy = ty - u2.eye.y;
    const b = bU(Math.fround(Math.sqrt(Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy)))), bandU[i]);
    bandU[i] = b;
    if (b === 2) continue;
    const tz = srcF[o + 11];
    if (aO(tx, ty, tz)) continue;
    if (b === 1) {
      const w = argsU[u2.slot1 + 1]++;
      if (bump) for (let r = 1; r < u2.rangeCount1; r++) argsU[u2.slot1 + r * CULL_ARGS_WORDS + 1]++;
      for (let c = 0; c < INSTANCE_STRIDE; c++) dst1U[w * INSTANCE_STRIDE + c] = srcU[o + c];
      w1++;
    } else {
      const w = argsU[u2.slot0 + 1]++;
      if (bump) for (let r = 1; r < u2.rangeCount0; r++) argsU[u2.slot0 + r * CULL_ARGS_WORDS + 1]++;
      for (let c = 0; c < INSTANCE_STRIDE; c++) dst0U[w * INSTANCE_STRIDE + c] = srcU[o + c];
      w0++;
    }
  }
  return [w0, w1];
}

{
  // fresh single-shot classification (prev band 0 for everyone, same starting state as the hysteresis loop's step 0)
  const u2base = { planes: u.planes, eye: { x: 0, y: 0, z: LOD0, w: CAST }, params: { x: R, y: SHADOW_BAND_HYST_M }, swayPad: 0 };
  const srcF = g.ib.f32, srcU = g.ib.u32;
  // CPU reference (same instances.js twin the band/aabb oracle above already uses)
  const gRef = makeInstanceGroup('ref', N); gRef.count = N; gRef.ib.f32.set(srcF.subarray(0, N * INSTANCE_STRIDE));
  fillShadowBands(gRef, 0, 0, LOD0, CAST, planes, R);
  const wantN0 = gRef.shadowCount[0], wantN1 = gRef.shadowCount[1];
  assert.ok(wantN0 > 50 && wantN1 > 50, `fixture mixes both bands: ${wantN0}, ${wantN1}`);
  const rowKey = (a, i) => Array.from(a.subarray(i * INSTANCE_STRIDE, (i + 1) * INSTANCE_STRIDE)).join(',');
  const setOf = (a, n) => { const s = []; for (let i = 0; i < n; i++) s.push(rowKey(a, i)); return s.sort(); };

  // ---- multi-range: rangeCount0 = 2, rangeCount1 = 3, contiguous ARGS_WORDS-apart blocks per band ("slot block of 2*R") ----
  const RC0 = 2, RC1 = 3;
  const slot0 = 0, slot1 = RC0 * CULL_ARGS_WORDS;
  const argsU = new Uint32Array((RC0 + RC1) * CULL_ARGS_WORDS);
  const dst0U = new Uint32Array(N * INSTANCE_STRIDE), dst1U = new Uint32Array(N * INSTANCE_STRIDE);
  const bandU = new Uint32Array(N);
  const u2 = { ...u2base, slot0, slot1, rangeCount0: RC0, rangeCount1: RC1 };
  const [w0, w1] = runShadowCull(u2, srcF, srcU, N, bandU, dst0U, dst1U, argsU, true);
  assert.equal(w0, wantN0, 'band-0 drawn count == CPU reference (fillShadowBands)');
  assert.equal(w1, wantN1, 'band-1 drawn count == CPU reference');
  for (let r = 0; r < RC0; r++) assert.equal(argsU[slot0 + r * CULL_ARGS_WORDS + 1], wantN0, `band-0 range ${r} instanceCount == the shared count`);
  for (let r = 0; r < RC1; r++) assert.equal(argsU[slot1 + r * CULL_ARGS_WORDS + 1], wantN1, `band-1 range ${r} instanceCount == the shared count`);
  assert.deepEqual(setOf(dst0U, w0), setOf(gRef.shadowIb[0].u32, wantN0), 'band-0 drawn set == CPU cull (shared instance buffer, same for every range)');
  assert.deepEqual(setOf(dst1U, w1), setOf(gRef.shadowIb[1].u32, wantN1), 'band-1 drawn set == CPU cull');

  // ---- single-range regression: rangeCount 0 or 1 must be byte-identical whether or not the bump loop runs ----
  for (const [rc0, rc1] of [[1, 1], [0, 0]]) {
    const argsA = new Uint32Array(2 * CULL_ARGS_WORDS), argsB = new Uint32Array(2 * CULL_ARGS_WORDS);
    const d0A = new Uint32Array(N * INSTANCE_STRIDE), d1A = new Uint32Array(N * INSTANCE_STRIDE);
    const d0B = new Uint32Array(N * INSTANCE_STRIDE), d1B = new Uint32Array(N * INSTANCE_STRIDE);
    const bandA = new Uint32Array(N), bandB = new Uint32Array(N);
    const uA = { ...u2base, slot0: 0, slot1: CULL_ARGS_WORDS, rangeCount0: rc0, rangeCount1: rc1 };
    const uB = { ...u2base, slot0: 0, slot1: CULL_ARGS_WORDS, rangeCount0: rc0, rangeCount1: rc1 };
    runShadowCull(uA, srcF, srcU, N, bandA, d0A, d1A, argsA, true);
    runShadowCull(uB, srcF, srcU, N, bandB, d0B, d1B, argsB, false);
    assert.deepEqual(Array.from(argsA), Array.from(argsB), `rangeCount ${rc0},${rc1}: bump on/off byte-identical args`);
    assert.deepEqual(Array.from(d0A), Array.from(d0B), 'dst0 byte-identical'); assert.deepEqual(Array.from(d1A), Array.from(d1B), 'dst1 byte-identical');
    assert.equal(argsA[1], wantN0); assert.equal(argsA[CULL_ARGS_WORDS + 1], wantN1, 'single-range: today\'s one record per band still gets the full count');
  }

  // ---- mutation: "forgot to bump the extra ranges" is caught by the per-range-equal invariant ----
  {
    const argsC = new Uint32Array((RC0 + RC1) * CULL_ARGS_WORDS);
    const d0C = new Uint32Array(N * INSTANCE_STRIDE), d1C = new Uint32Array(N * INSTANCE_STRIDE), bandC = new Uint32Array(N);
    const uC = { ...u2base, slot0, slot1, rangeCount0: RC0, rangeCount1: RC1 };
    runShadowCull(uC, srcF, srcU, N, bandC, d0C, d1C, argsC, false); // bump=false: only range 0 of each band is ever incremented
    assert.equal(argsC[slot0 + 1], wantN0, 'range 0 still gets the real count (it is the atomicAdd that also drives compaction)');
    for (let r = 1; r < RC0; r++) assert.equal(argsC[slot0 + r * CULL_ARGS_WORDS + 1], 0, `pre-fix bug reproduced: band-0 range ${r} stuck at 0 instances`);
    for (let r = 1; r < RC1; r++) assert.equal(argsC[slot1 + r * CULL_ARGS_WORDS + 1], 0, `pre-fix bug reproduced: band-1 range ${r} stuck at 0 instances`);
  }
}
console.log('cullShadow.wgsl.test OK');
