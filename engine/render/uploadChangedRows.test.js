// PERF-04: uploadChangedRows keeps the texture byte-identical to a full upload of the CPU cell array (fake device = texture memory).
import assert from 'node:assert/strict';
import { uploadChangedRows, makeUploadState } from './RenderTargetWebGPU.js';

const cols = 37, rows = 23, n = cols * rows * 4;
const mkTex = () => ({ width: cols, height: rows, mem: new Uint8Array(n) });
let rowsSent = 0;
const d = {
  writeTexture(tex, data, rect, off) {
    const x = rect ? rect.x : 0, y = rect ? rect.y : 0, w = rect ? rect.w : tex.width, h = rect ? rect.h : tex.height, o = off || 0;
    assert.equal(x, 0); assert.equal(w, cols);
    for (let r = 0; r < h; r++) for (let k = 0; k < w * 4; k++) tex.mem[((y + r) * cols) * 4 + k] = data[o + r * w * 4 + k];
    rowsSent += h;
  },
};
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const src = new Uint8Array(n); for (let i = 0; i < n; i++) src[i] = (rnd() * 256) | 0;
let tex = mkTex(); const st = makeUploadState();
assert.equal(uploadChangedRows(d, tex, src, cols, rows, st), rows, 'first upload is full');
assert.deepEqual(tex.mem, src);
rowsSent = 0;
assert.equal(uploadChangedRows(d, tex, src, cols, rows, st), 0, 'unchanged: nothing sent'); assert.equal(rowsSent, 0);
for (let it = 0; it < 300; it++) {
  const edits = (rnd() * 4) | 0;
  for (let e = 0; e < edits; e++) src[(rnd() * n) | 0] = (rnd() * 256) | 0;
  if (it === 100) { tex = mkTex(); } // new texture handle (resize / device restore) -> full upload
  if (it === 200) st.tex = null; // invalidateCellUpload
  const before = rowsSent, sent = uploadChangedRows(d, tex, src, cols, rows, st);
  assert.equal(rowsSent - before, sent);
  assert.deepEqual(tex.mem, src, `iteration ${it}: texture == full upload`);
  if (it === 100 || it === 200) assert.equal(sent, rows);
}
// -0/+0 and NaN-like byte patterns are compared as u32 words: a byte flip in the alpha channel is seen
const s2 = makeUploadState(), t2 = mkTex(), a = new Uint8Array(n); uploadChangedRows(d, t2, a, cols, rows, s2);
a[n - 1] = 128; assert.equal(uploadChangedRows(d, t2, a, cols, rows, s2), 1); assert.deepEqual(t2.mem, a);
console.log('uploadChangedRows: PASS');
