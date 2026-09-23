// CameraPose + pure helpers (docs/architecture.md section 5). Constructing
// and clamping/turning a pose needs no `Entity` (US-025), so that part is
// real; `fromEntity` needs the real `Entity`/`components.body` shape and is
// a stub until then.

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

  static clampPitch(p) {
    return Math.max(-PITCH_CLAMP_DEG, Math.min(PITCH_CLAMP_DEG, p));
  }

  /**
   * Applies a raw mouse-move delta (device pixels) as a look turn, same
   * convention as game/js/engine/playerLook.js: mouse right -> yaw+, mouse
   * up (dy<0) -> pitch+.
   */
  lookDelta(dxPx, dyPx, degPerPx) {
    this.yawDeg = ((this.yawDeg + dxPx * degPerPx) % 360 + 360) % 360;
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
   */
  static fromEntity(entity, eyeH) {
    const body = entity.components && entity.components.body;
    const baseEyeH = typeof eyeH === 'number' ? eyeH : (body && typeof body.eyeH === 'number' ? body.eyeH : 0);
    const offset = body && body.feel && typeof body.feel.offset === 'number' ? body.feel.offset : 0;
    const t = entity.transform;
    return new Camera(t.x, t.y, t.z + baseEyeH + offset, t.yawDeg, t.pitchDeg);
  }
}
