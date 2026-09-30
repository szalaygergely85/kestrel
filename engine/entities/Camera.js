// CameraPose + pure helpers (docs/architecture.md section 5). Constructing
// and clamping/turning a pose needs no `Entity` (US-025), so that part is
// real; `fromEntity` needs the real `Entity`/`components.body` shape and is
// a stub until then.

import { wrapDeg } from '../core/transform.js';

const PITCH_CLAMP_DEG = 35; // matches the y-shear clamp (architecture.md 4)

export class Camera {
  /** @param {number} [x] @param {number} [y] @param {number} [z] @param {number} [yawDeg] @param {number} [pitchDeg] */
  constructor(x = 0, y = 0, z = 0, yawDeg = 0, pitchDeg = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yawDeg = yawDeg;
    this.pitchDeg = Camera.clampPitch(pitchDeg);
  }

  /** @param {number} p @param {number} [clampDeg] 35 (shear) default; 70 on the pitched camera (28.1 A2 item 6) */
  static clampPitch(p, clampDeg = PITCH_CLAMP_DEG) {
    return Math.max(-clampDeg, Math.min(clampDeg, p));
  }

  /**
   * Applies a raw mouse-move delta (device pixels) as a look turn, same
   * convention as game/js/engine/playerLook.js: mouse right -> yaw+, mouse
   * up (dy<0) -> pitch+.
   */
  lookDelta(dxPx, dyPx, degPerPx) {
    this.yawDeg = wrapDeg(this.yawDeg + dxPx * degPerPx);
    this.pitchDeg = Camera.clampPitch(this.pitchDeg - dyPx * degPerPx);
    return this;
  }

  /**
   * Eye position/orientation from an entity's transform + eye-feel offset
   * (US-009/025). `eyeH` overrides the entity's own `components.body.eyeH`
   * when given (a caller that wants a fixed eye height regardless of body
   * state); omit it to use the entity's own eye height.
   * @param {Object} entity - plain `Entity` data (`{transform, components}`)
   * @param {number} [eyeH]
   * @param {number} [pitchClampDeg]
   */
  static fromEntity(entity, eyeH, pitchClampDeg) {
    return Camera.fromEntityInto(entity, eyeH, new Camera(), pitchClampDeg);
  }

  /**
   * Same as `fromEntity`, but writes into a caller-owned `out` instead of
   * allocating (rule 9) - for per-fixed-step callers such as
   * `updateInteraction` (US-012 arch review, 2026-09-24). `out` must already
   * be a `Camera` (or at least have its fields); its `pitchDeg` is clamped
   * same as the constructor.
   * @param {Object} entity @param {number} [eyeH] @param {Camera} out @param {number} [pitchClampDeg]
   * @returns {Camera} out
   */
  static fromEntityInto(entity, eyeH, out, pitchClampDeg) {
    const body = entity.components && entity.components.body;
    const baseEyeH = typeof eyeH === 'number' ? eyeH : (body && typeof body.eyeH === 'number' ? body.eyeH : 0);
    const offset = body && body.feel && typeof body.feel.offset === 'number' ? body.feel.offset : 0;
    const t = entity.transform;
    out.x = t.x;
    out.y = t.y;
    out.z = t.z + baseEyeH + offset;
    out.yawDeg = t.yawDeg;
    out.pitchDeg = Camera.clampPitch(t.pitchDeg, pitchClampDeg);
    return out;
  }
}
