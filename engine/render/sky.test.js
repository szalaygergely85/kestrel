// ME-19b: sky directions follow the retained GLSL pitchedCellDir and shear equations.
// ART-04a (docs/architecture.md 37.18 item 5): cloud-deck tests (`cloudAt`,
// `cloudDriftOffset`, `cloudValueNoise`) + the `fillSky` clouds branch. The
// zero-alloc gate re-runs itself with `--expose-gc` (repo pattern).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fillSky, ambientL, cloudAt, cloudDriftOffset, cloudValueNoise } from './sky.js';
import { beginFrame } from './compositor.js';
import { fastShadeSky } from './fastShade.js';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { GBuffer } from './GBuffer.js';
import { createPitchedTerms, pitchedTerms, PROJ_HFOV_DEG } from './projection.js';
import { clampByte } from '../core/math.js';
import palette from '../../design/palette.js';
import * as E from '../index.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0;
function check(condition, msg) { assert.ok(condition, msg); pass++; }
const cols = 32, rows = 12, pxCellW = 3, pxCellH = 5;
for (const projection of ['pitched', 'shear']) for (const yawDeg of [0, 73, 270]) for (const pitchDeg of [-20, 0, 20]) {
  const rt = new CellBuffer(cols, rows); rt.pxCellW = pxCellW; rt.pxCellH = pxCellH;
  const depth = new DepthBuffer(cols, rows), gbuf = new GBuffer(cols, rows);
  const fb = { rt, depth, gbuf, palette, renderer: 'mesh' };
  const cam = { x: 0, y: 0, z: 1.6, yawDeg, pitchDeg, projection };
  beginFrame(fb);
  const guard = 3 + cols * 4;
  rt.setCellRGB(3, 4, 7, 1, 2, 3, 4, 5, 6); depth.depth[guard] = 2;
  fillSky(fb, cam);
  check(depth.depth[guard] === 2 && rt.glyphIdx[guard] === 7 && rt.fg[guard * 4] === 1);
  const terms = pitchedTerms(cam, { cols, rows, pxCellW, pxCellH }, createPitchedTerms());
  const out = { fg: [0, 0, 0], bg: [0, 0, 0], glyphIdx: 0 };
  let matches = true;
  const tanHalf = Math.tan(PROJ_HFOV_DEG * Math.PI / 180 / 2), yaw = yawDeg * Math.PI / 180;
  const dirX = Math.sin(yaw), dirY = -Math.cos(yaw), planeX = -dirY * tanHalf, planeY = dirX * tanHalf;
  const planeDistY = (rows / 2) * (cols * pxCellW / (rows * pxCellH)) / tanHalf;
  const horizon = rows / 2 + Math.tan(pitchDeg * Math.PI / 180) * planeDistY;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x; if (i === guard) continue;
    let dx, dy, dz, el;
    if (projection === 'pitched') {
      // Literal GLSL cellDirPitched expression order, independent of screenRay.
      const a = ((2 * (x + 0.5)) / cols - 1) * terms.tanHalfX;
      const b = (1 - (2 * y) / rows) * terms.tanHalfY;
      dx = terms.fX + a * terms.rX + b * terms.uX;
      dy = terms.fY + a * terms.rY + b * terms.uY; dz = terms.fZ + b * terms.uZ;
      el = Math.atan2(dz, Math.hypot(dx, dy)) * 180 / Math.PI;
    } else {
      const a = (2 * (x + 0.5)) / cols - 1;
      dx = dirX + planeX * a; dy = dirY + planeY * a;
      el = Math.atan2(horizon - y, planeDistY) * 180 / Math.PI;
    }
    let az = Math.atan2(dx, -dy) * 180 / Math.PI; if (az < 0) az += 360;
    fastShadeSky(palette, az, el, palette.defaultTime, out);
    matches &&= rt.glyphIdx[i] === out.glyphIdx && depth.depth[i] === Infinity;
    for (let c = 0; c < 3; c++) matches &&= rt.fg[i * 4 + c] === clampByte(out.fg[c]) && rt.bg[i * 4 + c] === clampByte(out.bg[c]);
  }
  check(matches);
  beginFrame(fb); check(depth.depth.every(d => d === Infinity));
}
check(ambientL.every((v, i) => v === palette.hue[palette.lights.ambient.color][i] * palette.lights.ambient.intensity));
check(E.HFOV_DEG === PROJ_HFOV_DEG);
check(['castTerrain', 'marchTerrainRay', 'castModels', 'castSectors', 'castScene'].every(name => !(name in E)));

// ---- ART-04a: cloudAt / cloudDriftOffset / cloudValueNoise ------------------
const CLOUD_BAND = [2, 35, 55];
const C = {
  lit: [255, 255, 255], shade: [60, 60, 72], ramp: " .:-=+*#%@",
  scale: 1.6, bias: 0.12, cover: 0.5, puffK: 3.0, wispCover: 0.58, wispK: 3.0,
  wind: new Float32Array([0.006, 0.0015]), litK: 2.2, litDy: 0.06, bodyK: 0.9, seed: 3,
};
const zeroOff = new Float32Array([0, 0]);
function makeCloudOut(base) {
  return { base: (base || [128, 128, 128]).slice(), band: CLOUD_BAND, fg: [0, 0, 0], bg: [0, 0, 0], glyph: 0 };
}
// Unit view direction from compass azimuth + elevation (az = atan2(dx, -dy)).
function unitDir(azDeg, elevDeg) {
  const az = azDeg * Math.PI / 180, el = elevDeg * Math.PI / 180, ch = Math.cos(el);
  return { dx: ch * Math.sin(az), dy: -ch * Math.cos(az), dz: Math.sin(el) };
}
// true when two cloud configs disagree on any sampled cell (robust vs a single-cell coincidence).
function cellsDiffer(Ca, offa, Cb, offb) {
  for (let az = 30; az < 360; az += 17) {
    const el = 24, d = unitDir(az, el);
    const a = makeCloudOut(), b = makeCloudOut();
    cloudAt(d.dx, d.dy, d.dz, el, Ca, offa, a);
    cloudAt(d.dx, d.dy, d.dz, el, Cb, offb, b);
    if (a.glyph !== b.glyph || a.fg[0] !== b.fg[0] || a.fg[1] !== b.fg[1] || a.fg[2] !== b.fg[2] || a.bg[0] !== b.bg[0] || a.bg[1] !== b.bg[1] || a.bg[2] !== b.bg[2]) return true;
  }
  return false;
}

// CLOUD-WRAP-01: puff AND wisp octaves are seamless across a 256 drift wrap: cloudAt at off == at off-256 over 2000 random directions.
{
  const Cp = Object.assign({}, C);
  let seed = 12345; const r = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const oa = new Float32Array(2), ob = new Float32Array(2); let bad = 0;
  for (let i = 0; i < 2000; i++) {
    const el = 4 + r() * 40, d = unitDir(r() * 360, el);
    oa[0] = Math.floor(r() * 65536) / 256; oa[1] = Math.floor(r() * 65536) / 256; ob[0] = oa[0] - 256; ob[1] = oa[1] - 256;
    const a = makeCloudOut(), b = makeCloudOut();
    cloudAt(d.dx, d.dy, d.dz, el, Cp, oa, a); cloudAt(d.dx, d.dy, d.dz, el, Cp, ob, b);
    if (a.glyph !== b.glyph || Math.abs(a.fg[0] - b.fg[0]) > 1e-6 || Math.abs(a.bg[0] - b.bg[0]) > 1e-6) bad++;
  }
  console.log(bad === 0 ? 'ok   cloudAt seamless across 256 drift wrap (puff octaves)' : 'FAIL cloudAt wrap mismatches: ' + bad);
  if (bad) process.exitCode = 1;
}

{
  // deterministic: same inputs -> identical out cells.
  const d = unitDir(31, 21);
  const a = makeCloudOut(), b = makeCloudOut();
  cloudAt(d.dx, d.dy, d.dz, 21, C, zeroOff, a);
  cloudAt(d.dx, d.dy, d.dz, 21, C, zeroOff, b);
  check('cloudAt: same (dx,dy,dz,el,C,off) -> identical out cells',
    a.fg.every((v, i) => v === b.fg[i]) && a.bg.every((v, i) => v === b.bg[i]) && a.glyph === b.glyph);

  // same seed+wind+t -> identical; different seed / wind -> different.
  const off = new Float32Array(2); cloudDriftOffset(C, 123.456, off);
  const c = makeCloudOut(); cloudAt(d.dx, d.dy, d.dz, 21, C, off, c);
  const off2 = new Float32Array(2); cloudDriftOffset(C, 123.456, off2);
  const c2 = makeCloudOut(); cloudAt(d.dx, d.dy, d.dz, 21, C, off2, c2);
  check('cloudAt: same seed+wind+t -> identical', c.fg.every((v, i) => v === c2.fg[i]) && c.bg.every((v, i) => v === c2.bg[i]) && c.glyph === c2.glyph);
  check('cloudAt: different seed -> different cells', cellsDiffer(C, off, { ...C, seed: 4 }, off));
  const Cw = { ...C, wind: new Float32Array([0.05, 0.002]) };
  const offw = new Float32Array(2); cloudDriftOffset(Cw, 123.456, offw);
  check('cloudAt: different wind -> different cells', cellsDiffer(C, off, Cw, offw));
}

{
  // dn == 0 outside the band: el <= 0 (below the fade-in) or el >= cb2 (55) -> fg=bg=base, glyph=0.
  for (const el of [0, 55, 60, 80]) {
    const d = unitDir(40, el), out = makeCloudOut([101, 113, 127]);
    cloudAt(d.dx, d.dy, d.dz, el, C, zeroOff, out);
    check(`cloudAt: dn==0 outside the band (el=${el})`,
      out.fg[0] === 101 && out.fg[1] === 113 && out.fg[2] === 127 &&
      out.bg[0] === 101 && out.bg[1] === 113 && out.bg[2] === 127 && out.glyph === 0);
  }
}

{
  // white tops: a cloud cell whose "below > above" noise (lit > 0.5) renders a brighter fg than bg.
  let top = null;
  for (let az = 0; az < 360 && !top; az += 6) {
    for (let el = 6; el < 55 && !top; el += 3) {
      const d = unitDir(az, el);
      const qx = (d.dx / (d.dz + C.bias)) * C.scale, qy = (d.dy / (d.dz + C.bias)) * C.scale;
      const below = cloudValueNoise(qx * (1 + C.litDy), qy * (1 + C.litDy), C.seed);
      const above = cloudValueNoise(qx * (1 - C.litDy), qy * (1 - C.litDy), C.seed);
      const out = makeCloudOut([128, 128, 128]);
      cloudAt(d.dx, d.dy, d.dz, el, C, zeroOff, out);
      if (out.glyph !== 0 && below > above && out.fg[0] > out.bg[0] && out.fg[1] > out.bg[1] && out.fg[2] > out.bg[2]) top = { az, el };
    }
  }
  check('cloudAt: a bright top edge (lit > 0.5) renders a brighter fg than bg', top != null);
}

{
  // drift wraps at 256 with no jump in vn (period-256: x+255.5 == x-0.5).
  check('cloudValueNoise: period-256 (no jump at the drift wrap)',
    cloudValueNoise(3.7 + 255.5, -12.4, C.seed) === cloudValueNoise(3.7 - 0.5, -12.4, C.seed));
  const o = new Float32Array(2);
  cloudDriftOffset({ wind: new Float32Array([1, 1]) }, 255.5, o);
  check('cloudDriftOffset: (wind*timeSec) mod 256', o[0] === 255.5 && o[1] === 255.5);
  cloudDriftOffset({ wind: new Float32Array([1, 1]) }, 256.5, o);
  check('cloudDriftOffset: 256.5 wraps to 0.5', o[0] === 0.5 && o[1] === 0.5);
}

{
  // no allocation: cloudAt writes into the caller-owned out and returns it.
  const out = makeCloudOut(), fgArr = out.fg, bgArr = out.bg;
  const d = unitDir(33, 22);
  const ret = cloudAt(d.dx, d.dy, d.dz, 22, C, zeroOff, out);
  check('cloudAt: writes into the caller-owned out (returns out, reuses fg/bg)', ret === out && out.fg === fgArr && out.bg === bgArr && typeof out.glyph === 'number');
  if (typeof global.gc === 'function') {
    for (let i = 0; i < 2000; i++) cloudAt(d.dx, d.dy, d.dz, 22, C, zeroOff, out); // warm
    global.gc(); const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20000; i++) cloudAt(d.dx, d.dy, d.dz, 22, C, zeroOff, out);
    global.gc(); const grew = process.memoryUsage().heapUsed - before;
    check('cloudAt: no significant heap growth over 20k calls', grew < 64 * 1024, `grew ${grew} bytes`);
  }
}

{
  // fillSky branches: afternoon look paints cloud glyphs; morning (default) stays the no-clouds path.
  const afternoonPalette = { ...palette, defaultTime: 'afternoon' };
  const rtA = new CellBuffer(cols, rows); rtA.pxCellW = pxCellW; rtA.pxCellH = pxCellH;
  const fbA = { rt: rtA, depth: new DepthBuffer(cols, rows), gbuf: new GBuffer(cols, rows), palette: afternoonPalette, renderer: 'mesh' };
  const camA = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 };
  beginFrame(fbA);
  fillSky(fbA, camA);
  let clouds = 0;
  for (let i = 0; i < cols * rows; i++) if (rtA.glyphIdx[i] !== 0) clouds++;
  check('fillSky: afternoon look paints cloud glyphs', clouds > 0, `clouds=${clouds}`);
}

console.log(`sky.test.js: ${pass} passed, 0 failed. ALL PASS`);
