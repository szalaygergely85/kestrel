// engine/entities/attach.js (US-012, docs/architecture.md 7.4 "Attached
// lights"). Pure: the world position of an entity's `components.light`
// (`{preset, on, attach: 'eye'|null, offset: {right,down,fwd} (m), sway:
// {amp} (m)}`, JSON only - US-006 reads `preset`/`on` and calls `move()`
// with this position every frame). The offset is rotated by yaw ONLY (the
// lamp does not swing with pitch); `down` is a fixed drop below the eye,
// `sway` adds `amp*sin(bobPhase)` right and `0.5*amp*|sin(bobPhase)|` down,
// same phase as US-009's head bob (`components.body.feel.bobPhase`).
//
// No allocation: writes into the caller's `out` (a `Float64Array(3)` per
// the tech note, but any 3-slot indexable works - the function never reads
// `out`'s type).

/**
 * @param {Object} entity - plain entity data ({transform, components})
 * @param {{bobPhase:number}|null} eyeFeel - typically `entity.components.body.feel`
 * @param {Float64Array|number[]} out - length >= 3, written in place
 * @returns {Float64Array|number[]} out
 */
export function attachedLightPos(entity, eyeFeel, out) {
  const t = entity.transform;
  const body = entity.components && entity.components.body;
  const light = entity.components && entity.components.light;

  const eyeH = body && typeof body.eyeH === 'number' ? body.eyeH : 0;
  const feelOffset = eyeFeel && typeof eyeFeel.offset === 'number' ? eyeFeel.offset : 0;
  const ex = t.x, ey = t.y, ez = t.z + eyeH + feelOffset;

  const off = (light && light.offset) || null;
  const offRight = off && typeof off.right === 'number' ? off.right : 0;
  const offDown = off && typeof off.down === 'number' ? off.down : 0;
  const offFwd = off && typeof off.fwd === 'number' ? off.fwd : 0;

  const yawRad = t.yawDeg * Math.PI / 180;
  const sinY = Math.sin(yawRad), cosY = Math.cos(yawRad);
  // Compass convention (7.4): forward = (sinY, -cosY); right = forward
  // rotated 90 deg clockwise = (cosY, sinY).
  const fwdX = sinY, fwdY = -cosY;
  const rightX = cosY, rightY = sinY;

  let swayRight = 0, swayDown = 0;
  const sway = light && light.sway;
  if (sway && typeof sway.amp === 'number' && eyeFeel) {
    const phase = typeof eyeFeel.bobPhase === 'number' ? eyeFeel.bobPhase : 0;
    const s = Math.sin(phase);
    swayRight = sway.amp * s;
    swayDown = 0.5 * sway.amp * Math.abs(s);
  }

  out[0] = ex + fwdX * offFwd + rightX * (offRight + swayRight);
  out[1] = ey + fwdY * offFwd + rightY * (offRight + swayRight);
  out[2] = ez - (offDown + swayDown);
  return out;
}
