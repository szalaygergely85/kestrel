// AA-01b: synthetic two-frame fixtures for flickerReprojStep (motion-compensated flicker metric).
import assert from 'node:assert/strict';
import { flickerReprojStep } from './flicker.js';
import { createPitchedTerms, pitchedTermsInto } from '../projection.js';

const grid = { cols: 100, rows: 40, pxCellW: 1, pxCellH: 2 };
const n = grid.cols * grid.rows, D = 10;
const t0 = createPitchedTerms(); pitchedTermsInto(t0, { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 }, grid);
const cellW = (2 * t0.tanHalfX * D) / grid.cols; // wall cell width (m) at depth D, flat wall facing the camera (forward = -y)
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);

// Wall frame seen from camera at world x = camX: glyph = absolute wall cell index (a pure function of the surface point).
function frame(camX, opt = {}) {
  const GI = new Uint32Array(4 * n), Depth = new Uint32Array(4 * n), fg = new Uint8Array(4 * n), bg = new Uint8Array(4 * n);
  f32[0] = D;
  for (let i = 0; i < n; i++) {
    const c = i % grid.cols;
    GI[i * 4] = opt.planeId || 7; GI[i * 4 + 1] = 1 | ((opt.mat || 3) << 16);
    Depth[i * 4] = u32[0];
    fg[i * 4 + 3] = (Math.round(camX / cellW) + c) % 200; // absolute wall cell
    fg[i * 4] = 100; bg[i * 4] = 50;
  }
  return { GI, Depth, fg, bg, cam: { x: camX, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 } };
}
const run = (a, b) => flickerReprojStep(a, b, a.cam, b.cam, grid, {});

// 1. Pure 2-cell image shift: 0 % and the shifted-in border is excluded, not counted.
{
  const a = frame(0), b = frame(2 * cellW);
  const r = run(a, b);
  assert.equal(r.totalPct, 0, 'pure shift = 0 %');
  assert.ok(r.n > 0 && r.n < n && r.excluded >= 2 * grid.rows - 1, 'border excluded: n=' + r.n + ' excl=' + r.excluded);
  // the old same-index metric would see ~100 % (every glyph moved)
}
// 2. One glyph flip is glyphOnly; 3. planeId-only change is NOT counted.
{
  const a = frame(0), b = frame(2 * cellW);
  b.fg[(20 * grid.cols + 50) * 4 + 3] ^= 1;
  const r = run(a, b);
  assert.ok(r.glyphOnlyPct > 0 && r.kindPct === 0 && r.materialPct === 0, 'glyph flip');
  assert.ok(Math.abs(r.totalPct - 100 / r.n) < 1e-9);
  const c = frame(2 * cellW, { planeId: 99 });
  assert.equal(run(a, c).totalPct, 0, 'planeId-only change not counted');
}
// 4. material / kind / colour categories.
{
  const a = frame(0);
  const m = frame(2 * cellW, { mat: 4 }); assert.ok(run(a, m).materialPct > 99);
  const k = frame(2 * cellW); for (let i = 0; i < n; i++) k.GI[i * 4 + 1] = 2 | (3 << 16);
  assert.ok(run(a, k).kindPct > 99);
  const c = frame(2 * cellW); for (let i = 0; i < n; i++) c.fg[i * 4] = 100 + 25;
  const rc = run(a, c); assert.ok(rc.colourOnlyPct > 99 && rc.glyphOnlyPct === 0);
  const c2 = frame(2 * cellW); for (let i = 0; i < n; i++) c2.fg[i * 4] = 100 + 24;
  assert.equal(run(a, c2).totalPct, 0, 'delta 24 is not > 24');
}
// 5. Disocclusion: a depth mismatch > 5 % excludes the cell.
{
  const a = frame(0), b = frame(2 * cellW);
  f32[0] = D * 1.2; for (let i = 0; i < n; i++) b.Depth[i * 4] = u32[0];
  const r = run(a, b); assert.equal(r.n, 0); assert.equal(r.totalPct, 0);
}
console.log('flickerReproj.test: ok');
