// engine/entities/legDriver.js - ANIM-C-02 (architecture.md 38.67 section 3 "Driver"): per-frame, view-only leg planner.
// Reads the root position the sim already produced and writes only a LegPose (Float64Array(16) per slot, read by the in-pose solve in
// voxelPose.js): [w, bodyRx, bodyRy, bodyZcells, (tx,ty,tz) x 4 world metres]. Body pitch/roll/drop from the foot heights (C-03); no pool wiring (C-04).
// Imports nothing. No Math.random, no wall clock; state is one struct-of-arrays Float64Array, 0 allocation per update.
//
// Model frame: +y forward, +x right, z up; world = Rz(yawDeg) * model, so forward in the world is (-sin yaw, cos yaw).
// Stance feet are fixed world points (no slide at any speed, by construction); swing feet fly from lift-off to a predicted landing point
// that is queried ONCE at swing start and re-queried ONCE at q = 0.5 (2 groundAt per foot per stride).

export const SOLVE_MAX = 16;
export const SOLVE_R = 35;
export const SOLVE_R_HYST = 38;
const TELEPORT_M = 1.5;
const EMA_TAU = 0.15;       // s, speed smoothing (BEAST-01)
const W_FADE = 1 / 0.15;    // w moves linearly in 150 ms
const STAND_V = 0.15;       // m/s below which the driver stands still
const STEP_TIME = 0.25;     // s, one stand step
const FLAT_TOL = 0.25;      // m, |groundAt - rootZ| beyond which the flat fallback is used
const POSE_STRIDE = 16;
const HDR = 24, FOOT = 16, MAX_FEET = 4, STATE_STRIDE = HDR + FOOT * MAX_FEET;
// header
const H_INIT = 0, H_LX = 1, H_LY = 2, H_VX = 3, H_VY = 4, H_PHI = 5, H_W = 6, H_VALID = 7, H_D2 = 8, H_USED = 9, H_SOLVED = 10;
// body tilt state (value, velocity): pitch deg, roll deg, drop metres
const H_PIT = 11, H_ROL = 13, H_DRP = 15;
const TILT_TAU = 0.12;      // s, critical damping of pitch / roll / drop
const DROP_MAX = 0.35;      // x leg length
// per foot
const F_MODE = 0, F_PX = 1, F_LX = 4, F_GX = 7, F_T = 10, F_REPLAN = 11, F_PAT = 12; // F_PAT: footfall pattern (gait index + 1, 0 = unset), blender mode only
// // px,py,pz / lift-off / landing triples
const M_STANCE = 0, M_SWING = 1, M_STEP = 2;

const _land = new Float64Array(3); // scratch return of landing()
const _gz = new Float64Array(4);   // groundZ(): [0] result, [1] x, [2] y, [3] rootZ in (typed slots: no boxed double crosses the call)
const _lf = new Float64Array(1);   // scratch return of swingPos() (lift)
const _sp = new Float64Array(3);   // swingPos args: q, lift, zOff (typed: no boxed double args)
const _li = new Float64Array(12);  // landing args, see call sites
const _lift = new Float64Array(4); // swing lift of each foot this frame (removed from the foot height for the body plane)
const DEG = 180 / Math.PI;

function smooth(q) { return q * q * (3 - 2 * q); }

export function createLegDriver(capacity = 48) {
  const state = new Float64Array(capacity * STATE_STRIDE);
  const poses = new Float64Array(capacity * POSE_STRIDE);
  const poseViews = [];
  for (let i = 0; i < capacity; i++) poseViews.push(poses.subarray(i * POSE_STRIDE, (i + 1) * POSE_STRIDE));
  for (let i = 0; i < capacity; i++) state[i * STATE_STRIDE + H_D2] = Infinity;
  // io: [x, y, z, yawDeg, dtMs, camX, camY, (4 spare), phase01, speed, active, blendStride (m; ANIM-BLEND-01c, 0 = own formula)]
  const io = new Float64Array(16);
  const drv = { io, queries: 0, capacity, attach, release, reset, poseOf, update };

  function attach(pm) {
    if (!pm || !pm.legRig) return -1;
    for (let s = 0; s < capacity; s++) {
      const o = s * STATE_STRIDE;
      if (state[o + H_USED] === 0) {
        state.fill(0, o, o + STATE_STRIDE);
        state[o + H_USED] = 1; state[o + H_D2] = Infinity;
        poses.fill(0, s * POSE_STRIDE, (s + 1) * POSE_STRIDE);
        return s;
      }
    }
    return -1;
  }
  function release(slot) {
    if (slot < 0) return;
    const o = slot * STATE_STRIDE;
    state.fill(0, o, o + STATE_STRIDE);
    state[o + H_D2] = Infinity;
    poses.fill(0, slot * POSE_STRIDE, (slot + 1) * POSE_STRIDE);
  }
  /** Next update re-plants every foot at its rest point (one query per foot) and restarts the speed EMA. */
  function reset(slot) {
    const o = slot * STATE_STRIDE;
    state[o + H_INIT] = 0; state[o + H_VALID] = 0;
  }
  function poseOf(slot) { return poseViews[slot]; }

  /** Ground height under (x,y) for a foot; falls back to the root height when the query fails or is far off (swim, odd floor). */
  let flatFrame = false; // set by a fallback: no more queries until the next update
  // Optional zero-alloc ground query: `ground.groundAtQ(q)` reads q[0]=x, q[1]=y and writes q[2]=height (NaN = no ground).
  // Plain `groundAt(x, y)` still works but boxes its doubles on Node 24 (a callback we do not control).
  const _gq = new Float64Array(3);
  function groundZ(ground) { // in _gz[1..3] (x, y, rootZ), result in _gz[0]
    const rootZ = _gz[3];
    if (flatFrame) { _gz[0] = rootZ; return; }
    drv.queries++;
    let h = null;
    if (ground) {
      if (ground.groundAtQ !== undefined) { _gq[0] = _gz[1]; _gq[1] = _gz[2]; _gq[2] = NaN; ground.groundAtQ(_gq); h = _gq[2]; if (h !== h) h = null; }
      else h = ground.groundAt(_gz[1], _gz[2]);
    }
    if (h === null || h === undefined || !(Math.abs(h - rootZ) <= FLAT_TOL)) { flatFrame = true; _gz[0] = rootZ; return; }
    _gz[0] = h;
  }

  function update(slot, pm, clipIdx, ground) {
    const lr = pm.legRig;
    if (slot < 0 || !lr) { io[10] = 0; return; }
    const x = io[0], y = io[1], z = io[2], yaw = io[3], dt = io[4] * 0.001;
    const S = slot * STATE_STRIDE, P = slot * POSE_STRIDE;
    const n = lr.n, cm = pm.cellM, anc = pm.anchor, geo = lr.geo;
    const yr = yaw * Math.PI / 180, cs = Math.cos(yr), sn = Math.sin(yr);

    // ---- LOD: nearest SOLVE_MAX attached animals within SOLVE_R (other slots' d2 are last frame's: deterministic, one frame stale)
    const cx = x - io[5], cy = y - io[6], d2 = cx * cx + cy * cy;
    state[S + H_D2] = d2;
    let rank = 0;
    for (let j = 0; j < capacity; j++) {
      const dj = state[j * STATE_STRIDE + H_D2];
      if (j !== slot && (dj < d2 || (dj === d2 && j < slot))) rank++;
    }
    const rr = state[S + H_SOLVED] ? SOLVE_R_HYST : SOLVE_R;
    const inLod = rank < SOLVE_MAX && d2 < rr * rr;
    state[S + H_SOLVED] = inLod ? 1 : 0;

    // ---- clip -> gait / stand
    const nClips = lr.gaitClip.length;
    const gi = clipIdx >= 0 && clipIdx < nClips ? lr.gaitClip[clipIdx] : -1;
    const isStand = clipIdx >= 0 && clipIdx < nClips && lr.standClip[clipIdx] === 1;
    const gs = 4 + n, nGaits = (lr.gait.length / gs) | 0;
    const gIdx = gi >= 0 ? gi : (nGaits > 0 ? 0 : -1);
    const want = inLod && (gi >= 0 || isStand);

    // ---- teleport / first update / speed EMA
    let didReset = false;
    if (state[S + H_INIT] === 0) {
      state[S + H_INIT] = 1; state[S + H_VX] = 0; state[S + H_VY] = 0; didReset = true;
    } else {
      const ddx = x - state[S + H_LX], ddy = y - state[S + H_LY];
      if (ddx * ddx + ddy * ddy > TELEPORT_M * TELEPORT_M) { state[S + H_VX] = 0; state[S + H_VY] = 0; didReset = true; }
      else if (dt > 0) {
        const a = 1 - Math.exp(-dt / EMA_TAU);
        state[S + H_VX] += a * (ddx / dt - state[S + H_VX]);
        state[S + H_VY] += a * (ddy / dt - state[S + H_VY]);
      }
    }
    state[S + H_LX] = x; state[S + H_LY] = y;
    const vx = state[S + H_VX], vy = state[S + H_VY], v = Math.sqrt(vx * vx + vy * vy);

    // ---- gait phase
    let Phi = state[S + H_PHI];
    const bs = io[11]; // blender stride (m); > 0 also switches the footfall pattern per foot at touchdown
    let tuned = 1, duty = 0.6, lift = 0.05, stride = 1;
    const gO = gIdx * gs;
    if (gIdx >= 0) {
      tuned = lr.gait[gO]; duty = lr.gait[gO + 1]; lift = lr.gait[gO + 2];
      if (bs > 0) stride = bs; // ANIM-BLEND-01c: the blender's blended stride (m) replaces the per-gait formula
      else { let f = Math.sqrt(v / tuned); if (f < 0.8) f = 0.8; else if (f > 1.25) f = 1.25; stride = tuned * lr.gait[gO + 3] * f; }
      Phi += v * dt / stride;
      Phi -= Math.floor(Phi);
      state[S + H_PHI] = Phi;
    }
    io[8] = Phi; io[9] = v;

    // ---- w fade
    let w = state[S + H_W];
    const wt = want ? 1 : 0;
    const dw = W_FADE * dt;
    if (w < wt) { w += dw; if (w > wt) w = wt; } else if (w > wt) { w -= dw; if (w < wt) w = wt; }
    state[S + H_W] = w;
    poses[P] = w; poses[P + 1] = 0; poses[P + 2] = 0; poses[P + 3] = 0;
    io[10] = w > 0 ? 1 : 0;
    if (w === 0 && !want) { state[S + H_VALID] = 0; return; } // not solved: feet are re-planted when it turns on again

    // ---- feet
    flatFrame = false;
    if (didReset || state[S + H_VALID] === 0) {
      state[S + H_VALID] = 1;
      for (let k = 0; k < n; k++) {
        const F = S + HDR + k * FOOT, o = k * 12;
        const mx = (geo[o + 11] - anc[0]) * cm, my = (restY(geo, o) - anc[1]) * cm;
        const px = x + cs * mx - sn * my, py = y + sn * mx + cs * my;
        _gz[1] = px; _gz[2] = py; _gz[3] = z; groundZ(ground); const gz = _gz[0];
        state[F + F_MODE] = M_STANCE; state[F + F_PX] = px; state[F + F_PX + 1] = py; state[F + F_PX + 2] = gz;
        state[F + F_REPLAN] = 0; state[F + F_PAT] = 0;
      }
    }
    const standMode = isStand || gi < 0 || v < STAND_V;
    const dirx = v > 0.01 ? vx / v : -sn, diry = v > 0.01 ? vy / v : cs;
    const reach = Math.max(0.25 * (geo[6] + geo[7]) * cm, 0.15);
    const t0 = P + 4;
    for (let k = 0; k < n; k++) {
      const F = S + HDR + k * FOOT, o = k * 12, T = t0 + k * 3;
      _lift[k] = 0;
      const zOff = (restZ(geo, o) - anc[2]) * cm;
      const mx = (geo[o + 11] - anc[0]) * cm, my = (restY(geo, o) - anc[1]) * cm;
      const rx = x + cs * mx - sn * my, ry = y + sn * mx + cs * my; // rest point, world xy
      let mode = state[F + F_MODE];
      // gait swing cannot continue in stand mode: turn it into a timed step to its landing point
      if (standMode && mode === M_SWING) {
        state[F + F_LX] = poses[T]; state[F + F_LX + 1] = poses[T + 1]; state[F + F_LX + 2] = poses[T + 2] - zOff;
        state[F + F_T] = 0; mode = state[F + F_MODE] = M_STEP;
      }
      if (mode === M_STEP) {
        const tm = state[F + F_T] + dt;
        if (tm >= STEP_TIME) { plant(state, F); mode = state[F + F_MODE] = M_STANCE; }
        else { state[F + F_T] = tm; _sp[0] = tm / STEP_TIME; _sp[1] = lift; _sp[2] = zOff; swingPos(state, F, poses, T); _lift[k] = _lf[0]; continue; }
      }
      if (standMode) {
        if (mode === M_STANCE) {
          const ex = state[F + F_PX] - rx, ey = state[F + F_PX + 1] - ry;
          if (ex * ex + ey * ey > reach * reach) {
            // one foot of a pair at a time (pair = k >> 1: fore / hind for the 4-leg order, both for 2 legs)
            const k0 = (k >> 1) << 1;
            let busy = false;
            for (let m = k0; m < k0 + 2 && m < n; m++) if (m !== k && state[S + HDR + m * FOOT + F_MODE] === M_STEP) busy = true;
            if (!busy) {
              state[F + F_LX] = state[F + F_PX]; state[F + F_LX + 1] = state[F + F_PX + 1]; state[F + F_LX + 2] = state[F + F_PX + 2];
              _gz[1] = rx; _gz[2] = ry; _gz[3] = z; groundZ(ground); const gz = _gz[0];
              state[F + F_GX] = rx; state[F + F_GX + 1] = ry; state[F + F_GX + 2] = gz;
              state[F + F_T] = 0; state[F + F_MODE] = M_STEP;
              _sp[0] = 0; _sp[1] = lift; _sp[2] = zOff; swingPos(state, F, poses, T); _lift[k] = _lf[0];
              continue;
            }
          }
          poses[T] = state[F + F_PX]; poses[T + 1] = state[F + F_PX + 1]; poses[T + 2] = state[F + F_PX + 2] + zOff;
        }
        continue;
      }
      // gait: stance / swing from the phase
      // footfall pattern of this foot: the dominant gait now, or (blender mode) the one adopted at its last touchdown
      let gk = gO;
      if (bs > 0 && gIdx >= 0) { if (state[F + F_PAT] === 0) state[F + F_PAT] = gIdx + 1; gk = (state[F + F_PAT] - 1) * gs; } else state[F + F_PAT] = 0;
      let phi = Phi - lr.gait[gk + 4 + k]; phi -= Math.floor(phi);
      if (mode === M_SWING && phi < lr.gait[gk + 1]) {
        plant(state, F); mode = state[F + F_MODE] = M_STANCE; // touchdown (no query)
        if (bs > 0 && gIdx >= 0) { state[F + F_PAT] = gIdx + 1; gk = gO; phi = Phi - lr.gait[gk + 4 + k]; phi -= Math.floor(phi); } // new pattern from here
      }
      else if (mode === M_STANCE && phi >= lr.gait[gk + 1]) {
        state[F + F_LX] = state[F + F_PX]; state[F + F_LX + 1] = state[F + F_PX + 1]; state[F + F_LX + 2] = state[F + F_PX + 2];
        _li[0] = dirx; _li[1] = diry; _li[2] = mx; _li[3] = my; _li[4] = 1 - phi; _li[5] = stride; _li[6] = lr.gait[gk + 1]; _li[7] = x; _li[8] = y; _li[9] = z; _li[10] = cs; _li[11] = sn; landing(ground);
        state[F + F_GX] = _land[0]; state[F + F_GX + 1] = _land[1]; state[F + F_GX + 2] = _land[2];
        state[F + F_REPLAN] = 0; mode = state[F + F_MODE] = M_SWING;
      }
      if (mode === M_SWING) {
        const dutyK = lr.gait[gk + 1], q = (phi - dutyK) / (1 - dutyK);
        if (q >= 0.5 && state[F + F_REPLAN] === 0) {
          state[F + F_REPLAN] = 1;
          _li[0] = dirx; _li[1] = diry; _li[2] = mx; _li[3] = my; _li[4] = 1 - phi; _li[5] = stride; _li[6] = dutyK; _li[7] = x; _li[8] = y; _li[9] = z; _li[10] = cs; _li[11] = sn; landing(ground);
          state[F + F_GX] = _land[0]; state[F + F_GX + 1] = _land[1]; state[F + F_GX + 2] = _land[2];
        }
        _sp[0] = q; _sp[1] = lr.gait[gk + 2]; _sp[2] = zOff; swingPos(state, F, poses, T); _lift[k] = _lf[0];
      } else {
        poses[T] = state[F + F_PX]; poses[T + 1] = state[F + F_PX + 1]; poses[T + 2] = state[F + F_PX + 2] + zOff;
      }
    }
    bodyTilt(S, P, lr, pm, z, dt, w, didReset);
  }

  // ANIM-C-03: body pitch / roll / drop from the foot ground heights (38.67 section 3 "Body on slopes").
  // Order assumption (validated by validateLegRig): legs 0,1 are the fore pair, 2,3 the hind pair. Bipeds: roll only, pitch 0.
  // On a flat fallback frame the targets are 0 (the body eases back to level).
  function bodyTilt(S, P, lr, pm, rootZ, dt, w, snap) {
    const n = lr.n, cm = pm.cellM, anc = pm.anchor, geo = lr.geo, t0 = P + 4;
    let tPit = 0, tRol = 0, tDrp = 0;
    if (!flatFrame) {
      let mxs = 0, legM = 0;
      for (let k = 0; k < n; k++) { mxs += (geo[k * 12 + 11] - anc[0]) * cm; const l = (geo[k * 12 + 6] + geo[k * 12 + 7]) * cm; if (l > legM) legM = l; }
      mxs /= n;
      let hF = 0, hH = 0, yF = 0, yH = 0, nF = 0, nH = 0, hL = 0, hR = 0, xL = 0, xR = 0, nL = 0, nR = 0;
      for (let k = 0; k < n; k++) {
        const o = k * 12, mx = (geo[o + 11] - anc[0]) * cm, my = (restY(geo, o) - anc[1]) * cm;
        const g = poses[t0 + k * 3 + 2] - (restZ(geo, o) - anc[2]) * cm - _lift[k] - rootZ;
        if (n > 2 && k >= 2) { hH += g; yH += my; nH++; } else { hF += g; yF += my; nF++; }
        if (mx < mxs) { hL += g; xL += mx; nL++; } else { hR += g; xR += mx; nR++; }
      }
      if (nH > 0 && nF > 0) {
        const lfh = yH / nH - yF / nF; // model front = smaller y (head at y0, rx+ = nose down)
        if (lfh > 1e-3) tPit = -Math.atan2(hF / nF - hH / nH, lfh) * DEG;
      }
      if (nL > 0 && nR > 0) {
        const wd = xR / nR - xL / nL;
        if (wd > 1e-3) tRol = 0.5 * Math.atan2(hL / nL - hR / nR, wd) * DEG;
      }
      if (tPit > lr.maxPitch) tPit = lr.maxPitch; else if (tPit < -lr.maxPitch) tPit = -lr.maxPitch;
      if (tRol > lr.maxRoll) tRol = lr.maxRoll; else if (tRol < -lr.maxRoll) tRol = -lr.maxRoll;
      // drop: lowest foot below the tilted plane. Plane height at a foot = tan(pitch) * y - tan(roll) * x (body-local metres).
      const tp = Math.tan(tPit / DEG), tr = Math.tan(tRol / DEG);
      let low = 0;
      for (let k = 0; k < n; k++) {
        const o = k * 12, mx = (geo[o + 11] - anc[0]) * cm, my = (restY(geo, o) - anc[1]) * cm;
        const g = poses[t0 + k * 3 + 2] - (restZ(geo, o) - anc[2]) * cm - _lift[k] - rootZ;
        const r = g - (tp * my - tr * mx);
        if (r < low) low = r;
      }
      tDrp = low < -DROP_MAX * legM ? -DROP_MAX * legM : low;
    }
    // critical damping (semi-implicit), snapped on reset
    if (snap) {
      state[S + H_PIT] = tPit; state[S + H_PIT + 1] = 0; state[S + H_ROL] = tRol; state[S + H_ROL + 1] = 0; state[S + H_DRP] = tDrp; state[S + H_DRP + 1] = 0;
    } else if (dt > 0) {
      const d = dt > 0.05 ? 0.05 : dt, om = 1 / TILT_TAU;
      damp(state, S + H_PIT, tPit, om, d); damp(state, S + H_ROL, tRol, om, d); damp(state, S + H_DRP, tDrp, om, d);
    }
    poses[P + 1] = state[S + H_PIT] * w;
    poses[P + 2] = state[S + H_ROL] * w;
    poses[P + 3] = state[S + H_DRP] / cm * w;
  }

  // Landing point after `dPhi` more cycle: predicted root + yaw-rotated rest foot + forward * duty*S/2; ONE groundAt (-> _land).
  function landing(ground) {
    const dx = _li[0], dy = _li[1], mx = _li[2], my = _li[3], stride = _li[5], cs = _li[10], sn = _li[11];
    const adv = _li[4] * stride + _li[6] * stride * 0.5;
    const lx = _li[7] + cs * mx - sn * my + dx * adv, ly = _li[8] + sn * mx + cs * my + dy * adv;
    _land[0] = lx; _land[1] = ly; _gz[1] = lx; _gz[2] = ly; _gz[3] = _li[9]; groundZ(ground); _land[2] = _gz[0];
  }

  return drv;
}

function restY(geo, o) { return geo[o] + geo[o + 2] + geo[o + 4]; }   // foot y = hipY + u.y + w.y (model cells)
function restZ(geo, o) { return geo[o + 1] + geo[o + 3] + geo[o + 5]; } // foot z

function damp(st, i, target, om, d) {
  const a = om * om * (target - st[i]) - 2 * om * st[i + 1];
  st[i + 1] += a * d; st[i] += st[i + 1] * d;
}

function plant(state, F) {
  state[F + F_PX] = state[F + F_GX]; state[F + F_PX + 1] = state[F + F_GX + 1]; state[F + F_PX + 2] = state[F + F_GX + 2];
}

// Swing / step target at q in [0, 1]: xy smoothstep lift-off -> landing, z linear + liftM * sin(pi q). zOff = rest foot height above the ground.
function swingPos(state, F, poses, T) { // args q, lift, zOff in _sp; lift result in _lf[0]
  let q = _sp[0]; const lift = _sp[1], zOff = _sp[2];
  if (q < 0) q = 0; else if (q > 1) q = 1;
  const s = smooth(q);
  poses[T] = state[F + F_LX] + (state[F + F_GX] - state[F + F_LX]) * s;
  poses[T + 1] = state[F + F_LX + 1] + (state[F + F_GX + 1] - state[F + F_LX + 1]) * s;
  const lf = lift * Math.sin(Math.PI * q);
  poses[T + 2] = state[F + F_LX + 2] + (state[F + F_GX + 2] - state[F + F_LX + 2]) * q + lf + zOff;
  _lf[0] = lf;
}
