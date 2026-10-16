// PERF-10: uploadChangedRows old (single span) vs new (gap-merged ranges). Fake device = texture memory; proves identical final bytes.
import assert from 'node:assert/strict';
import { uploadChangedRows, makeUploadState } from '../engine/render/RenderTargetWebGPU.js';
function oldUpload(d, tex, src, cols, rows, st) {
  const n = cols * rows, odd = !src || !src.buffer || (src.byteOffset & 3) !== 0 || src.length !== n * 4;
  if (odd || st.tex !== tex || st.src !== src || !st.prev || st.prev.length !== n) {
    d.writeTexture(tex, src);
    if (odd) { st.tex = null; return rows; } // unaligned / odd source (test fakes): always full
    if (!st.prev || st.prev.length !== n) st.prev = new Uint32Array(n);
    st.src32 = new Uint32Array(src.buffer, src.byteOffset, n);
    st.prev.set(st.src32);
    st.tex = tex; st.src = src;
    return rows;
  }
  const a = st.src32, p = st.prev;
  let i = 0;
  while (i < n && a[i] === p[i]) i++;
  if (i === n) return 0;
  let j = n - 1;
  while (a[j] === p[j]) j--;
  const r0 = (i / cols) | 0, r1 = (j / cols) | 0;
  for (let k = r0 * cols, e = (r1 + 1) * cols; k < e; k++) p[k] = a[k];
  const rect = st.rect; rect.x = 0; rect.y = r0; rect.w = cols; rect.h = r1 - r0 + 1;
  d.writeTexture(tex, src, rect, r0 * cols * 4);
  return rect.h;
}
const cols = 240, rows = 90, n = cols * rows * 4;
function run(fn, label) {
  const tex = { mem: new Uint8Array(n) }, st = makeUploadState(), src = new Uint8Array(n);
  let calls = 0, bytes = 0;
  const d = { writeTexture(t, data, rect, off) {
    calls++; const h = rect ? rect.h : rows, o = off || 0, len = h * cols * 4; bytes += len;
    t.mem.set(data.subarray(o, o + len), o);
  } };
  let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const t0 = performance.now();
  for (let f = 0; f < 6000; f++) {
    // HUD: top rows 0-1 and bottom rows 86-88 change every frame, plus occasional mid-screen edits
    for (let k = 0; k < 4; k++) { src[(rnd() * cols * 2 * 4) | 0] = f; src[(86 * cols * 4) + ((rnd() * cols * 3 * 4) | 0)] = f; }
    if (f % 50 === 0) src[(rnd() * n) | 0] = f;
    fn(d, tex, src, cols, rows, st);
  }
  const ms = performance.now() - t0;
  assert.deepEqual(tex.mem, src);
  console.log(label.padEnd(5), ms.toFixed(1) + ' ms', 'writes/frame', (calls / 6000).toFixed(2), 'KB/frame', (bytes / 6000 / 1024).toFixed(1));
  return tex.mem;
}
const A = run((d, t, s, c, r, st) => oldUpload(d, t, s, c, r, st), 'old');
const B = run(uploadChangedRows, 'new');
assert.deepEqual(A, B); console.log('final buffers identical');
