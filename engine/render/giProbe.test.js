// GI-PROBE-01 ACs: constant field, decode round trip, invalid renormalise, key lerp (24 h + moon wrap), 0 alloc.
import assert from 'node:assert/strict';
import { encodeGIField, decodeGIChannel, createGIState, mixGIState, giKeyWeights, sampleGI, GI_CHANNELS, GI_NKEYS } from './giProbe.js';
import { allocProbe, skipNote } from '../../tools/allocProbe.mjs';

const W = 4, H = 3, LY = 3, N = W * H * LY;
function mk(fill, valid) {
  const pr = new Float32Array(N * GI_CHANNELS);
  for (let p = 0; p < N; p++) for (let c = 0; c < GI_CHANNELS; c++) pr[p * GI_CHANNELS + c] = fill(p, c);
  return encodeGIField({ x0: 0, y0: 0, cellM: 8, w: W, h: H, layers: LY, probes: pr, valid, base: new Float32Array(W * H) });
}
const cst = (p, c) => (c % 4 === 0 ? 0.5 + (c % 7) * 0.1 : (c % 4 === 1 ? 0.2 : 0));
const mkState = (f) => { const s = createGIState(); s.field = f; mixGIState(s, 12, [0.4, 0.5, 0.6], [1, 0.9, 0.8], { emisK: 0.7, skyFloor: 0.05 }); return s; };

// AC1 constant field -> same everywhere (1e-6), at any hour
{
  const f = mk(cst), s = mkState(f), a = new Float32Array(3), b = new Float32Array(3);
  for (const hr of [0, 7.3, 12, 19.9, 23.5]) {
    mixGIState(s, hr, [0.4, 0.5, 0.6], [1, 0.9, 0.8], {});
    sampleGI(s, 3, 2, 5, 0, 1, 0, a);
    for (let i = 0; i < 40; i++) {
      sampleGI(s, Math.random() * 40 - 4, Math.random() * 14 - 2, Math.random() * 30 - 3, 0, 1, 0, b);
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(a[c] - b[c]) < 1e-6, `const field ${a[c]} vs ${b[c]}`);
    }
  }
}
// AC2 decode round trip <= 1/255 of the channel range
{
  const src = (p, c) => Math.sin(p * 1.7 + c) * 2 + c * 0.01;
  const f = mk(src);
  let worst = 0;
  for (let p = 0; p < N; p++) for (let c = 0; c < GI_CHANNELS; c++) {
    const err = Math.abs(decodeGIChannel(f, p, c) - src(p, c)); worst = Math.max(worst, err / Math.max(f.scale[c], 1e-9));
  }
  assert.ok(worst <= 1 / 255 + 1e-6, 'round trip ' + worst);
}
// AC3 invalid probes skipped + renormalised; all invalid -> ambient + false
{
  const valid = new Uint8Array(N).fill(1);
  for (let p = 0; p < N; p++) if ((p % (W * H)) === 0) valid[p] = 0;       // column 0 invalid on every layer
  const f = mk((p, c) => ((p % (W * H)) === 0 ? 99 : cst(p, c)), valid), s = mkState(f), o = new Float32Array(3), ref = new Float32Array(3);
  sampleGI(mkState(mk(cst)), 8, 1, 4, 0, 1, 0, ref);
  assert.equal(sampleGI(s, 8, 1, 4, 0, 1, 0, o), true);
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(o[c] - ref[c]) < 1e-5, 'renormalised ' + o[c] + ' vs ' + ref[c]);
  const none = mkState(mk(cst, new Uint8Array(N)));
  assert.equal(sampleGI(none, 5, 1, 5, 0, 1, 0, o), false);
  assert.deepEqual([...o].map((v) => +v.toFixed(5)), [0.4, 0.5, 0.6], 'all invalid -> ambient');
}
// AC4 key lerp continuous over 24 h incl. midnight wrap and moon (+12): effective key weights never jump
{
  const st = createGIState(), prev = new Float64Array(GI_NKEYS), cur = new Float64Array(GI_NKEYS);
  const eff = (hr, to) => { giKeyWeights(st, hr); to.fill(0); to[st.k0] += 1 - st.kf; to[st.k1] += st.kf; };
  for (const off of [0, 12]) {
    eff(23.99 + off, prev);
    for (let t = 0; t <= 48 * 60; t++) {                                     // 24 h in 30 s steps, starting across the wrap
      eff((t / 120 + off) % 24, cur);
      let d = 0; for (let k = 0; k < GI_NKEYS; k++) d = Math.max(d, Math.abs(cur[k] - prev[k]));
      assert.ok(d < 0.02, `key jump ${d} at t=${t / 120} off=${off}`);
      assert.ok(Math.abs(cur.reduce((a, b) => a + b) - 1) < 1e-9);
      prev.set(cur);
    }
  }
  giKeyWeights(st, 12); assert.ok(st.k0 === 2 && st.kf === 0);
  giKeyWeights(st, 0); assert.ok(st.k0 === 5 && st.k1 === 0, 'midnight lies between the 20 h and 6 h keys');
  const s2 = createGIState(); mixGIState(s2, 0, [1, 1, 1], [1, 1, 1], { night: true });   // moon key = 12 h
  assert.ok(s2.k0 === 2 && s2.kf === 0, 'night midnight -> noon key');
}
// AC5 0 alloc over many samples
{
  const s = mkState(mk((p, c) => Math.sin(p + c))), o = new Float32Array(3);
  const px = new Float64Array(64), pz = new Float64Array(64); for (let i = 0; i < 64; i++) { px[i] = i * 0.53; pz[i] = i * 0.41; }
  const r = allocProbe((n) => { for (let i = 0; i < n; i++) sampleGI(s, i & 63, 3, (i & 31) + 2, 0, 1, 0, o); }, { n: 20000, warm: 6 });
  if (!skipNote(r, 'giProbe sampleGI')) assert.ok(r.bytes <= 4096, 'alloc ' + r.bytes);
}
console.log('giProbe.test.js: constant field, round trip, invalid renormalise, key lerp/moon wrap, 0 alloc OK.');
