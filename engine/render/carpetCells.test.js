// OB-073 D2c: carpetCells (JS frame cell pass) + KIND_GRASS shade/edge. Node only, synthetic flat meadow.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GBuffer, KIND_GRASS, KIND_TERRAIN, KIND_MESH, FACE_U } from './GBuffer.js';
import { makeCarpetCtx, carpetCells } from './carpet.js';
import { shadeGrass, grassTableFor } from './terrainShade.js';
import { edgeRules } from './edgePass.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };

// 40 m class map (2 m cells): variant 1 everywhere except a path strip y in [-6,-4] (0)
const W = 20, H = 20, X0 = -20, Y0 = -20;
const classMap = new Uint8Array(W * H);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const y = Y0 + j * 2 + 1; classMap[j * W + i] = y > -6 && y < -4 ? 0 : 1; }
const cfg = { seed: 3, radiusM: 8, variants: [{ name: 'meadow', ground: ['grass'], density: 0.9, heightM: [0.15, 0.25], ramp: [[10, 40, 10], [60, 160, 40], [180, 230, 90]] }] };
const flat = (q) => { q[2] = 0; };
const mkCtx = () => makeCarpetCtx({ cfg, classMap, x0: X0, y0: Y0, w: W, h: H }, flat, null);

const cam = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: -22 };
function makeFrame(cols, rows) {
  const g = new GBuffer(cols, rows), depth = new Float32Array(cols * rows);
  g.cam.tanHalfHFov = 0.8; g.cam.cols = cols; g.cam.planeDistY = rows * 1.6;
  return { g, fb: { depth: { depth } } };
}
// cast: flat ground (kind 7); optional box (kind 9) 3.5 m ahead
function cast(fr, box) {
  const { g, fb } = fr, cols = g.cols, rows = g.rows, depth = fb.depth.depth;
  g.beginFrame(); depth.fill(0);
  const horizon = rows / 2 + Math.tan(cam.pitchDeg * Math.PI / 180) * g.cam.planeDistY;
  for (let y = 0; y < rows; y++) {
    const slope = -(y - horizon) / g.cam.planeDistY;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (slope >= -0.01) continue;
      kindSet(g, i, KIND_TERRAIN); depth[i] = cam.z / -slope; g.planeId[i] = 1;
      if (box && x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1) { g.kind[i] = KIND_MESH; depth[i] = box.d; g.planeId[i] = 2; }
    }
  }
}
function kindSet(g, i, k) { g.kind[i] = k; }
// world xy of a cell at its depth
function worldXY(fr, x, y, out) {
  const { g, fb } = fr, d = fb.depth.depth[y * g.cols + x];
  const camX = (2 * (x + 0.5)) / g.cols - 1; // yaw 0: dir (0,-1), plane (+tanH, 0)... plane = (-dirY*tanH, dirX*tanH) = (tanH, 0)
  out[0] = cam.x + g.cam.tanHalfHFov * camX * d; out[1] = cam.y - d;
}

const ctx = mkCtx(), fr = makeFrame(120, 60), xy = [0, 0];
cast(fr);
const before = fr.g.kind.slice(), depthBefore = fr.fb.depth.depth.slice();
const n = carpetCells(fr.g, fr.fb, cam, ctx, 0);
check(n > 200, `AC2 carpet cells written (${n})`);
{
  let bad = 0, far = 0, count = 0, ok = 0;
  for (let y = 0; y < 60; y++) for (let x = 0; x < 120; x++) {
    const i = y * 120 + x;
    if (fr.g.kind[i] !== KIND_GRASS) { if (fr.g.kind[i] !== before[i]) bad++; continue; }
    count++;
    if (fr.g.mat[i] !== 1 || fr.g.face[i] !== FACE_U || !(fr.g.u[i] >= 0 && fr.g.u[i] <= 1)) bad++;
    worldXY(fr, x, y, xy);
    if (xy[1] < -3.6 && xy[1] > -6.4) { /* blade near the path strip: its root may jitter in; only the centre of the strip is checked below */ }
    if (xy[1] < -4.5 && xy[1] > -5.5 && Math.hypot(xy[0], xy[1]) < 20) far++;
    if (Math.hypot(xy[0], xy[1]) > 8 * 1.02) bad++;
    ok++;
  }
  check(bad === 0, `AC2 kind-10 cells: variant id/face/u valid, none beyond radiusM, other cells untouched (${count} cells)`);
  check(far === 0, 'AC2 no kind-10 cell over the middle of the path strip');
}
// AC3: box behind the blades keeps its depth where no blade hit it, is hidden where one is
{
  const fr2 = makeFrame(120, 60);
  cast(fr2, { x0: 40, x1: 80, y0: 25, y1: 45, d: 6.0 });
  const d0 = fr2.fb.depth.depth.slice(), k0 = fr2.g.kind.slice();
  carpetCells(fr2.g, fr2.fb, cam, ctx, 0);
  let kept = 0, hidden = 0, bad = 0;
  for (let i = 0; i < 7200; i++) {
    if (k0[i] !== KIND_MESH) continue;
    if (fr2.g.kind[i] === KIND_GRASS) { hidden++; if (!(fr2.fb.depth.depth[i] < d0[i])) bad++; }
    else { kept++; if (fr2.fb.depth.depth[i] !== d0[i] || fr2.g.kind[i] !== KIND_MESH) bad++; }
  }
  check(kept > 0 && hidden > 0 && bad === 0, `AC3 box: ${kept} cells keep depth/kind, ${hidden} hidden by a nearer blade, ${bad} wrong`);
}
// AC4: ramp monotone base -> tip after lighting (same lit term; the AO makes the base darker still)
{
  const tab = grassTableFor(cfg);
  const sctx = { shading: { fgMin: 0.2, fgGamma: 1, fgMaxGain: 1.5, floorLum: 0, wetness: 0 }, fog: { start: 50, full: 1500, curve: 1, nearRGB: [0, 0, 0], farRGB: [90, 90, 90] } };
  const out = { glyph: 0, level: 255, fg: new Uint8Array(3), bg: new Uint8Array(3) };
  const lum = (h, ao) => { shadeGrass(5, 1, h, 0, 0, 0.9 * (0.55 + 0.45 * ao), tab, sctx, out); return out.fg[0] * 0.3 + out.fg[1] * 0.59 + out.fg[2] * 0.11; };
  let mono = true, prev = -1;
  for (let h = 0; h <= 1.0001; h += 0.1) { const l = lum(h, h); if (l < prev) mono = false; prev = l; }
  check(mono && lum(0, 0) < lum(1, 1), `AC4 ramp monotone base -> tip (lum ${lum(0, 0).toFixed(1)} -> ${lum(1, 1).toFixed(1)})`);
  shadeGrass(5, 1, 0.9, 0, 0, 0.9, tab, sctx, out); const gTip = out.glyph;
  shadeGrass(5, 1, 0.5, 0, 0, 0.9, tab, sctx, out); const gMid = out.glyph;
  shadeGrass(5, 1, 0.1, 0, 0, 0.9, tab, sctx, out); const gBase = out.glyph;
  shadeGrass(5, 1, 0.5, -0.6, 0, 0.9, tab, sctx, out); const gL = out.glyph;
  check(gTip === 39 - 32 && gMid === 124 - 32 && gBase === 44 - 32 && gL === 47 - 32, 'glyphs: tip \' / mid | / base , / leanL /');
}
// AC5: edge pass draws no outline on kind-10 cells
{
  const rule = new Uint8Array(7200), fogF = new Float32Array(7200);
  edgeRules(fr.g.kind, fr.g.planeId, fr.g.face, fr.fb.depth.depth, fogF, 120, 60, 1, null, rule, fr.g.mat, null);
  let g10 = 0, withRule = 0;
  for (let i = 0; i < 7200; i++) if (fr.g.kind[i] === KIND_GRASS) { g10++; if (rule[i]) withRule++; }
  check(g10 > 0 && withRule === 0, `AC5 no edge rule on ${g10} kind-10 cells`);
}
// carpet OFF / sky-only frame: unchanged
{
  const fr3 = makeFrame(40, 20); fr3.g.beginFrame(); fr3.fb.depth.depth.fill(0);
  check(carpetCells(fr3.g, fr3.fb, cam, ctx, 0) === 0 && fr3.g.kind.every((k) => k === 0), 'sky-only frame untouched');
}
// AC6: 0 alloc per frame over 600 frames (60x30 grid, calm + windy)
for (const windy of [false, true]) {
  const c = makeCarpetCtx({ cfg, classMap, x0: X0, y0: Y0, w: W, h: H }, flat, windy ? (q) => { q[3] = 2; q[4] = 1; } : null);
  const f = makeFrame(60, 30), run = (nf, t0) => { for (let k = 0; k < nf; k++) { cast(f); carpetCells(f.g, f.fb, cam, c, t0 + k * 0.016); } };
  run(40, 0); global.gc();
  const h0 = process.memoryUsage().heapUsed; run(600, 1); const dh = process.memoryUsage().heapUsed - h0;
  console.log(`  (info) AC6 ${windy ? 'wind' : 'calm'}: ${(dh / 600).toFixed(0)} B/frame over 600 frames (cast() included, it allocates nothing)`);
  check(dh / 600 < 4096, `AC6 ${windy ? 'wind' : 'calm'}: < 4 KB/frame (target 0)`);
}
console.log(fails ? `${fails} FAILED` : 'carpetCells: all ok');
process.exit(fails ? 1 : 0);
