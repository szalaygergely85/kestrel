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
// 6. AA-14b: line glyphs. A line (code 13 '-') moving 1 row with the image = shiftPct, not glyphOnly; a line popping in place stays
// in glyphOnly; raw keeps the old definition.
{
  const LINE = 13, BLANK = 0, R = 20, C = 50, at = (r, c) => (r * grid.cols + c) * 4 + 3;
  const base = () => { const f = frame(0); for (let i = 0; i < n; i++) f.fg[i * 4 + 3] = BLANK; return f; };
  const a = base(), b = base(); a.fg[at(R, C)] = LINE; b.fg[at(R + 1, C)] = LINE; // same camera: line moved down one row
  const same = (x, y) => flickerReprojStep(x, y, x.cam, x.cam, grid, {});
  const r = same(a, b);
  assert.ok(Math.abs(r.glyphOnlyRawPct - 2 * 100 / r.n) < 1e-9, 'raw counts both cells');
  assert.equal(r.shiftPct, r.glyphOnlyRawPct, 'both cells explained as a shift');
  assert.equal(r.glyphOnlyPct, 0, 'shift leaves glyphOnly');
  assert.ok(Math.abs(r.totalPct - r.glyphOnlyRawPct) < 1e-9, 'total unchanged (raw)');
  const c = base(); c.fg[at(R, C)] = LINE; // line pops in place, nothing at a neighbour
  const r2 = same(base(), c);
  assert.equal(r2.shiftPct, 0); assert.equal(r2.glyphOnlyPct, r2.glyphOnlyRawPct); assert.ok(r2.glyphOnlyPct > 0, 'pop stays glyphOnly');
  const d = base(); d.fg[at(R + 1, C)] = 20; const e = base(); e.fg[at(R, C)] = 20; // non-line glyph moving: ramp noise, not a shift
  assert.equal(same(d, e).shiftPct, 0, 'ramp change is not a shift');
  const g = base(), h = base(); g.fg[at(R, C)] = LINE; h.fg[at(R + 1, C)] = LINE; h.fg[at(R, C)] = 20; // one-way: prev glyph LINE not at a neighbour of cur... check cell (R,C): cur 20, prev LINE
  assert.ok(same(g, h).glyphOnlyPct > 0, 'one-way change keeps glyphOnly');
}
console.log('flickerReproj.test: ok');
// AA-31 (OB-208): a view-model block (kind 8, objectId 0xFFFF) is screen-locked: same glyphs at the same cells after a 2-cell camera shift
// = 0 % with vmSame (default), the camera-only mapping (vmSame false) sends it to other cells (here: excluded).
{
  f32[0] = 0.5; const VMD = u32[0];
  const vmFrame = (camX) => { const f = frame(camX); for (let r = 10; r < 30; r++) for (let c = 40; c < 60; c++) { const i = r * grid.cols + c; f.GI[i * 4 + 1] = 8 | (5 << 16); f.GI[i * 4 + 3] = 0xFFFF; f.fg[i * 4 + 3] = c % 2 ? 33 : 34; f.Depth[i * 4] = VMD; } return f; };
  const a = vmFrame(0), b = vmFrame(2 * cellW);
  const on = run(a, b), off = flickerReprojStep(a, b, a.cam, b.cam, grid, {}, null, undefined, false);
  assert.equal(on.totalPct, 0, 'vm same cell = 0 %: ' + on.totalPct);
  assert.ok(on.n >= off.n + 400, 'camera-only mapping loses the vm block: ' + on.n + ' vs ' + off.n);
  const c = vmFrame(2 * cellW); c.fg[(20 * grid.cols + 50) * 4 + 3] = 40; // a real vm glyph flip is still counted
  assert.ok(run(a, c).glyphOnlyPct > 0, 'vm flip counted');
}
console.log('flickerReproj.test: AA-31 vm ok');
