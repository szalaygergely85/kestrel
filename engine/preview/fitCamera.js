// engine/preview/fitCamera.js (EQ-04a, docs/architecture.md 38.40 item 3): the fixed, pure preview camera.
// Frames `bounds` (metres, feet at z = 0) into the centred rect.w x rect.h cells of a cols x rows stage. Pinhole maths of
// render/projection.js pitchedTermsInto: tanHalfY = tan(hfov/2) / aspect, aspect = cols*pxW / (rows*pxH).
import { PROJ_HFOV_DEG } from '../render/projection.js';

export const PREVIEW_MARGIN = 1.1; // 10 % air around the bounds

/**
 * @param {{w:number,d:number,h:number}} bounds
 * @param {{w:number,h:number}} rect cells of the view box (x/y ignored: the box is centred on the stage)
 * @param {{cols:number,rows:number,pxCellW?:number,pxCellH?:number}} grid the stage grid
 * @param {{x:number,y:number}} [center] world xy of the subject (camera looks at its centre, from +y toward -y)
 * @returns {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}}
 */
export function fitPreviewCamera(bounds, rect, grid, center = { x: 0, y: 0 }) {
  const pw = grid.pxCellW || 1, ph = grid.pxCellH || 1;
  const aspect = (grid.cols * pw) / (grid.rows * ph);
  const tanX = Math.tan((PROJ_HFOV_DEG * Math.PI) / 360), tanY = tanX / aspect;
  // metres spanned by the whole stage at distance D = 2 * tan * D; the rect covers rect/stage of that.
  const dx = (bounds.w * PREVIEW_MARGIN * grid.cols) / (2 * tanX * rect.w);
  const dy = (bounds.h * PREVIEW_MARGIN * grid.rows) / (2 * tanY * rect.h);
  const D = Math.max(dx, dy) + bounds.d / 2; // the nearest face is D - d/2 away: fit that one
  return { x: center.x, y: center.y + D, z: bounds.h / 2, yawDeg: 0, pitchDeg: 0 };
}
