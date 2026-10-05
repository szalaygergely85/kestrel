// ME-19b: sky directions follow the retained GLSL pitchedCellDir and shear equations.
import assert from 'node:assert/strict';
import { fillSky, ambientL } from './sky.js';
import { beginFrame } from './compositor.js';
import { fastShadeSky } from './fastShade.js';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { GBuffer } from './GBuffer.js';
import { createPitchedTerms, pitchedTerms, PROJ_HFOV_DEG } from './projection.js';
import { clampByte } from '../core/math.js';
import palette from '../../design/palette.js';
import * as E from '../index.js';
let pass = 0;
function check(condition) { assert.ok(condition); pass++; }
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
console.log(`sky.test.js: ${pass} passed, 0 failed. ALL PASS`);
