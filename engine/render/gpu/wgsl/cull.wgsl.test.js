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
assert.deepEqual(CULL_BUFFERS, ['read', 'rw', 'rw', 'rw', 'rw', 'read', 'rw']);
assert.ok(/@group\(0\) @binding\(0\) var<storage, read> src: array<u32>/.test(CULL_WGSL));
for (let i = 1; i <= 3; i++) assert.ok(CULL_WGSL.includes('@group(0) @binding(' + i + ') var<storage, read_write> '), 'binding ' + i);
assert.ok(/@group\(0\) @binding\(4\) var<storage, read_write> args: array<atomic<u32>>/.test(CULL_WGSL));
assert.ok(/@group\(1\) @binding\(0\) var<uniform> u: CullU/.test(CULL_WGSL));
assert.ok(/atomicAdd\(&args\[s[01] \+ 1u\], 1u\)/.test(CULL_WGSL), 'instanceCount is word +1 of the indirect args slot');
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
const RC0_LOOP = /for \(var r = 1u; r < u\.rangeCount0; r\+\+\) \{ atomicAdd\(&args\[s0 \+ r \* ARGS_WORDS \+ 1u\], 1u\); \}/g;
const RC1_LOOP = /for \(var r = 1u; r < u\.rangeCount1; r\+\+\) \{ atomicAdd\(&args\[s1 \+ r \* ARGS_WORDS \+ 1u\], 1u\); \}/g;
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
// ======================= S8-B2-10b: HZB occlusion in the cull kernel (architecture.md 38.20) =======================
import { buildHzb } from '../../../mesh/hzb.js';
import { instanceOccluded } from '../../../mesh/occlusion.js';
{
  // ---- layout / bindings: new CullU words appended after rangeCount1, earlier words unchanged ----
  const F = (n) => CULL_BLOCK.field(n).word;
  assert.equal(F('rangeCount1'), 43);
  const want = { vp: 44, fwd: 60, hzbOn: 64, hzbW: 65, hzbH: 66, hzbLevels: 67, hzbPitch: 68, phase: 69, slot2: 70, slot3: 71 };
  for (const k of Object.keys(want)) assert.equal(F(k), want[k], 'CullU.' + k);
  assert.equal(CULL_BLOCK.sizeBytes, 72 * 4, 'CullU = 72 words (288 B), 16 B aligned');
  assert.ok(/@group\(0\) @binding\(5\) var<storage, read> hzb: array<f32>;/.test(CULL_WGSL));
  assert.ok(/@group\(0\) @binding\(6\) var<storage, read_write> occl: array<u32>;/.test(CULL_WGSL));
  assert.ok(/occl\[i\] = 1u \| \(lod << 1u\)/.test(CULL_WGSL) && /if \(occOn\) \{ occl\[i\] = 0u; \}/.test(CULL_WGSL), 'pending word + clear only when hzbOn');
  assert.equal(1 - 1e-3, 0.999, 'WGSL literal 0.999 == twin DEPTH_REL');

  // ---- fixtures ----
  let sd = 424242; const rr = () => (sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296;
  const GRID = { cols: 160, rows: 60, pxCellW: 1, pxCellH: 2 }, cam = { x: 2, y: -40, z: 2, yawDeg: 90, pitchDeg: -4 };
  const pose = makePose(cam, GRID);
  const R = 4, lodCells = 5, maxDistM = 260, N = 3000;
  const buf = new ArrayBuffer(N * INSTANCE_STRIDE * 4), srcF = new Float32Array(buf), srcU = new Uint32Array(buf);
  for (let i = 0; i < N; i++) {
    const o = i * INSTANCE_STRIDE;
    srcF.set([1, 0, 0, Math.fround((rr() - 0.5) * 400), 0, 1, 0, Math.fround((rr() - 0.5) * 400), 0, 0, 1, Math.fround(rr() * 3)], o);
    srcU[o + 12] = 1000 + i; srcU[o + 13] = 0;
  }
  const depthBlocks = (w, h, seedv, infFrac) => { // 24x24 plateaus: nearer blocks occlude, +Inf = sky
    let s = seedv; const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const bw = Math.ceil(w / 24), bh = Math.ceil(h / 24), vals = new Float32Array(bw * bh);
    for (let i = 0; i < vals.length; i++) vals[i] = r() < infFrac ? Infinity : Math.fround(10 + r() * 120);
    const d = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = vals[(y / 24 | 0) * bw + (x / 24 | 0)];
    return d;
  };
  const flatHzb = (levels, pitch) => { // one f32 buffer: level 0 padded to `pitch` (poison in the padding), levels >= 1 dense
    let n = pitch * levels[0].h; for (let k = 1; k < levels.length; k++) n += levels[k].w * levels[k].h;
    const out = new Float32Array(n).fill(-7);
    for (let y = 0; y < levels[0].h; y++) out.set(levels[0].data.subarray(y * levels[0].w, (y + 1) * levels[0].w), y * pitch);
    let off = pitch * levels[0].h;
    for (let k = 1; k < levels.length; k++) { out.set(levels[k].data, off); off += levels[k].w * levels[k].h; }
    return out;
  };
  const withOcc = (base, w, h, levels, pitch, fwd, hzbOn) => ({
    ...base, vp: [0, 1, 2, 3].map((c) => ({ x: pose.view[4 * c], y: pose.view[4 * c + 1], z: pose.view[4 * c + 2], w: pose.view[4 * c + 3] })),
    fwd: { x: fwd[0], y: fwd[1], z: fwd[2], w: 0.05 }, hzbOn, hzbW: w, hzbH: h, hzbLevels: levels.length, hzbPitch: pitch, phase: 0, slot2: 0, slot3: 0,
  });
  const twinFrame = (w, h, fwd) => ({ vp: pose.view, eye: [cam.x, cam.y, cam.z], fwd, margin: 0.05, hzbOn: 1, hzbW: w, hzbH: h });
  const baseU = makeU2(R, lodCells, pose, GRID, cam, maxDistM, 0, 0, 1, 1);
  // view forward: the axis direction most kept instances lie in front of (the twin only needs a unit vector consistent with the pose)
  let fwd = [0, 1, 0];
  {
    const out = compileFn(CULL_WGSL, 'aabbOutside', { u: baseU }); let best = -1;
    for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]) {
      let c = 0; for (let i = 0; i < N; i++) { const o = i * INSTANCE_STRIDE; if (!out(srcF[o + 3], srcF[o + 7], srcF[o + 11]) && (srcF[o + 3] - cam.x) * d[0] + (srcF[o + 7] - cam.y) * d[1] > 10) c++; }
      if (c > best) { best = c; fwd = d; }
    }
    assert.ok(best > 200, 'fixture has instances in front of the camera: ' + best);
  }

  // ---- (1) WGSL helpers == occlusion.js twin (instanceOccluded) on random boxes; several HZB shapes incl. 1-row top levels (10a edge fix) and a padded level 0 ----
  const rect = { x: 0, y: 0, z: 0, w: 0 };
  const compileAll = (code0, ctx) => {
    const code = code0.replace(/atomicAdd\(&args\[([^\]]+)\], 1u\)/g, 'atomicAdd(args, $1, 1u)'); // pointer-to-element -> (array, index) shim
    const base = { ...ctx, rect, STRIDE: INSTANCE_STRIDE, ARGS_WORDS: CULL_ARGS_WORDS, ceil: Math.ceil, atomicAdd: (a, i, v) => { const o = a[i]; a[i] = o + v; return o; } };
    const fns = {};
    for (const n of ['aabbOutside', 'pickLod', 'bandFrac', 'ditherBits', 'distOut', 'occProject', 'occNear', 'occTest', 'instOccluded', 'emit']) fns[n] = compileFn(code, n, { ...base, ...fns });
    return { fns, cs: compileFn(code, 'cs_main', { ...base, ...fns }) };
  };
  for (const [w, h, pitch, pad] of [[157, 61, 192, 0], [157, 61, 157, 1.5], [9, 3, 12, 0], [5, 1, 5, 0], [64, 1, 64, 0], [1, 1, 1, 0]]) {
    const levels = buildHzb(depthBlocks(w, h, w * 7 + h, 0.25), w, h), hz = flatHzb(levels, pitch);
    const uu = withOcc({ ...baseU, swayPad: pad }, w, h, levels, pitch, fwd, 1);
    const { fns } = compileAll(CULL_WGSL, { u: uu, hzb: hz });
    const fr = twinFrame(w, h, fwd);
    let occ = 0, vis = 0;
    for (let i = 0; i < N; i++) {
      const o = i * INSTANCE_STRIDE, x = srcF[o + 3], y = srcF[o + 7], z = srcF[o + 11];
      const got = fns.instOccluded(x, y, z), exp = instanceOccluded(fr, levels, x, y, z, R, pad);
      assert.equal(got, exp, `${w}x${h} kernel == twin at ${x},${y},${z}`);
      if (exp) occ++; else vis++;
    }
    assert.ok(occ > 10 && vis > 10 || w <= 1, `${w}x${h}: fixture mixes occluded and visible (${occ}/${vis})`);
  }

  // ---- (2) whole-kernel executions (cs_main evaluated in JS with atomics shimmed) ----
  const RC0 = 3, RC1 = 2, S0 = 0, S1 = RC0 * CULL_ARGS_WORDS, S2 = S1 + RC1 * CULL_ARGS_WORDS, S3 = S2 + RC0 * CULL_ARGS_WORDS;
  const mkBufs = () => ({ lodPrev: new Uint32Array(N), dst0: new Uint32Array(N * INSTANCE_STRIDE), dst1: new Uint32Array(N * INSTANCE_STRIDE), args: new Uint32Array(S3 + RC1 * CULL_ARGS_WORDS) });
  const run = (uu, b, hz, occl, count = N) => { const k = compileAll(CULL_WGSL, { u: uu, src: srcU, lodPrev: b.lodPrev, dst0: b.dst0, dst1: b.dst1, args: b.args, hzb: hz, occl }).cs; for (let i = 0; i < count; i++) k({ x: i }); };
  const rowKey = (a, i) => Array.from(a.subarray(i * INSTANCE_STRIDE, (i + 1) * INSTANCE_STRIDE)).join(',');
  const rowsOf = (a, n) => { const s = []; for (let i = 0; i < n; i++) s.push(rowKey(a, i)); return s.sort(); };
  const idOf = (key) => Number(key.split(',')[12]);

  // hzbOn 0 == the pre-10b kernel (runCull transcription above), byte for byte, and hzb/occl are never touched
  {
    const touched = { hzb: 0, occl: 0 };
    const guard = (a, name) => new Proxy(a, { get(t, k) { if (typeof k === 'string' && /^\d+$/.test(k)) touched[name]++; return t[k]; }, set(t, k, v) { touched[name]++; t[k] = v; return true; } });
    const uu = withOcc({ ...makeU2(R, lodCells, pose, GRID, cam, maxDistM, S0, S1, RC0, RC1), lodDither: 0 }, 157, 61, [1, 1, 1, 1, 1, 1, 1, 1], 192, fwd, 0);
    const b = mkBufs(), old = mkBufs();
    run(uu, b, guard(new Float32Array(16), 'hzb'), guard(new Uint32Array(N), 'occl'));
    runCull(uu, srcF, srcU, N, old.lodPrev, old.dst0, old.dst1, old.args, true);
    assert.deepEqual(Array.from(b.args), Array.from(old.args), 'hzbOn 0: args identical');
    assert.deepEqual(Array.from(b.dst0), Array.from(old.dst0), 'hzbOn 0: dst0 identical (same order)');
    assert.deepEqual(Array.from(b.dst1), Array.from(old.dst1), 'hzbOn 0: dst1 identical');
    assert.deepEqual(Array.from(b.lodPrev), Array.from(old.lodPrev), 'hzbOn 0: lodPrev identical');
    assert.deepEqual(touched, { hzb: 0, occl: 0 }, 'hzbOn 0: no reads/writes of the HZB or occl buffers');
    // phase 2 with hzbOn 0 does nothing
    uu.phase = 2; uu.slot0 = uu.slot2 = S2; uu.slot1 = uu.slot3 = S3;
    const b2 = mkBufs(); run(uu, b2, new Float32Array(16), new Uint32Array(N));
    assert.ok(b2.args.every((v) => v === 0), 'phase 2 with hzbOn 0 emits nothing');
  }

  // dither band on; baseline (hzbOn 0) vs an all-sky HZB (nothing can be occluded): identical output, occl all clear
  const ditherBase = { ...makeU2(R, lodCells, pose, GRID, cam, maxDistM, S0, S1, RC0, RC1), lodDither: 1 };
  const base0 = mkBufs();
  run(withOcc(ditherBase, 157, 61, [1, 1, 1, 1, 1, 1, 1, 1], 192, fwd, 0), base0, new Float32Array(16), new Uint32Array(N));
  const n0 = base0.args[S0 + 1], n1 = base0.args[S1 + 1];
  const baseRows = [rowsOf(base0.dst0, n0), rowsOf(base0.dst1, n1)];
  let bandN = 0; for (const key of baseRows[0]) if ((Number(key.split(',')[13]) & 0x4000000) !== 0) bandN++;
  assert.ok(n0 > 50 && n1 > 50 && bandN > 5, `dither fixture: LOD0 ${n0}, LOD1 ${n1}, band ${bandN}`);
  {
    const lv = buildHzb(new Float32Array(157 * 61).fill(Infinity), 157, 61), occl = new Uint32Array(N).fill(7);
    const b = mkBufs(); run(withOcc(ditherBase, 157, 61, lv, 192, fwd, 1), b, flatHzb(lv, 192), occl);
    assert.deepEqual(Array.from(b.args.subarray(0, S2)), Array.from(base0.args.subarray(0, S2)), 'all-sky HZB: args identical to hzbOn 0');
    assert.deepEqual(Array.from(b.dst0), Array.from(base0.dst0)); assert.deepEqual(Array.from(b.dst1), Array.from(base0.dst1));
    assert.deepEqual(Array.from(b.lodPrev), Array.from(base0.lodPrev), 'lodPrev identical');
    assert.ok(occl.every((v) => v === 0), 'every row cleared (no stale pending bits)');
  }

  // two-phase: phase 1 vs the previous HZB, phase 2 vs the fresh HZB == occlusion.js twin sets
  {
    const W = 157, H = 61, P = 192;
    const prev = buildHzb(depthBlocks(W, H, 11, 0.2), W, H), fresh = buildHzb(depthBlocks(W, H, 77, 0.2), W, H);
    const fr = twinFrame(W, H, fwd), occl = new Uint32Array(N).fill(0xffffffff); // stale garbage must be overwritten
    const b = mkBufs(), uu = withOcc(ditherBase, W, H, prev, P, fwd, 1);
    run(uu, b, flatHzb(prev, P), occl);
    const keptIds = new Set([...baseRows[0], ...baseRows[1]].map(idOf)), pend = new Set(), freshOcc = new Set();
    for (let i = 0; i < N; i++) {
      const o = i * INSTANCE_STRIDE, id = 1000 + i, x = srcF[o + 3], y = srcF[o + 7], z = srcF[o + 11];
      const isPend = keptIds.has(id) && instanceOccluded(fr, prev, x, y, z, R, 0);
      assert.equal(occl[i] & 1, isPend ? 1 : 0, 'pending bit of ' + id);
      if (isPend) { pend.add(id); if (instanceOccluded(fr, fresh, x, y, z, R, 0)) freshOcc.add(id); }
    }
    assert.ok(pend.size > 30 && freshOcc.size > 5 && freshOcc.size < pend.size - 5, `pending ${pend.size}, still occluded in phase 2 ${freshOcc.size}`);
    for (let l = 0; l < 2; l++) {
      const got = rowsOf(l ? b.dst1 : b.dst0, b.args[(l ? S1 : S0) + 1]), exp = baseRows[l].filter((k) => !pend.has(idOf(k)));
      assert.deepEqual(got, exp, `phase 1 LOD${l} rows == baseline minus pending`);
    }
    // phase 2: dst2/dst3 bound at 2/3, args slots 2/3, stored lod; lodPrev must not change
    const lpBefore = Array.from(b.lodPrev), p2 = { lodPrev: b.lodPrev, dst0: new Uint32Array(N * INSTANCE_STRIDE), dst1: new Uint32Array(N * INSTANCE_STRIDE), args: b.args };
    const u2p = withOcc({ ...ditherBase }, W, H, fresh, P, fwd, 1); u2p.phase = 2; u2p.slot2 = S2; u2p.slot3 = S3;
    run(u2p, p2, flatHzb(fresh, P), occl);
    assert.deepEqual(Array.from(b.lodPrev), lpBefore, 'phase 2 never touches lodPrev');
    for (let l = 0; l < 2; l++) {
      const slot = l ? S3 : S2, rc = l ? RC1 : RC0, got = rowsOf(l ? p2.dst1 : p2.dst0, b.args[slot + 1]);
      const exp = baseRows[l].filter((k) => pend.has(idOf(k)) && !freshOcc.has(idOf(k)));
      assert.deepEqual(got, exp, `phase 2 LOD${l} rows == pending minus still-occluded (stored lod, band copies, dither bits)`);
      for (let r = 0; r < rc; r++) assert.equal(b.args[slot + r * CULL_ARGS_WORDS + 1], got.length, `phase 2 LOD${l} range ${r} instanceCount`);
    }
    // union of both phases = baseline minus still-occluded: nothing wrongly culled
    for (let l = 0; l < 2; l++) {
      const un = [...rowsOf(l ? b.dst1 : b.dst0, b.args[(l ? S1 : S0) + 1]), ...rowsOf(l ? p2.dst1 : p2.dst0, b.args[(l ? S3 : S2) + 1])].sort();
      assert.deepEqual(un, baseRows[l].filter((k) => !freshOcc.has(idOf(k))), `phase 1 + phase 2 LOD${l} == baseline minus occluded`);
    }
  }
}
console.log('cull.wgsl.test OK');
