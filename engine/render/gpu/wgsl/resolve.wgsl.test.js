// WG-3a: resolve.wgsl.js string rules + layout + the fs_main body evaluated in JS (wgslProbe) against an independent
// JS implementation of the normative vote rule (docs/architecture.md 14.2 item 3). node engine/render/gpu/wgsl/resolve.wgsl.test.js
import assert from 'node:assert/strict';
import { RESOLVE_WGSL, RESOLVE_BLOCK, RESOLVE_TEXTURES, RESOLVE_TARGETS } from './resolve.wgsl.js';
import { WGSL_MODULES } from './index.js';
import { compileFn, makeTex, textureLoad, shims } from './wgslProbe.js';
import { MAX_SUB } from './resolve.wgsl.js';
import { resolveCellJS } from '../../resolveBand.js';

// string rules (38.5)
assert.ok(WGSL_MODULES.some((m) => m.name === 'resolve' && m.code === RESOLVE_WGSL), 'registered');
assert.ok(!/%|\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample|texelFetch|gl_FragCoord|\bmod\s*\(/.test(RESOLVE_WGSL));
assert.ok(/fn vs_main/.test(RESOLVE_WGSL) && /fn fs_main\(@builtin\(position\) frag: vec4f\)/.test(RESOLVE_WGSL));
assert.equal(MAX_SUB, 16);
assert.ok(/array<u32, 16>/.test(RESOLVE_WGSL) && /const MAX_SUB: i32 = 16;/.test(RESOLVE_WGSL), 'constant interpolated from the GLSL module');
assert.deepEqual(RESOLVE_TEXTURES, ['uint', 'uint', 'uint', 'uint', 'uint']);
assert.deepEqual(RESOLVE_TARGETS, ['rgba32uint', 'rgba32uint', 'r32uint']);
for (let i = 0; i < 4; i++) assert.ok(new RegExp('@group\\(0\\) @binding\\(' + i + '\\) var \\w+: texture_2d<u32>').test(RESOLVE_WGSL), 'binding ' + i);
assert.ok(/@group\(1\) @binding\(0\) var<uniform> u: ResolveU/.test(RESOLVE_WGSL));
assert.ok(/@location\(0\) gi: vec4u/.test(RESOLVE_WGSL) && /@location\(1\) ga: vec4u/.test(RESOLVE_WGSL) && /@location\(2\) depth: vec4u/.test(RESOLVE_WGSL));
assert.equal(RESOLVE_BLOCK.sizeBytes, 144, 'n,bandM,histValid,pad + 7 vec4 + 4 ints (AA-04b)');
assert.equal(RESOLVE_BLOCK.field('n').word, 0);
assert.ok(/ivec2|uvec/.test(RESOLVE_WGSL) === false, 'no GLSL type names');

// JS oracle: the normative vote rule written independently (groups via Map, not the GLSL loop structure).
function oracle(n, subs, mask) {
  // subs: n*n entries {pid, y, depthBits, ga, ...} in scan order (index = j*n + i)
  const key = (s) => `${s.y & 0xff}|${s.x}|${(s.y >>> 16) & 0xffff}`;
  const buf = new Float32Array(1), bits = new Uint32Array(buf.buffer);
  const depthOf = (s) => { bits[0] = s.d; return buf[0]; };
  const groups = new Map();
  subs.forEach((s, idx) => {
    const g = groups.get(key(s)) || { count: 0, minD: 1e30, first: idx };
    g.count++; g.minD = Math.min(g.minD, depthOf(s));
    groups.set(key(s), g);
  });
  let win = null;
  for (const g of groups.values()) { // Map iterates in first-seen (scan) order
    if (!win || g.count > win.count || (g.count === win.count && g.minD < win.minD)) win = g;
  }
  const wkey = [...groups].find(([, g]) => g === win)[0];
  let nearest = -1, best = Infinity;
  subs.forEach((s, a) => {
    if (key(s) !== wkey) return;
    const ox = ((a % n) + 0.5) / n - 0.5, oy = (Math.floor(a / n) + 0.5) / n - 0.5;
    const mag = ox * ox + oy * oy;
    if (mag < best) { best = mag; nearest = a; }
  });
  const w = subs[nearest], kind = w.y & 0xff;
  if (kind === 0) return { gi: [0, (mask << 12) >>> 0, 0, 0], ga: [0, 0, 0, 0], depth: 0x7f800000 };
  const cov = Math.min(7, Math.max(0, Math.trunc(win.count * 8 / (n * n) - 1)));
  const y = (kind | (((w.y >>> 8) & 0xf) << 8) | (mask << 12) | (cov << 13) | (((w.y >>> 16) & 0xffff) << 16)) >>> 0;
  return { gi: [w.x, y, w.z, w.w], ga: w.ga, depth: w.d };
}

const fsMain = (tex) => compileFn(RESOLVE_WGSL, 'fs_main', { textureLoad, uHist: makeTex(1, 1, [[0, 0, 0, 0]]), ...tex, u: { histValid: 0, ...tex.u }, MAX_SUB, ...shims },
  'const MAX_SUB_ = 16;', ['farPick', 'finish', 'rg4i', 'rg4j', 'bayer4', 'bandThreshold', 'reprojectCell']);
let seed = 1234;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
const f32u = (u) => { const b = new Uint32Array([u]); return new Float32Array(b.buffer)[0]; };
const f2u = (() => { const f = new Float32Array(1), u = new Uint32Array(f.buffer); return (x) => { f[0] = x; return u[0]; }; })();
let probes = 0;
for (let round = 0; round < 80; round++) for (let n = 1; n <= 4; n++) {
  const cols = 3, rows = 2;
  const sw = cols * n, sh = rows * n;
  const sgi = [], sga = [], sdp = [], mask = [];
  const sampleAt = [];
  for (let i = 0; i < sw * sh; i++) {
    // few distinct keys so ties and multi-way votes occur; kind 0 (sky) included
    const kind = [0, 1, 2, 4, 7][Math.floor(rand() * 5)], pid = Math.floor(rand() * 3) | 0;
    const mat = Math.floor(rand() * 3), face = Math.floor(rand() * 6);
    const y = (kind | (face << 8) | (mat << 16) | (mat > 1 ? 0xf000 : 0)) >>> 0; // stray mask/cov bits must be ignored by the key? (kept in y, not in key)
    const d = f2u(Math.fround(rand() < 0.3 ? 5 : 1 + rand() * 20));
    const s = { x: kind ? pid : 0, y, z: Math.floor(rand() * 1e9), w: Math.floor(rand() * 1e6), d, ga: [f2u(rand()), f2u(rand()), f2u(rand() * 10), f2u(rand())] };
    sampleAt.push(s);
    sgi.push([s.x, s.y, s.z, s.w]); sga.push(s.ga); sdp.push([s.d, 0, 0, 0]);
  }
  for (let i = 0; i < cols * rows; i++) mask.push([rand() < 0.5 ? 1 : 0, 0, 0, 0]);
  const run = fsMain({ uSGI: makeTex(sw, sh, sgi), uSGA: makeTex(sw, sh, sga), uSDepth: makeTex(sw, sh, sdp), uMask: makeTex(cols, rows, mask), u: { n, bandM: 0, histValid: 0 } });
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const subs = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) subs.push(sampleAt[(cy * n + j) * sw + cx * n + i]);
    const m = mask[cy * cols + cx][0];
    // The key must not contain face/mask/cov bits: oracle key uses kind+pid+mat only (see key()).
    const o = run({ x: cx + 0.5, y: cy + 0.5 });
    const e = oracle(n, subs, m);
    const gi = [o.gi.x >>> 0, o.gi.y >>> 0, o.gi.z >>> 0, o.gi.w >>> 0];
    assert.deepEqual(gi, e.gi.map((v) => v >>> 0), `GI n=${n} cell ${cx},${cy}`);
    assert.deepEqual([o.ga.x, o.ga.y, o.ga.z, o.ga.w].map((v) => v >>> 0), e.ga.map((v) => v >>> 0), `GA n=${n}`);
    assert.equal(o.depth.x >>> 0, e.depth >>> 0, `DEPTH n=${n}`);
    probes++;
  }
}
// n = 1 is a straight copy (US-030a parity): cov = clamp(8/1 - 1) = 7
{
  const run = fsMain({ uSGI: makeTex(1, 1, [[5, (3 | (2 << 8) | (9 << 16)) >>> 0, 77, 88]]), uSGA: makeTex(1, 1, [[1, 2, 3, 4]]), uSDepth: makeTex(1, 1, [[f2u(2.5), 0, 0, 0]]), uMask: makeTex(1, 1, [[1, 0, 0, 0]]), u: { n: 1, bandM: 40 } }); // bandM is ignored below n = 4
  const o = run({ x: 0.5, y: 0.5 });
  assert.deepEqual([o.gi.x, o.gi.y >>> 0, o.gi.z, o.gi.w], [5, (3 | (2 << 8) | (1 << 12) | (7 << 13) | (9 << 16)) >>> 0, 77, 88]);
  assert.deepEqual([o.ga.x, o.ga.y, o.ga.z, o.ga.w], [1, 2, 3, 4]);
  assert.equal(o.depth.x, f2u(2.5));
}
// RTX-RAYS-BAND-01 (38.79): n = 4 with bandM 0 / 40 / 5, WGSL (probe) == JS twin resolveCellJS, exact (GI/GA/DEPTH words).
assert.equal(RESOLVE_BLOCK.field('bandM').word, 1);
let bandCells = 0, farCells = 0;
{
  const cols = 8, rows = 6, n = 4, sw = cols * n, sh = rows * n;
  const out = { idx: 0, cov: 0, far: false };
  for (const bandM of [0, 40, 5]) for (let round = 0; round < 24; round++) {
    const sgi = [], sga = [], sdp = [], mask = [], at = [];
    const lowDepth = round % 3 === 0; // some rounds are all-near so the 16-sample path is exercised under bandM > 0
    for (let i = 0; i < sw * sh; i++) {
      const kind = [0, 1, 2, 4, 7][Math.floor(rand() * 5)], pid = Math.floor(rand() * 2), mat = Math.floor(rand() * 2), face = Math.floor(rand() * 6);
      const y = (kind | (face << 8) | (mat << 16)) >>> 0;
      const d = Math.fround(rand() < 0.2 ? 30 : lowDepth ? 1 + rand() * 4 : 1 + rand() * 90);
      const smp = { x: kind ? pid : 0, y, z: Math.floor(rand() * 1e9), w: Math.floor(rand() * 1e6), d: f2u(d), ga: [f2u(rand()), f2u(rand()), f2u(rand() * 10), f2u(rand())], df: d };
      at.push(smp); sgi.push([smp.x, smp.y, smp.z, smp.w]); sga.push(smp.ga); sdp.push([smp.d, 0, 0, 0]);
    }
    for (let i = 0; i < cols * rows; i++) mask.push([rand() < 0.5 ? 1 : 0, 0, 0, 0]);
    const run = fsMain({ uSGI: makeTex(sw, sh, sgi), uSGA: makeTex(sw, sh, sga), uSDepth: makeTex(sw, sh, sdp), uMask: makeTex(cols, rows, mask), u: { n, bandM, histValid: 0 } });
    const sub = { pid: new Int32Array(16), kind: new Uint32Array(16), mat: new Uint32Array(16), depth: new Float32Array(16) };
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const smp = at[(cy * 4 + j) * sw + cx * 4 + i], k = j * 4 + i;
        sub.pid[k] = smp.x; sub.kind[k] = smp.y & 0xff; sub.mat[k] = (smp.y >>> 16) & 0xffff; sub.depth[k] = smp.df;
      }
      resolveCellJS(sub, n, bandM, cx, cy, out);
      const w = at[(cy * 4 + (out.idx >> 2)) * sw + cx * 4 + (out.idx & 3)], m = mask[cy * cols + cx][0], kind = w.y & 0xff;
      const e = kind === 0 ? { gi: [0, (m << 12) >>> 0, 0, 0], ga: [0, 0, 0, 0], depth: 0x7f800000 }
        : { gi: [w.x, (kind | (((w.y >>> 8) & 0xf) << 8) | (m << 12) | (out.cov << 13) | (((w.y >>> 16) & 0xffff) << 16)) >>> 0, w.z, w.w], ga: w.ga, depth: w.d };
      const o = run({ x: cx + 0.5, y: cy + 0.5 });
      const tag = `bandM=${bandM} cell ${cx},${cy} round ${round}`;
      assert.deepEqual([o.gi.x, o.gi.y, o.gi.z, o.gi.w].map((v) => v >>> 0), e.gi.map((v) => v >>> 0), 'GI ' + tag);
      assert.deepEqual([o.ga.x, o.ga.y, o.ga.z, o.ga.w].map((v) => v >>> 0), e.ga.map((v) => v >>> 0), 'GA ' + tag);
      assert.equal(o.depth.x >>> 0, e.depth >>> 0, 'DEPTH ' + tag);
      bandCells++; if (out.far) farCells++;
    }
  }
}
assert.ok(bandCells >= 3000 && farCells > 100, `band probe coverage ${bandCells} cells, ${farCells} far`);
console.log(`resolve.wgsl.test.js: band probe ${bandCells} cells (${farCells} far path) WGSL == JS twin.`);
// AA-04b (38.82 B): hysteresis on (histValid 1), identity camera (prev == cur, dEye 0 -> the cell reprojects onto itself): WGSL (probe)
// == resolveCellJS(..., histKey) with the key read from a random HIST texture; and histValid 0 == the plain vote (byte-identical).
let hystCells = 0, hystKept = 0;
{
  const cols = 6, rows = 4, n = 4, sw = cols * n, sh = rows * n, tan = 0.8;
  const termsU = { histValid: 1, curA: { x: 0, y: 1, z: 0, w: tan }, curB: { x: 1, y: 0, z: 0, w: 0 }, curC: { x: 1, y: tan * 0.5, z: 0, w: 0 },
    dEye: { x: 0, y: 0, z: 0, w: 0 }, gridCols: cols, gridRows: rows, ortho: 0 };
  termsU.prevA = termsU.curA; termsU.prevB = termsU.curB; termsU.prevC = termsU.curC;
  const out = { idx: 0, cov: 0, far: false }, out0 = { idx: 0, cov: 0, far: false };
  for (let round = 0; round < 40; round++) {
    const sgi = [], sga = [], sdp = [], mask = [], at = [];
    for (let i = 0; i < sw * sh; i++) {
      const kind = [0, 1, 1, 2][Math.floor(rand() * 4)], pid = Math.floor(rand() * 2), mat = Math.floor(rand() * 3);
      const smp = { x: pid, y: (kind | (mat << 16)) >>> 0, z: 1, w: 2, d: f2u(Math.fround(1 + rand() * 8)), ga: [f2u(rand()), f2u(rand()), f2u(rand()), f2u(rand())] };
      at.push(smp); sgi.push([smp.x, smp.y, smp.z, smp.w]); sga.push(smp.ga); sdp.push([smp.d, 0, 0, 0]);
    }
    for (let i = 0; i < cols * rows; i++) mask.push([0, 0, 0, 0]);
    const hk = [], hist = [];
    for (let i = 0; i < cols * rows; i++) { const kind = [0, 1, 2][Math.floor(rand() * 3)], pid = Math.floor(rand() * 2), mat = Math.floor(rand() * 3); hk.push({ kind, pid, mat }); hist.push([pid, 0, 0, (4 | (kind << 8) | (mat << 16)) >>> 0]); }
    const base = { uSGI: makeTex(sw, sh, sgi), uSGA: makeTex(sw, sh, sga), uSDepth: makeTex(sw, sh, sdp), uMask: makeTex(cols, rows, mask), uHist: makeTex(cols, rows, hist) };
    const run = fsMain({ ...base, u: { n, bandM: 0, ...termsU } }), run0 = fsMain({ ...base, u: { n, bandM: 0, ...termsU, histValid: 0 } });
    const sub = { pid: new Int32Array(16), kind: new Uint32Array(16), mat: new Uint32Array(16), depth: new Float32Array(16) };
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const smp = at[(cy * 4 + j) * sw + cx * 4 + i], k = j * 4 + i;
        sub.pid[k] = smp.x; sub.kind[k] = smp.y & 0xff; sub.mat[k] = (smp.y >>> 16) & 0xffff; sub.depth[k] = f32u(smp.d);
      }
      resolveCellJS(sub, n, 0, cx, cy, out0, null);
      resolveCellJS(sub, n, 0, cx, cy, out, hk[cy * cols + cx]);
      const gi = (o) => [o.gi.x >>> 0, o.gi.y >>> 0, o.gi.z >>> 0, o.gi.w >>> 0];
      const w = (idx) => at[(cy * 4 + (idx >> 2)) * sw + cx * 4 + (idx & 3)];
      const exp = (idx, cov) => { const s = w(idx), kind = s.y & 0xff; return kind === 0 ? [0, 0, 0, 0] : [s.x, (kind | (((s.y >>> 8) & 0xf) << 8) | (cov << 13) | (((s.y >>> 16) & 0xffff) << 16)) >>> 0, s.z, s.w]; };
      assert.deepEqual(gi(run({ x: cx + 0.5, y: cy + 0.5 })), exp(out.idx, out.cov), `hyst on, round ${round} cell ${cx},${cy}`);
      assert.deepEqual(gi(run0({ x: cx + 0.5, y: cy + 0.5 })), exp(out0.idx, out0.cov), `histValid 0 = plain vote, round ${round} cell ${cx},${cy}`);
      hystCells++; if (out.idx !== out0.idx) hystKept++;
    }
  }
  assert.ok(hystKept > 20, `hysteresis really changed ${hystKept} winners`);
}
console.log(`resolve.wgsl.test.js: string/layout rules and ${probes} JS-evaluated cells vs the vote-rule oracle passed.`);
