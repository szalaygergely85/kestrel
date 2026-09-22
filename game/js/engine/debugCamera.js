// Minimal debug/noclip-ish camera for testing US-004's raycaster before
// US-005 (real pointer-lock mouse look) and US-008 (real physics) exist.
// WASD moves relative to yaw (with simple "don't walk into a solid cell"
// collision so testing the sector geometry doesn't require full physics);
// arrow keys look (yaw/pitch); eye height follows the current sector's
// floor automatically. Not a gameplay system - replace with US-005/US-008.

const WALK_SPEED = 3.5; // m/s
const LOOK_YAW_SPEED = 120; // deg/s
const LOOK_PITCH_SPEED = 60; // deg/s
const PITCH_CLAMP = 35; // degrees, matches US-004's y-shear clamp
const EYE_H = 1.6;

export class DebugCamera {
  constructor(level, input) {
    this.level = level;
    this.input = input;
    const s = level.start;
    this.x = s.x;
    this.y = s.y;
    this.yawDeg = s.facingDeg;
    this.pitchDeg = Math.max(-PITCH_CLAMP, Math.min(PITCH_CLAMP, s.pitchDeg || 0));
  }

  get z() {
    const sector = this.level.sectorAt(this.x, this.y);
    const floorH = sector && !sector.solid ? sector.floorH : 0;
    return floorH + EYE_H;
  }

  /** @param {number} dt seconds */
  update(dt) {
    const input = this.input;

    if (input.isDown('ArrowLeft')) this.yawDeg -= LOOK_YAW_SPEED * dt;
    if (input.isDown('ArrowRight')) this.yawDeg += LOOK_YAW_SPEED * dt;
    this.yawDeg = ((this.yawDeg % 360) + 360) % 360;
    if (input.isDown('ArrowUp')) this.pitchDeg += LOOK_PITCH_SPEED * dt;
    if (input.isDown('ArrowDown')) this.pitchDeg -= LOOK_PITCH_SPEED * dt;
    this.pitchDeg = Math.max(-PITCH_CLAMP, Math.min(PITCH_CLAMP, this.pitchDeg));

    const yawRad = this.yawDeg * Math.PI / 180;
    const dirX = Math.sin(yawRad), dirY = -Math.cos(yawRad);
    const rightX = -dirY, rightY = dirX;

    let moveX = 0, moveY = 0;
    if (input.isDown('KeyW')) { moveX += dirX; moveY += dirY; }
    if (input.isDown('KeyS')) { moveX -= dirX; moveY -= dirY; }
    if (input.isDown('KeyA')) { moveX -= rightX; moveY -= rightY; }
    if (input.isDown('KeyD')) { moveX += rightX; moveY += rightY; }

    const len = Math.hypot(moveX, moveY);
    if (len > 1e-6) {
      const speed = (input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? 2 : 1) * WALK_SPEED;
      moveX = (moveX / len) * speed * dt;
      moveY = (moveY / len) * speed * dt;
      this._tryMove(moveX, moveY);
    }
  }

  // Very small "don't walk through a solid cell" check - not real physics
  // (no sliding, no capsule), just enough to test the raycaster sensibly.
  _tryMove(dx, dy) {
    const nx = this.x + dx;
    const ny = this.y + dy;
    if (!this._blocked(nx, this.y)) this.x = nx;
    if (!this._blocked(this.x, ny)) this.y = ny;
  }

  _blocked(x, y) {
    const sector = this.level.sectorAt(x, y);
    return !sector || sector.solid;
  }
}
