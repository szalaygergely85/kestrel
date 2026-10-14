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

/**
 * GI-PROBE-05 gpucompare rows: a small analytic field over the world_m1 band around the Bend / tower (stands in for a Node bake until the
 * baked .gi.bin files land). o: {groundAt(x,y), hour, lights (LightSet: ambient + sun.col), room:[x,y,r] dark interior, lamps:[x,y,r] emissive}.
 */
export function makeRowGI(o) {
  const W = 48, H = 48, LY = 3, x0 = 1240, y0 = 1000, n = W * H * LY, pr = new Float32Array(n * GI_CHANNELS), base = new Float32Array(W * H), vld = new Uint8Array(n).fill(1);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) base[r * W + c] = o.groundAt ? o.groundAt(x0 + (c + 0.5) * 8, y0 + (r + 0.5) * 8) : 0;
  const near = (a, x, y) => (a ? Math.max(0, 1 - Math.hypot(x - a[0], y - a[1]) / a[2]) : 0);
  for (let l = 0; l < LY; l++) for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const px = x0 + (c + 0.5) * 8, py = y0 + (r + 0.5) * 8, q = ((l * H + r) * W + c), p = q * GI_CHANNELS;
    const room = near(o.room, px, py) > 0.2 ? 1 : 0, lamp = near(o.lamps, px, py), g = 1 + 0.25 * Math.sin(c * 0.7 + r * 0.5 + l);
    pr[p] = room ? 0.2 : 1.8 * g; pr[p + 1] = room ? 0.04 : 0.9; pr[p + 2] = 0.2 * Math.cos(r * 0.3); pr[p + 3] = 0.15 * Math.sin(c * 0.4);
    for (let k = 0; k < 6; k++) { const s = p + 4 + k * 12; pr[s] = room ? 0.04 : 0.18 * g; pr[s + 4] = 0.09 * g; pr[s + 8] = 0.04 * g; pr[s + 1] = 0.05 * Math.sin(c + k); }
    pr[p + 76] = 0.6 * lamp; pr[p + 80] = 0.3 * lamp; pr[p + 84] = 0.08 * lamp; pr[p + 77] = 0.1 * lamp * Math.sin(r); // warm emissive
  }
  const st = createGIState(); st.field = encodeGIField({ x0, y0, cellM: 8, w: W, h: H, layers: LY, probes: pr, valid: vld, base }); st.on = true;
  const L = o.lights, hour = o.hour, night = hour >= 19.5 || hour < 5;
  mixGIState(st, hour, [L.ambient[0], L.ambient[1], L.ambient[2]], [L.sun.col[0], L.sun.col[1], L.sun.col[2]], { night, skyFloor: 0.15, emisK: o.emisK === undefined ? 1 : o.emisK });
  return st;
}
