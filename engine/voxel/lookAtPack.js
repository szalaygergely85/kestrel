// engine/voxel/lookAtPack.js - ANIM-LOOKAT-01 (architecture.md 38.69, lane note): `def.lookAt` validator + load-time packer.
// def.lookAt = { part: string, yawLimitDeg: number, pitchLimitDeg: number, hz?: number }  (cold; imports nothing).
// part = the head part; limits are the max head turn (yaw) / nod (pitch) from its animated pose; hz = follow speed (omega = 2*pi*hz, default 1.5).
const KEYS = ['part', 'yawLimitDeg', 'pitchLimitDeg', 'hz'];
export const LOOKAT_DEFAULT_HZ = 1.5;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function validateLookAt(def, partNames, errors) {
  const P = 'voxel.lookAt', la = def.lookAt;
  if (la === null || typeof la !== 'object' || Array.isArray(la)) { errors.push(`${P}: expected an object`); return; }
  for (const k of Object.keys(la)) if (KEYS.indexOf(k) < 0) errors.push(`${P}: unknown key '${k}'`);
  if (typeof la.part !== 'string' || partNames.indexOf(la.part) < 0) errors.push(`${P}.part: unknown part '${la.part}'`);
  if (!isNum(la.yawLimitDeg) || la.yawLimitDeg < 0 || la.yawLimitDeg > 120) errors.push(`${P}.yawLimitDeg: expected a number in [0, 120]`);
  if (!isNum(la.pitchLimitDeg) || la.pitchLimitDeg < 0 || la.pitchLimitDeg > 80) errors.push(`${P}.pitchLimitDeg: expected a number in [0, 80]`);
  if (la.hz !== undefined && (!isNum(la.hz) || la.hz <= 0 || la.hz > 10)) errors.push(`${P}.hz: expected a number in (0, 10]`);
}

/** Packs a VALIDATED def.lookAt (null when absent -> byte-identical everywhere). */
export function packLookAt(def, partNames) {
  const la = def.lookAt;
  if (!la) return null;
  return { part: partNames.indexOf(la.part), yawLimit: la.yawLimitDeg, pitchLimit: la.pitchLimitDeg, omega: 2 * Math.PI * (la.hz || LOOKAT_DEFAULT_HZ) };
}
