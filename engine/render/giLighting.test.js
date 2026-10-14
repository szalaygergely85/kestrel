// GI-PROBE-04: JS twin lighting with GI. ACs: gi null/off -> 3 poses byte-identical to the pre-GI code (pinned FNV),
// fixture room interior ambient < 0.3 x outdoor, 0 alloc per frame at 480x180 (allocProbe, --expose-gc), bench note.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const SELF = fileURLToPath(import.meta.url);
if (typeof global.gc !== 'function') process.exit(spawnSync(process.execPath, ['--expose-gc', SELF], { stdio: 'inherit' }).status ?? 1);
const { LightSet, lightSurfaces, lightAt, makeLightBuffer } = await import('./lighting.js');
const old = process.env.GI_OLD === '1' ? await import('./_oldLighting.js') : null;
const { FACE_U, FACE_S } = await import('./GBuffer.js');
const { encodeGIField, createGIState, mixGIState, GI_CHANNELS } = await import('./giProbe.js');
const { allocProbe } = await import('../../tools/allocProbe.mjs');
let bad = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) bad++; };

// Fixture: 4x4 columns of 8 m, 3 layers; columns (1..2,1..2) = a roofed room (low sky vis, some warm bounce), rest open.
const W = 4, H = 4, LY = 3, N = W * H * LY;
const pr = new Float32Array(N * GI_CHANNELS);
for (let l = 0; l < LY; l++) for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
  const inRoom = c >= 1 && c <= 2 && r >= 1 && r <= 2, o = ((l * H + r) * W + c) * GI_CHANNELS;
  pr[o] = inRoom ? 0.2 : 2.0; pr[o + 1] = inRoom ? 0.05 : 1.0;           // sky SH: up-lobe vis ~0.08 vs ~1.05
  for (let k = 0; k < 6; k++) pr[o + 4 + k * 12] = inRoom ? 0.05 : 0.2;  // small bounce
}
const field = encodeGIField({ x0: 0, y0: 0, cellM: 8, w: W, h: H, layers: LY, probes: pr });
const gi = createGIState(); gi.field = field; gi.on = true;
mixGIState(gi, 12, [0.3, 0.35, 0.4], [1, 0.9, 0.8], { skyFloor: 0.15 });

const mkLS = () => { const ls = new LightSet(); ls.ambient.set([0.3, 0.35, 0.4]); ls.count = 2;
  for (let i = 0; i < 2; i++) { ls.on[i] = 1; ls.visW[i] = 0; ls.visH[i] = 0; ls.pos.set([4 + 6 * i, 3, 8, 40], i * 4); ls.col.set([1, 0.8, 0.5, 1], i * 4); }
  ls.sun.on = true; ls.sun.dir[0] = 0.3; ls.sun.dir[1] = 0.2; ls.sun.dir[2] = 0.9; ls.sun.col.set([1, 0.9, 0.8]);
  ls.update(0, null); return ls; };
// AC2: interior vs outdoor ambient through lightAt (z up, floor normal +z), no sun, no points
{
  const ls = mkLS(); ls.gi = gi; const o = new Float32Array(3), i = new Float32Array(3);
  ls.count = 0; ls.sun.on = false; lightAt(ls, null, 2, 2, 0.2, 0, 0, 1, o, null, 0, true, null);
  lightAt(ls, null, 16, 16, 0.2, 0, 0, 1, i, null, 0, true, null);
  const ratio = i[1] / o[1];
  ok(ratio < 0.3 && ratio > 0, `room interior ambient / outdoor = ${ratio.toFixed(3)} (< 0.3)`);
  ls.gi = null; lightAt(ls, null, 16, 16, 0.2, 0, 0, 1, i, null, 0, true, null);
  ok(Math.abs(i[0] - 0.3) < 1e-6, 'gi null -> flat ambient');
}
// AC1: 3 poses x (gi null, gi attached but off) byte-identical to the pre-GI lighting (pinned FNV from _oldLighting.js = HEAD)
const cols = 480, rows = 180, n = cols * rows;
const kind = new Uint8Array(n).fill(1), face = new Uint8Array(n).fill(FACE_U), depth = new Float32Array(n);
for (let q = 0; q < n; q++) { depth[q] = 0.3 + (q % 17) * 0.02; if (q % 7 === 0) face[q] = FACE_S; }
const lb = makeLightBuffer(cols, rows);
const fb = { gbuf: { kind, face, aoD: new Float32Array(n), cols, rows }, depth: { depth }, rt: { pxCellW: 1, pxCellH: 1 }, light: lb, timeSec: 3 };
const poses = [{ x: 0, y: 0, z: 2, yawDeg: 20, pitchDeg: -80 }, { x: 5, y: 3, z: 1.5, yawDeg: 140, pitchDeg: -60 }, { x: 18, y: 9, z: 3, yawDeg: 300, pitchDeg: -75 }];
const hash = () => { const u = new Uint32Array(lb.rgb.buffer, lb.rgb.byteOffset, lb.rgb.length); let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
const PIN = 0; if (process.env.DBG) { const ls = mkLS(); for (const p of poses) { lightSurfaces(fb, ls, p, null); console.log(Array.from(lb.rgb.slice(40000*3, 40000*3+6)), ls.count, ls.sun.on); } }
if (old) { const ls = new old.LightSet(); ls.ambient.set([0.3, 0.35, 0.4]); ls.count = 2; for (let i = 0; i < 2; i++) { ls.on[i] = 1; ls.visW[i] = 0; ls.visH[i] = 0; ls.pos.set([4 + 6 * i, 3, 8, 40], i * 4); ls.col.set([1, 0.8, 0.5, 1], i * 4); } ls.sun.on = true; ls.sun.dir[0] = 0.3; ls.sun.dir[1] = 0.2; ls.sun.dir[2] = 0.9; ls.sun.col.set([1, 0.9, 0.8]); ls.update(0, null); console.log('PIN', poses.map((p) => { old.lightSurfaces(fb, ls, p, null); return hash(); })); process.exit(0); }
const PINNED = [421707674, 421707674, 421707674]; // FNV of the pre-GI (HEAD) lightSurfaces output
{
  const ls = mkLS(); const off = createGIState(); off.field = field; off.on = false;
  for (const variant of ['null', 'off']) { ls.gi = variant === 'null' ? null : off;
    poses.forEach((p, k) => { lightSurfaces(fb, ls, p, null); ok(hash() === PINNED[k], `pose ${k} gi ${variant} hash 0x${hash().toString(16)} == pinned 0x${PINNED[k].toString(16)}`); }); }
}
// AC3: 0 alloc per frame with GI on (+ AO on), bench delta
{
  const ls = mkLS(); ls.gi = gi; lightSurfaces(fb, ls, poses[0], null);
  const r = allocProbe((k) => { for (let i = 0; i < k; i++) lightSurfaces(fb, ls, poses[i % 3], null); }, { n: 6, warm: 3, windows: 5 });
  ok(r.bytes < 4096, `gi on lightSurfaces 480x180: ${r.bytes} B per ${r.n} frames`);
  const t = (on) => { ls.gi = on ? gi : null; for (let i = 0; i < 5; i++) lightSurfaces(fb, ls, poses[0], null); const t0 = performance.now(); for (let i = 0; i < 20; i++) lightSurfaces(fb, ls, poses[0], null); return (performance.now() - t0) / 20; };
  const a = t(false), b = t(true), a2 = t(false), b2 = t(true);
  console.log(`BENCH lightSurfaces 480x180 (base, no sun/points): off ${Math.min(a, a2).toFixed(2)} ms, on ${Math.min(b, b2).toFixed(2)} ms`);
}
process.exit(bad ? 1 : 0);
