// WG-4a: cull.wgsl.js string rules + layout + the helper fns evaluated in JS (wgslProbe) against the CPU twin
// (culling.js classifyAABB, instances.js compactGroup LOD block). node engine/render/gpu/wgsl/cull.wgsl.test.js
import assert from 'node:assert/strict';
import { CULL_WGSL, CULL_BLOCK, CULL_BUFFERS, CULL_WORKGROUP, CULL_ARGS_WORDS } from './cull.wgsl.js';
import { WGSL_MODULES } from './index.js';
import { compileFn } from './wgslProbe.js';
import { classifyAABB, CULL_OUT, frustumPlanes } from '../../../mesh/culling.js';
import { INSTANCE_STRIDE, makeInstanceGroup, compactGroup } from '../../../mesh/instances.js';
import { projTerms, shearProjection } from '../../projection.js';

// string rules (38.5)
assert.ok(WGSL_MODULES.some((m) => m.name === 'cull' && m.code === CULL_WGSL), 'registered');
assert.ok(!/%|\bround\s*\(|dpdx|dpdy|fwidth|textureSample|texelFetch|gl_|\bmod\s*\(/.test(CULL_WGSL));
assert.ok(/@compute @workgroup_size\(64\)\s*\nfn cs_main\(@builtin\(global_invocation_id\) gid: vec3u\)/.test(CULL_WGSL));
assert.equal(CULL_WORKGROUP, 64);
assert.equal(INSTANCE_STRIDE, 16);
assert.ok(/const STRIDE: u32 = 16u;/.test(CULL_WGSL), 'stride interpolated from instances.js');
assert.deepEqual(CULL_BUFFERS, ['read', 'rw', 'rw', 'rw', 'rw']);
assert.ok(/@group\(0\) @binding\(0\) var<storage, read> src: array<u32>/.test(CULL_WGSL));
for (let i = 1; i <= 3; i++) assert.ok(CULL_WGSL.includes('@group(0) @binding(' + i + ') var<storage, read_write> '), 'binding ' + i);
assert.ok(/@group\(0\) @binding\(4\) var<storage, read_write> args: array<atomic<u32>>/.test(CULL_WGSL));
assert.ok(/@group\(1\) @binding\(0\) var<uniform> u: CullU/.test(CULL_WGSL));
assert.ok(/atomicAdd\(&args\[u\.slot[01] \+ 1u\], 1u\)/.test(CULL_WGSL), 'instanceCount is word +1 of the indirect args slot');
assert.equal(CULL_BLOCK.field('planes').word, 0);
assert.equal(CULL_BLOCK.field('eye').word, 24);
assert.equal(CULL_BLOCK.field('count').word, 36);
assert.equal(CULL_BLOCK.sizeBytes % 16, 0);

// probe: helpers against the CPU twin
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const planes = new Float64Array([1, 0, 0, 50, -1, 0, 0, 50, 0, 1, 0, 30, 0, -1, 0, 30, 0, 0, 1, 10, 0, 0, -1, 100]); // an axis-aligned box frustum
const u = { planes: [], eye: { x: 3, y: -4, z: 1, w: 900 }, lodRow: { x: 0.01, y: 0.02, z: 0.03, w: 1 }, params: { x: 2.5, y: 4000, z: 7.2, w: 8.8 }, lodOn: 1, swayPad: 0 };
for (let i = 0; i < 6; i++) u.planes.push({ x: planes[i * 4], y: planes[i * 4 + 1], z: planes[i * 4 + 2], w: planes[i * 4 + 3] });
const aabbOutside = compileFn(CULL_WGSL, 'aabbOutside', { u });
const pickLod = compileFn(CULL_WGSL, 'pickLod', { u });
const distOut = compileFn(CULL_WGSL, 'distOut', { u });
let outs = 0;
for (let i = 0; i < 4000; i++) {
  const x = Math.fround((rnd() - 0.5) * 220), y = Math.fround((rnd() - 0.5) * 120), z = Math.fround((rnd() - 0.5) * 200);
  const R = u.params.x;
  const cpu = classifyAABB(planes, x - R, y - R, z - R, x + R, y + R, z + R) === CULL_OUT;
  assert.equal(aabbOutside(x, y, z), cpu, `aabb ${x},${y},${z}`);
  if (cpu) outs++;
}
assert.ok(outs > 500 && outs < 3500, 'fixture mixes in and out: ' + outs);
// S8-B2-06 swayPad: the sphere grows by the pad (and ONLY the frustum test: params.y / lod stay), twin = classifyAABB with R + pad, compactGroup(.., swayPad)
{
  u.swayPad = 1; let grown = 0;
  const g = makeInstanceGroup('t', 3000); g.count = 3000;
  const rows = [];
  for (let i = 0; i < 3000; i++) {
    const x = Math.fround((rnd() - 0.5) * 220), y = Math.fround((rnd() - 0.5) * 120), z = Math.fround((rnd() - 0.5) * 200);
    g.ib.f32.set([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z], i * INSTANCE_STRIDE); g.ib.u32[i * INSTANCE_STRIDE + 12] = i; rows.push([x, y, z]);
    const R = u.params.x + 1;
    const cpu = classifyAABB(planes, x - R, y - R, z - R, x + R, y + R, z + R) === CULL_OUT;
    assert.equal(aabbOutside(x, y, z), cpu, `padded aabb ${x},${y},${z}`);
    if (cpu === false && classifyAABB(planes, x - u.params.x, y - u.params.x, z - u.params.x, x + u.params.x, y + u.params.x, z + u.params.x) === CULL_OUT) grown++;
  }
  assert.ok(grown > 20, `the pad rescues instances at the frustum edge (${grown})`);
  const keep = (pad) => { compactGroup(g, planes, u.params.x, null, 0, pad); return g.drawCount[0]; };
  const k0 = keep(0), k1 = keep(1);
  assert.equal(k1 - k0, grown, 'compactGroup(swayPad) keeps exactly the rescued instances');
  u.swayPad = 0;
}
// LOD pick incl. hysteresis band and w <= 0
const cwOf = (t) => u.lodRow.x * t[0] + u.lodRow.y * t[1] + u.lodRow.z * t[2] + u.lodRow.w;
for (const [t, prev] of [[[0, 0, 0], 0], [[100, 100, 100], 1], [[-100, -100, -100], 1], [[100, 100, 100], 0], [[-30, -20, 10], 1]]) {
  const cw = cwOf(t), cells = u.params.y / cw;
  const exp = cw > 1e-6 ? (cells < u.params.z ? 1 : cells > u.params.w ? 0 : prev) : 0;
  assert.equal(pickLod(t[0], t[1], t[2], prev), exp, 'lod ' + t);
}
u.lodOn = 0; assert.equal(pickLod(1, 2, 3, 1), 0, 'LOD off -> LOD0'); u.lodOn = 1;
assert.equal(distOut(3, -4, 1 + 30.1), true); assert.equal(distOut(3, -4, 1 + 29.9), false);
u.eye.w = 0; assert.equal(distOut(1e6, 0, 0), false, 'w <= 0 = no distance cull');

// ---- ALPHA-01f (d): per-range indirect args (module side only; passCull.js's slot allocation is host work, not tested here) ----
// Structural anchors: every append site (the plain LOD0/LOD1 branches AND the dither-band branch) bumps EVERY range's
// instanceCount word, ARGS_WORDS apart from the primary slot, right after the atomicAdd that also gives the dst
// compaction index. rangeCount 0/1 is a 0-iteration loop: bit-identical to the pre-ALPHA-01f(d) single-record kernel.
assert.equal(CULL_ARGS_WORDS, 5);
assert.ok(/const ARGS_WORDS: u32 = 5u;/.test(CULL_WGSL));
const RC0_LOOP = /for \(var r = 1u; r < u\.rangeCount0; r\+\+\) \{ atomicAdd\(&args\[u\.slot0 \+ r \* ARGS_WORDS \+ 1u\], 1u\); \}/g;
const RC1_LOOP = /for \(var r = 1u; r < u\.rangeCount1; r\+\+\) \{ atomicAdd\(&args\[u\.slot1 \+ r \* ARGS_WORDS \+ 1u\], 1u\); \}/g;
assert.equal((CULL_WGSL.match(RC0_LOOP) || []).length, 2, 'rangeCount0 bump loop at both LOD0 append sites (dither band + plain)');
assert.equal((CULL_WGSL.match(RC1_LOOP) || []).length, 2, 'rangeCount1 bump loop at both LOD1 append sites (dither band + plain)');
assert.equal(CULL_BLOCK.field('rangeCount0').word, CULL_BLOCK.field('swayPad').word + 1, 'appended after swayPad: earlier word offsets unchanged');
assert.equal(CULL_BLOCK.field('rangeCount1').word, CULL_BLOCK.field('rangeCount0').word + 1);
assert.equal(CULL_BLOCK.sizeBytes % 16, 0);
// mutation: the structural anchor is not vacuous - a "forgot to read rangeCount0" bug (hardcoded 1-range loop bound)
// makes the real production text stop matching it.
{
  const mut = CULL_WGSL.replaceAll('for (var r = 1u; r < u.rangeCount0; r++)', 'for (var r = 1u; r < 1u; r++)');
  assert.notEqual(mut, CULL_WGSL, 'mutation anchor found exactly once');
  assert.equal((mut.match(RC0_LOOP) || []).length, 0, 'mutated text no longer matches the rangeCount0 anchor');
}

// JS kernel executor (plain LOD0/LOD1 branches; dither stays off in this fixture - S8-B2-07 already covers the band
// branch and it bumps ranges with the identical loop). A literal transcription of cs_main's compaction, driven by
// THIS FILE's own compiled aabbOutside/pickLod/distOut (a change to those predicates is caught the same way the
// probes above catch it); the per-range bump itself mirrors the production text exactly (RC0_LOOP/RC1_LOOP above).
function runCull(u2, srcF, srcU, count, lodPrevU, dst0U, dst1U, argsU, bump) {
  const aO = compileFn(CULL_WGSL, 'aabbOutside', { u: u2 }), pL = compileFn(CULL_WGSL, 'pickLod', { u: u2 }), dO = compileFn(CULL_WGSL, 'distOut', { u: u2 });
  let w0 = 0, w1 = 0;
  for (let i = 0; i < count; i++) {
    const o = i * INSTANCE_STRIDE;
    const tx = srcF[o + 3], ty = srcF[o + 7], tz = srcF[o + 11];
    if (aO(tx, ty, tz)) continue;
    const lod = pL(tx, ty, tz, lodPrevU[i]); lodPrevU[i] = lod;
    if (dO(tx, ty, tz)) continue;
    if (lod === 1) {
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

// fixture: a bench-like pose (same construction as passCull.test.js) so the LOD split matches compactGroup exactly
function makePose(cam, grid) {
  const terms = {}, view = new Float64Array(16), pl = new Float64Array(24);
  projTerms(cam, grid, terms); shearProjection(terms, view); frustumPlanes(view, pl);
  return { view, planes: pl };
}
function makeU2(R, lodCells, pose, grid, eye, maxDistM, slot0, slot1, rangeCount0, rangeCount1) {
  const vp = pose.view, pl = pose.planes;
  const planesArr = []; for (let i = 0; i < 6; i++) planesArr.push({ x: pl[i * 4], y: pl[i * 4 + 1], z: pl[i * 4 + 2], w: pl[i * 4 + 3] });
  return {
    planes: planesArr, eye: { x: eye.x, y: eye.y, z: eye.z, w: maxDistM > 0 ? maxDistM * maxDistM : 0 },
    lodRow: { x: vp[3], y: vp[7], z: vp[11], w: vp[15] },
    params: { x: R, y: R * Math.sqrt(vp[1] * vp[1] + vp[5] * vp[5] + vp[9] * vp[9]) * grid.rows, z: lodCells * 0.9, w: lodCells * 1.1 },
    lodOn: 1, swayPad: 0, slot0, slot1, rangeCount0, rangeCount1,
  };
}
{
  const GRID = { cols: 160, rows: 60, pxCellW: 1, pxCellH: 2 }, cam = { x: 2, y: -40, z: 2, yawDeg: 90, pitchDeg: -4 };
  const pose = makePose(cam, GRID);
  const R = 15, lodCells = 14, maxDistM = 260;
  const N = 3000;
  let s2 = 999; const rnd2 = () => (s2 = (s2 * 1664525 + 1013904223) >>> 0) / 4294967296;
  const buf = new ArrayBuffer(N * INSTANCE_STRIDE * 4);
  const srcF = new Float32Array(buf), srcU = new Uint32Array(buf);
  const g = makeInstanceGroup('t', N); g.lodCells = lodCells; g.count = N;
  for (let i = 0; i < N; i++) {
    const o = i * INSTANCE_STRIDE;
    const x = Math.fround((rnd2() - 0.5) * 400), y = Math.fround((rnd2() - 0.5) * 400), z = Math.fround(rnd2() * 3);
    const row = [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
    srcF.set(row, o); srcU[o + 12] = 1000 + i; srcU[o + 13] = 0;
    g.ib.f32.set(row, o); g.ib.u32[o + 12] = 1000 + i; g.ib.u32[o + 13] = 0;
  }
  // CPU reference (same instances.js twin the camera-cull oracle already uses; compactGroup has no distance test -
  // "the twin applies the same test after compactGroup", same as passCull.test.js's oracle)
  compactGroup(g, pose.planes, R, pose.view, GRID.rows);
  const md2 = maxDistM * maxDistM;
  const wantRows = [[], []];
  for (let l = 0; l < 2; l++) for (let i = 0; i < g.drawCount[l]; i++) {
    const o = i * INSTANCE_STRIDE, f = g.drawIb[l].f32;
    const dx = f[o + 3] - cam.x, dy = f[o + 7] - cam.y, dz = f[o + 11] - cam.z;
    if (dx * dx + dy * dy + dz * dz > md2) continue;
    wantRows[l].push(Array.from(g.drawIb[l].u32.subarray(o, o + INSTANCE_STRIDE)).join(','));
  }
  const wantN0 = wantRows[0].length, wantN1 = wantRows[1].length;
  assert.ok(wantN0 > 50 && wantN1 > 50, `fixture mixes both LODs: ${wantN0}, ${wantN1}`);

  // ---- multi-range: rangeCount0 = 3, rangeCount1 = 2, contiguous ARGS_WORDS-apart blocks per LOD ("slot block of 2*R") ----
  const RC0 = 3, RC1 = 2;
  const slot0 = 0, slot1 = RC0 * CULL_ARGS_WORDS;
  const argsU = new Uint32Array((RC0 + RC1) * CULL_ARGS_WORDS);
  const dst0U = new Uint32Array(N * INSTANCE_STRIDE), dst1U = new Uint32Array(N * INSTANCE_STRIDE);
  const lodPrevU = new Uint32Array(N);
  const u2 = makeU2(R, lodCells, pose, GRID, cam, maxDistM, slot0, slot1, RC0, RC1);
  const [w0, w1] = runCull(u2, srcF, srcU, N, lodPrevU, dst0U, dst1U, argsU, true);
  assert.equal(w0, wantN0, 'LOD0 drawn count == CPU reference (compactGroup)');
  assert.equal(w1, wantN1, 'LOD1 drawn count == CPU reference');
  for (let r = 0; r < RC0; r++) assert.equal(argsU[slot0 + r * CULL_ARGS_WORDS + 1], wantN0, `LOD0 range ${r} instanceCount == the shared count`);
  for (let r = 0; r < RC1; r++) assert.equal(argsU[slot1 + r * CULL_ARGS_WORDS + 1], wantN1, `LOD1 range ${r} instanceCount == the shared count`);
  const rowKey = (a, i) => Array.from(a.subarray(i * INSTANCE_STRIDE, (i + 1) * INSTANCE_STRIDE)).join(',');
  const setOf = (a, n) => { const s = []; for (let i = 0; i < n; i++) s.push(rowKey(a, i)); return s.sort(); };
  assert.deepEqual(setOf(dst0U, w0), wantRows[0].slice().sort(), 'LOD0 drawn set == CPU cull (shared instance buffer, same for every range)');
  assert.deepEqual(setOf(dst1U, w1), wantRows[1].slice().sort(), 'LOD1 drawn set == CPU cull');

  // ---- single-range regression: rangeCount 0 or 1 must be byte-identical whether or not the bump loop runs (0 iterations either way) ----
  for (const [rc0, rc1] of [[1, 1], [0, 0]]) {
    const argsA = new Uint32Array(2 * CULL_ARGS_WORDS), argsB = new Uint32Array(2 * CULL_ARGS_WORDS);
    const d0A = new Uint32Array(N * INSTANCE_STRIDE), d1A = new Uint32Array(N * INSTANCE_STRIDE);
    const d0B = new Uint32Array(N * INSTANCE_STRIDE), d1B = new Uint32Array(N * INSTANCE_STRIDE);
    const lpA = new Uint32Array(N), lpB = new Uint32Array(N);
    const uA = makeU2(R, lodCells, pose, GRID, cam, maxDistM, 0, CULL_ARGS_WORDS, rc0, rc1);
    const uB = makeU2(R, lodCells, pose, GRID, cam, maxDistM, 0, CULL_ARGS_WORDS, rc0, rc1);
    runCull(uA, srcF, srcU, N, lpA, d0A, d1A, argsA, true);
    runCull(uB, srcF, srcU, N, lpB, d0B, d1B, argsB, false);
    assert.deepEqual(Array.from(argsA), Array.from(argsB), `rangeCount ${rc0},${rc1}: bump on/off byte-identical args`);
    assert.deepEqual(Array.from(d0A), Array.from(d0B), 'dst0 byte-identical'); assert.deepEqual(Array.from(d1A), Array.from(d1B), 'dst1 byte-identical');
    assert.equal(argsA[1], wantN0); assert.equal(argsA[CULL_ARGS_WORDS + 1], wantN1, 'single-range: today\'s one record per LOD still gets the full count');
  }

  // ---- mutation: "forgot to bump the extra ranges" (the exact bug ALPHA-01f (d) fixes) is caught by the per-range-equal invariant ----
  {
    const argsC = new Uint32Array((RC0 + RC1) * CULL_ARGS_WORDS);
    const d0C = new Uint32Array(N * INSTANCE_STRIDE), d1C = new Uint32Array(N * INSTANCE_STRIDE), lpC = new Uint32Array(N);
    const uC = makeU2(R, lodCells, pose, GRID, cam, maxDistM, slot0, slot1, RC0, RC1);
    runCull(uC, srcF, srcU, N, lpC, d0C, d1C, argsC, false); // bump=false: only range 0 of each LOD is ever incremented
    assert.equal(argsC[slot0 + 1], wantN0, 'range 0 still gets the real count (it is the atomicAdd that also drives compaction)');
    for (let r = 1; r < RC0; r++) assert.equal(argsC[slot0 + r * CULL_ARGS_WORDS + 1], 0, `pre-fix bug reproduced: LOD0 range ${r} stuck at 0 instances`);
    for (let r = 1; r < RC1; r++) assert.equal(argsC[slot1 + r * CULL_ARGS_WORDS + 1], 0, `pre-fix bug reproduced: LOD1 range ${r} stuck at 0 instances`);
    assert.ok(wantN0 > 0 && wantN1 > 0, 'the bug is only visible because the fixture actually draws something');
  }
}
console.log('cull.wgsl.test OK');
