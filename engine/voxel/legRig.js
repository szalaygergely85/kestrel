// engine/voxel/legRig.js - ANIM-C-01 (architecture.md 38.67 sections 2 + 3): `def.legRig` validator + load-time packer.
// Cold path (read once by validateVoxelModel / packVoxelModel); the per-frame 2-bone solve lives in voxelPose.js.
// Imports nothing (VoxelModel.js and voxelPack.js import this).
//
// Angles: rotations are about the part's x axis (Rx convention of the engine: (y,z) -> (c*y - s*z, s*y + c*z)), so the angle of a
// (y,z) vector is atan2(z, y) and a rotation by r adds r to it.

const DEG = 180 / Math.PI;
const LEG_KEYS = ['body', 'legs', 'gaits', 'stand', 'maxPitchDeg', 'maxRollDeg'];
const LEG_ENTRY_KEYS = ['upper', 'lower', 'foot', 'bend'];
const GAIT_KEYS = ['tunedMps', 'duty', 'phase', 'liftM'];
export const LEGRIG_DEFAULT_MAX_PITCH_DEG = 20;
export const LEGRIG_DEFAULT_MAX_ROLL_DEG = 8;
export const MAX_LEGS = 4;
const STRAIGHT_DEG = 2;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; }

/** Rest geometry of one leg in the (y,z) plane: H hip (upper pivot), u = K - H, w = F - K. Returns null when parts are missing. */
function legGeom(def, leg) {
  const pu = def.parts && def.parts[leg.upper], pl = def.parts && def.parts[leg.lower];
  if (!pu || !pl || !Array.isArray(pu.pivot) || !Array.isArray(pl.pivot) || !Array.isArray(leg.foot)) return null;
  const hy = pu.pivot[1], hz = pu.pivot[2];
  const uy = pl.pivot[1] - hy, uz = pl.pivot[2] - hz;
  const wy = leg.foot[1] - pl.pivot[1], wz = leg.foot[2] - pl.pivot[2];
  const phiU = Math.atan2(uz, uy), phiW = Math.atan2(wz, wy);
  return { hy, hz, uy, uz, wy, wz, a: Math.hypot(uy, uz), b: Math.hypot(wy, wz), phiU, phiW, restBend: wrapPi(phiW - phiU) };
}

/** Clip length in seconds, same rule as packClips. */
function clipSeconds(cd) {
  let ms = 0;
  if (cd.fps !== undefined) ms = cd.frames.length * 1000 / cd.fps;
  else for (let i = 0; i < cd.durations.length; i++) ms += cd.durations[i];
  return ms / 1000;
}

function checkKeys(o, allowed, path, errors) {
  for (const k of Object.keys(o)) if (allowed.indexOf(k) < 0) errors.push(`${path}: unknown key '${k}'`);
}

/** Pushes one message per problem into `errors`. Called by validateVoxelModel when `def.legRig !== undefined`. */
export function validateLegRig(def, partNames, errors) {
  const P = 'voxel.legRig';
  const lr = def.legRig;
  if (lr === null || typeof lr !== 'object' || Array.isArray(lr)) { errors.push(`${P}: expected an object`); return; }
  checkKeys(lr, LEG_KEYS, P, errors);
  const parts = def.parts || {};
  if (typeof lr.body !== 'string' || partNames.indexOf(lr.body) < 0) errors.push(`${P}.body: unknown part '${lr.body}'`);
  const clipNames = def.animations && typeof def.animations === 'object' ? Object.keys(def.animations) : [];

  if (!Array.isArray(lr.legs) || lr.legs.length < 2 || lr.legs.length > MAX_LEGS) {
    errors.push(`${P}.legs: expected 2..${MAX_LEGS} legs`);
  } else {
    lr.legs.forEach((leg, i) => {
      const lp = `${P}.legs[${i}]`;
      if (!leg || typeof leg !== 'object' || Array.isArray(leg)) { errors.push(`${lp}: expected an object`); return; }
      checkKeys(leg, LEG_ENTRY_KEYS, lp, errors);
      const upOk = typeof leg.upper === 'string' && partNames.indexOf(leg.upper) >= 0;
      const loOk = typeof leg.lower === 'string' && partNames.indexOf(leg.lower) >= 0;
      if (!upOk) errors.push(`${lp}.upper: unknown part '${leg.upper}'`);
      if (!loOk) errors.push(`${lp}.lower: unknown part '${leg.lower}'`);
      if (upOk && loOk && parts[leg.lower].parent !== leg.upper) errors.push(`${lp}.lower: parent must be '${leg.upper}'`);
      if (!Array.isArray(leg.foot) || leg.foot.length !== 3 || !leg.foot.every(isNum)) { errors.push(`${lp}.foot: expected [x,y,z]`); return; }
      if (leg.bend !== undefined && leg.bend !== 'front' && leg.bend !== 'back') errors.push(`${lp}.bend: expected 'front' | 'back'`);
      if (!upOk || !loOk) return;
      const bx = parts[leg.lower].box;
      if (Array.isArray(bx) && bx.length === 6) {
        for (let k = 0; k < 3; k++) {
          if (!(leg.foot[k] >= bx[k] - 1 && leg.foot[k] <= bx[k + 3] + 1)) { errors.push(`${lp}.foot: outside the lower part box (+-1 cell)`); break; }
        }
      }
      const g = legGeom(def, leg);
      if (!g) return;
      if (g.a < 2) errors.push(`${lp}: |hip->knee| ${g.a.toFixed(2)} < 2 cells`);
      if (g.b < 2) errors.push(`${lp}: |knee->foot| ${g.b.toFixed(2)} < 2 cells`);
      if (g.a >= 2 && g.b >= 2) {
        const bentDeg = Math.abs(g.restBend) * DEG;
        if (bentDeg < STRAIGHT_DEG) {
          if (leg.bend === undefined) errors.push(`${lp}.bend: required when the rest leg is straight (< ${STRAIGHT_DEG} deg)`);
        } else if (leg.bend !== undefined) {
          const rest = g.restBend > 0 ? 'front' : 'back';
          if (leg.bend !== rest) errors.push(`${lp}.bend: '${leg.bend}' contradicts the rest pose ('${rest}')`);
        }
      }
    });
  }
  const nLegs = Array.isArray(lr.legs) ? lr.legs.length : 0;
  // the driver (stand-step pairs k >> 1, body pitch) assumes 4 legs ordered fore pair, then hind pair (fore = smaller foot y, head at y0)
  if (nLegs === 4 && lr.legs.every((l) => l && Array.isArray(l.foot) && isNum(l.foot[1]))) {
    const fy = lr.legs.map((l) => l.foot[1]);
    if (!(Math.max(fy[0], fy[1]) < Math.min(fy[2], fy[3]))) errors.push(`${P}.legs: 4 legs must be ordered fore pair (legs 0,1) then hind pair (legs 2,3), fore = smaller foot y, head at y0`);
  }

  if (lr.gaits === null || typeof lr.gaits !== 'object' || Array.isArray(lr.gaits)) {
    errors.push(`${P}.gaits: expected an object`);
  } else {
    for (const name of Object.keys(lr.gaits)) {
      const gp = `${P}.gaits['${name}']`, g = lr.gaits[name];
      if (clipNames.indexOf(name) < 0) errors.push(`${gp}: not a clip of the model`);
      if (!g || typeof g !== 'object' || Array.isArray(g)) { errors.push(`${gp}: expected an object`); continue; }
      checkKeys(g, GAIT_KEYS, gp, errors);
      if (!(isNum(g.tunedMps) && g.tunedMps > 0)) errors.push(`${gp}.tunedMps: expected a number > 0`);
      if (!(isNum(g.duty) && g.duty >= 0.3 && g.duty <= 0.9)) errors.push(`${gp}.duty: expected 0.3..0.9`);
      if (!(isNum(g.liftM) && g.liftM >= 0 && g.liftM <= 0.5)) errors.push(`${gp}.liftM: expected 0..0.5`);
      if (!Array.isArray(g.phase) || g.phase.length !== nLegs) errors.push(`${gp}.phase: expected ${nLegs} entries (one per leg)`);
      else if (!g.phase.every((v) => isNum(v) && v >= 0 && v < 1)) errors.push(`${gp}.phase: every value must be in [0, 1)`);
    }
  }
  if (!Array.isArray(lr.stand)) errors.push(`${P}.stand: expected an array of clip names`);
  else lr.stand.forEach((c, i) => { if (clipNames.indexOf(c) < 0) errors.push(`${P}.stand[${i}]: '${c}' is not a clip of the model`); });
  for (const k of ['maxPitchDeg', 'maxRollDeg']) {
    if (lr[k] !== undefined && !(isNum(lr[k]) && lr[k] >= 0 && lr[k] <= 90)) errors.push(`${P}.${k}: expected 0..90`);
  }
}

/**
 * Packs a VALIDATED `def.legRig` (null when absent -> everything stays byte-identical).
 * partNames = Object.keys(def.parts) (part index order); clip index = Object.keys(def.animations) order.
 * geo (stride 12 per leg) = [Hy, Hz, uy, uz, wy, wz, a, b, phiU, phiW, sigma, footX]; angles in radians, lengths in cells.
 * gait (stride 4+n per gait) = [tunedMps, duty, liftM, T seconds, phase...]. maxPitch/maxRoll in degrees.
 * upperOf / lowerOf (Int8Array(partCount)): leg index of a part, else -1 (lookup for the pose loop).
 */
export function packLegRig(def, partNames) {
  const lr = def.legRig;
  if (!lr) return null;
  const n = lr.legs.length, partCount = partNames.length;
  const upper = new Uint8Array(n), lower = new Uint8Array(n), geo = new Float64Array(n * 12);
  const upperOf = new Int8Array(partCount).fill(-1), lowerOf = new Int8Array(partCount).fill(-1);
  for (let i = 0; i < n; i++) {
    const leg = lr.legs[i], g = legGeom(def, leg);
    upper[i] = partNames.indexOf(leg.upper); lower[i] = partNames.indexOf(leg.lower);
    upperOf[upper[i]] = i; lowerOf[lower[i]] = i;
    const sigma = Math.abs(g.restBend) * DEG >= STRAIGHT_DEG ? (g.restBend > 0 ? 1 : -1) : (leg.bend === 'front' ? 1 : -1);
    const o = i * 12;
    geo[o] = g.hy; geo[o + 1] = g.hz; geo[o + 2] = g.uy; geo[o + 3] = g.uz; geo[o + 4] = g.wy; geo[o + 5] = g.wz;
    geo[o + 6] = g.a; geo[o + 7] = g.b; geo[o + 8] = g.phiU; geo[o + 9] = g.phiW; geo[o + 10] = sigma; geo[o + 11] = leg.foot[0];
  }
  const clipNames = def.animations ? Object.keys(def.animations) : [];
  const gaitNames = Object.keys(lr.gaits);
  const gaitClip = new Int16Array(clipNames.length).fill(-1);
  const standClip = new Uint8Array(clipNames.length);
  const gs = 4 + n, gait = new Float64Array(gaitNames.length * gs);
  gaitNames.forEach((name, gi) => {
    const g = lr.gaits[name], o = gi * gs;
    gaitClip[clipNames.indexOf(name)] = gi;
    gait[o] = g.tunedMps; gait[o + 1] = g.duty; gait[o + 2] = g.liftM; gait[o + 3] = clipSeconds(def.animations[name]);
    for (let k = 0; k < n; k++) gait[o + 4 + k] = g.phase[k];
  });
  for (const c of lr.stand) standClip[clipNames.indexOf(c)] = 1;
  return {
    bodyIdx: partNames.indexOf(lr.body), n, upper, lower, upperOf, lowerOf, geo, gaitClip, standClip, gait,
    maxPitch: lr.maxPitchDeg !== undefined ? lr.maxPitchDeg : LEGRIG_DEFAULT_MAX_PITCH_DEG,
    maxRoll: lr.maxRollDeg !== undefined ? lr.maxRollDeg : LEGRIG_DEFAULT_MAX_ROLL_DEG,
  };
}
