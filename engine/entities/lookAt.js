// engine/entities/lookAt.js - ANIM-LOOKAT-01 (architecture.md 38.69, lane note; D-090 stage 2): view-side head look-at.
// Per instance: a critically damped follower (yaw, pitch) toward the limited bearing of a world target, written to a 5-number record
// `[on, part, rx, ry, rz]` (deg) that voxelPose.js adds to the head part (inst.look = components.voxel.lookRot).
// Pose order in samplePose: clip / blend layers -> leg body tilt -> LOOK -> addPart (jaw) -> (computeVoxelPose part loop) leg solve.
// The head is never a leg part, so the solve cannot fight it; the look moves only the head's own rotation.
// Conventions (voxel models): rz + = look RIGHT, rx + = nose DOWN; compass yaw (yawFromDelta) grows to the right.
// Rule 38.61: after attach() update() allocates nothing (typed arrays only). Deterministic, no clock, never serialized.
//
// io (Float64Array(8), set by the caller before update): [0] active (1 = look at the target, 0 = release to neutral),
//   [1..3] eye world x,y,z   [4] entity yawDeg   [5..7] target world x,y,z
// A target further than BEHIND_DEG off the facing is treated as "not visible": the head returns to neutral instead of snapping to a limit.
const ST = 4; // per-slot state: yaw, pitch, yawVel, pitchVel
const REC = 5;
const BEHIND_DEG = 150;
const EPS_DEG = 0.02;   // settled + inactive below this: record off (byte-identical pose)
const MAX_STEP_MS = 50; // dt clamp (tab stalls)
const SUB_MS = 1000 / 120; // fixed sub-step of the spring (stable for omega up to ~60 rad/s)

export function createLookAt(capacity = 64) {
  const S = new Float64Array(capacity * ST);
  const used = new Uint8Array(capacity);
  const rec = new Float64Array(capacity * REC);
  const views = [];
  for (let i = 0; i < capacity; i++) views.push(rec.subarray(i * REC, (i + 1) * REC));
  const io = new Float64Array(8);
  const sc = new Float64Array(4); // scratch: [0] target yaw, [1] target pitch, [2] dt left
  const la = { io, capacity, attach, release, reset, lookOf, update };

  /** -> slot, or -1 when the model has no lookAt block / the pool is full. */
  function attach(pm) {
    if (!pm || !pm.lookAt) return -1;
    for (let s = 0; s < capacity; s++) if (used[s] === 0) { used[s] = 1; reset(s); return s; }
    return -1;
  }
  function release(slot) { if (slot >= 0 && slot < capacity) { used[slot] = 0; reset(slot); } }
  /** Spawn / teleport: head straight, no motion. */
  function reset(slot) {
    if (slot < 0 || slot >= capacity) return;
    S.fill(0, slot * ST, (slot + 1) * ST);
    views[slot][0] = 0;
  }
  function lookOf(slot) { return views[slot]; }

  function wrap180(a) { while (a > 180) a -= 360; while (a <= -180) a += 360; return a; }
  // Limited target (deg) into sc[0] (yaw) / sc[1] (pitch).
  function aim(L) {
    sc[0] = 0; sc[1] = 0;
    if (io[0] !== 1) return;
    const dx = io[5] - io[1], dy = io[6] - io[2], dz = io[7] - io[3];
    const flat = Math.sqrt(dx * dx + dy * dy);
    if (flat < 1e-4 && Math.abs(dz) < 1e-4) return;
    const rel = flat < 1e-4 ? 0 : wrap180(Math.atan2(dx, -dy) * 57.29577951308232 - io[4]);
    if (rel > BEHIND_DEG || rel < -BEHIND_DEG) return;
    sc[0] = rel > L.yawLimit ? L.yawLimit : rel < -L.yawLimit ? -L.yawLimit : rel;
    const pitchUp = Math.atan2(dz, flat) * 57.29577951308232;
    sc[1] = -(pitchUp > L.pitchLimit ? L.pitchLimit : pitchUp < -L.pitchLimit ? -L.pitchLimit : pitchUp); // rx + = down
  }

  /** One render frame. Writes the slot's record (off when settled at neutral and inactive). */
  function update(slot, pm, dtMs) {
    const L = pm.lookAt, o = slot * ST, r = views[slot];
    aim(L);
    const w = L.omega * 0.001; // 1/ms
    let left = dtMs > MAX_STEP_MS ? MAX_STEP_MS : dtMs < 0 ? 0 : dtMs;
    let y = S[o], p = S[o + 1], vy = S[o + 2], vp = S[o + 3];
    const ty = sc[0], tp = sc[1];
    while (left > 0) {
      const h = left > SUB_MS ? SUB_MS : left;
      // critically damped: x'' = w^2 (t - x) - 2 w x'  (semi-implicit Euler; velocity first)
      vy += (w * w * (ty - y) - 2 * w * vy) * h; y += vy * h;
      vp += (w * w * (tp - p) - 2 * w * vp) * h; p += vp * h;
      left -= h;
    }
    if (ty === 0 && tp === 0 && Math.abs(y) < EPS_DEG && Math.abs(p) < EPS_DEG && Math.abs(vy) < 1e-3 && Math.abs(vp) < 1e-3) { y = 0; p = 0; vy = 0; vp = 0; }
    // hard clamp (the spring may overshoot the limit by a hair when the target is at the limit and moving)
    if (y > L.yawLimit) { y = L.yawLimit; if (vy > 0) vy = 0; } else if (y < -L.yawLimit) { y = -L.yawLimit; if (vy < 0) vy = 0; }
    if (p > L.pitchLimit) { p = L.pitchLimit; if (vp > 0) vp = 0; } else if (p < -L.pitchLimit) { p = -L.pitchLimit; if (vp < 0) vp = 0; }
    S[o] = y; S[o + 1] = p; S[o + 2] = vy; S[o + 3] = vp;
    if (y === 0 && p === 0) { r[0] = 0; return; }
    r[0] = 1; r[1] = L.part; r[2] = p; r[3] = 0; r[4] = y;
  }
  return la;
}
