// engine/entities/footIk.js - ANIM-IK-01 (player): per-frame foot-placement planner for a clip-driven biped.
// Design (docs/lanes/pc-b2.md): it does NOT plant feet itself (the clip walks); it takes where the clip puts each foot in the world and
// shifts that target by the ground height under it, then writes a LegPose (same Float64Array(16) the in-pose 2-bone solve of voxelPose.js
// reads: [w, bodyRx, bodyRy, bodyZcells, (tx,ty,tz) x n world m]). The solve (knee bends toward the rest bend side, reach clamp, joint
// limits) is the D-101 one, so no new pose maths. The pelvis (body part) drops by the lowest foot offset so both feet stay in reach.
// View-only, imports nothing, no Math.random / clock, 0 allocation per update. w = 0 (off, airborne, swimming, no legRig) = today's pose.
//
// Callers (all world metres; model frame +y forward):
//   io = driver.io: [x, y, z, yawDeg, dtMs, off(1 = airborne / swimming / disabled), (fx, fy, fz) x n = clip foot positions]
//   clip foot position = voxelPointWorld(pm, instWithLegsNull, lowerPartIdx, foot cells...) (one pose call, outside this module)
//   ground = anything with groundAt(x, y) -> number|null (World.groundAt / terrain band or floor; 0-alloc)

const POSE_STRIDE = 16, IO_FOOT0 = 6, MAX_LEGS = 4;
const HDR = 8, STATE_STRIDE = HDR + MAX_LEGS; // header: used, init, w, drop ; then per-foot smoothed offsets
const S_USED = 0, S_INIT = 1, S_W = 2, S_DROP = 3;
export const FOOTIK_STEP_MAX = 0.6;   // m, |ground - root z| beyond which the foot follows the flat fallback (swim, odd floor)
export const FOOTIK_OFFSET_MAX = 0.5; // m, per-foot clamp
const DROP_MAX = 0.35;                // x leg length
const W_FADE = 1 / 0.12;              // w moves linearly in 120 ms
const NEED_M = 0.02;                  // m, correction at which the solve is fully on
const TAU = 0.06;                     // s, exponential smoothing of the foot offsets and the pelvis drop

export function createFootIk(capacity = 4) {
  const state = new Float64Array(capacity * STATE_STRIDE);
  const poses = new Float64Array(capacity * POSE_STRIDE);
  const views = [];
  for (let i = 0; i < capacity; i++) views.push(poses.subarray(i * POSE_STRIDE, (i + 1) * POSE_STRIDE));
  const io = new Float64Array(IO_FOOT0 + 3 * MAX_LEGS);
  const drv = { io, queries: 0, capacity, attach, release, reset, poseOf: (s) => views[s], update };

  function attach(pm) {
    if (!pm || !pm.legRig || pm.legRig.n > MAX_LEGS) return -1;
    for (let s = 0; s < capacity; s++) {
      const o = s * STATE_STRIDE;
      if (state[o + S_USED] === 0) { state.fill(0, o, o + STATE_STRIDE); state[o + S_USED] = 1; poses.fill(0, s * POSE_STRIDE, (s + 1) * POSE_STRIDE); return s; }
    }
    return -1;
  }
  function release(slot) {
    if (slot < 0) return;
    state.fill(0, slot * STATE_STRIDE, (slot + 1) * STATE_STRIDE);
    poses.fill(0, slot * POSE_STRIDE, (slot + 1) * POSE_STRIDE);
  }
  /** Next update snaps the smoothed offsets to the current ground (teleport, respawn). */
  function reset(slot) { if (slot >= 0) state[slot * STATE_STRIDE + S_INIT] = 0; }

  function update(slot, pm, ground) {
    const lr = pm && pm.legRig;
    if (slot < 0 || !lr) return;
    const S = slot * STATE_STRIDE, P = slot * POSE_STRIDE;
    const n = lr.n, cm = pm.cellM, anc = pm.anchor, geo = lr.geo;
    const z = io[2], dt = io[4] * 0.001;
    const want = io[5] === 0 && ground ? 1 : 0;
    let w = state[S + S_W];
    const dw = W_FADE * dt;
    if (w < want) { w += dw; if (w > want) w = want; } else if (w > want) { w -= dw; if (w < want) w = want; }
    state[S + S_W] = w;
    poses[P] = w; poses[P + 1] = 0; poses[P + 2] = 0; poses[P + 3] = 0;
    if (w === 0 && !want) { state[S + S_INIT] = 0; return; } // off: no queries; next enable snaps
    const snap = state[S + S_INIT] === 0;
    state[S + S_INIT] = 1;
    const a = snap || dt <= 0 ? 1 : 1 - Math.exp(-(dt > 0.05 ? 0.05 : dt) / TAU);
    let low = 0, legM = 0;
    for (let k = 0; k < n; k++) {
      const o = IO_FOOT0 + 3 * k, g0 = k * 12;
      const fx = io[o], fy = io[o + 1], fz = io[o + 2];
      let off = 0;
      if (want) {
        drv.queries++;
        const h = ground.groundAt(fx, fy);
        if (h !== null && h !== undefined) { off = h - z; if (!(Math.abs(off) <= FOOTIK_STEP_MAX)) off = 0; }
        if (off > FOOTIK_OFFSET_MAX) off = FOOTIK_OFFSET_MAX; else if (off < -FOOTIK_OFFSET_MAX) off = -FOOTIK_OFFSET_MAX;
      }
      const so = S + HDR + k;
      state[so] += (off - state[so]) * a;
      poses[P + 4 + 3 * k] = fx; poses[P + 5 + 3 * k] = fy; poses[P + 6 + 3 * k] = fz + state[so];
      if (state[so] < low) low = state[so];
      const l = (geo[g0 + 6] + geo[g0 + 7]) * cm; if (l > legM) legM = l;
    }
    // pelvis: drop by the lowest foot so both stay in reach (never raised: a raised foot just bends its knee)
    if (low < -DROP_MAX * legM) low = -DROP_MAX * legM;
    state[S + S_DROP] += (low - state[S + S_DROP]) * a;
    poses[P + 3] = state[S + S_DROP] / cm * w;
    // flat ground = clip pose untouched: the solve only fades in with the size of the correction (full at >= NEED_M)
    let need = -low; for (let k = 0; k < n; k++) { const v = Math.abs(state[S + HDR + k]); if (v > need) need = v; }
    need = need >= NEED_M ? 1 : need / NEED_M; need = need * need * (3 - 2 * need);
    poses[P] = w * need; poses[P + 3] *= need;
  }
  return drv;
}
