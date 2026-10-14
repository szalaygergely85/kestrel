// GI-PROBE-04 shared fixture (test + bench): non-uniform probe field (roofed room + a smooth sky/bounce gradient), light set, fb builders.
import { LightSet, makeLightBuffer } from './lighting.js';
import { FACE_U, FACE_S } from './GBuffer.js';
import { encodeGIField, createGIState, mixGIState, GI_CHANNELS } from './giProbe.js';

const W = 8, H = 8, LY = 3, N = W * H * LY;
export function makeGI() {
  const pr = new Float32Array(N * GI_CHANNELS);
  for (let l = 0; l < LY; l++) for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const inRoom = c >= 2 && c <= 4 && r >= 2 && r <= 4, o = ((l * H + r) * W + c) * GI_CHANNELS, g = 1 + 0.4 * Math.sin(c * 0.9 + r * 0.7 + l);
    pr[o] = inRoom ? 0.2 : 2.0 * g; pr[o + 1] = inRoom ? 0.05 : 1.0; pr[o + 2] = 0.2 * Math.cos(r); pr[o + 3] = 0.15 * Math.sin(c); // sky SH
    for (let k = 0; k < 6; k++) { const q = o + 4 + k * 12; pr[q] = inRoom ? 0.05 : 0.2 * g; pr[q + 4] = 0.1 * g; pr[q + 8] = 0.05 * g; pr[q + 1] = 0.05 * Math.sin(c + k); }
    pr[o + 76] = inRoom ? 0.3 : 0; pr[o + 80] = inRoom ? 0.15 : 0;                // emissive in the room
  }
  const gi = createGIState(); gi.field = encodeGIField({ x0: 0, y0: 0, cellM: 8, w: W, h: H, layers: LY, probes: pr }); gi.on = true;
  mixGIState(gi, 13, [0.3, 0.35, 0.4], [1, 0.9, 0.8], { skyFloor: 0.15 });
  return gi;
}
export function mkLS() {
  const ls = new LightSet(); ls.ambient.set([0.3, 0.35, 0.4]); ls.count = 2;
  for (let i = 0; i < 2; i++) { ls.on[i] = 1; ls.visW[i] = 0; ls.visH[i] = 0; ls.pos.set([4 + 6 * i, 3, 8, 40], i * 4); ls.col.set([1, 0.8, 0.5, 1], i * 4); }
  ls.sun.on = true; ls.sun.dir[0] = 0.3; ls.sun.dir[1] = 0.2; ls.sun.dir[2] = 0.9; ls.sun.col.set([1, 0.9, 0.8]);
  ls.update(0, null); return ls;
}
export const POSES = [{ x: 0, y: 0, z: 2, yawDeg: 20, pitchDeg: -80 }, { x: 5, y: 3, z: 1.5, yawDeg: 140, pitchDeg: -60 }, { x: 18, y: 9, z: 3, yawDeg: 300, pitchDeg: -75 }];
export function makeFb(cols, rows) {
  const n = cols * rows, kind = new Uint8Array(n).fill(1), face = new Uint8Array(n).fill(FACE_U), depth = new Float32Array(n);
  for (let q = 0; q < n; q++) { depth[q] = 0.3 + (q % 17) * 0.02; if (q % 7 === 0) face[q] = FACE_S; }
  const light = makeLightBuffer(cols, rows);
  return { gbuf: { kind, face, aoD: new Float32Array(n), cols, rows }, depth: { depth }, rt: { pxCellW: 1, pxCellH: 1 }, light, timeSec: 3 };
}
export function fnv(f32) { const u = new Uint32Array(f32.buffer, f32.byteOffset, f32.length); let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
