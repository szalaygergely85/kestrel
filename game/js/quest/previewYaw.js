// game/js/quest/previewYaw.js (EQ-04a, architecture 38.40 item 7): view-only yaw of the Character tab model. Pure, no allocation.
// A/D + Left/Right turn 150 deg/s, a mouse drag turns 0.6 deg per UI px, 3 s without input eases back to face the viewer (180 deg) at 60 deg/s.
// Never saved. characterView feeds `step(dt, dir, dragPx)` once per frame and passes `.yawDeg` to modelPreview.render.
export const FACE_VIEWER = 180, TURN_DEG_S = 150, DRAG_DEG_PX = 0.6, IDLE_S = 3, EASE_DEG_S = 60;

export function createPreviewYaw() {
  const s = { yawDeg: FACE_VIEWER, idle: 0,
    /** @param {number} dt seconds @param {number} dir -1 (left/A) | 0 | 1 (right/D) @param {number} dragPx horizontal UI px dragged this frame */
    step(dt, dir, dragPx) {
      if (dir !== 0 || dragPx !== 0) {
        s.yawDeg += dir * TURN_DEG_S * dt + dragPx * DRAG_DEG_PX; s.idle = 0;
      } else {
        s.idle += dt;
        if (s.idle > IDLE_S) { // shortest way back to 180
          let d = FACE_VIEWER - s.yawDeg;
          d -= 360 * Math.round(d / 360);
          const m = EASE_DEG_S * dt;
          s.yawDeg = Math.abs(d) <= m ? FACE_VIEWER : s.yawDeg + (d > 0 ? m : -m);
        }
      }
      s.yawDeg -= 360 * Math.floor(s.yawDeg / 360); // [0, 360)
      return s.yawDeg;
    },
    reset() { s.yawDeg = FACE_VIEWER; s.idle = 0; } };
  return s;
}
