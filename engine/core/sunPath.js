// US-122a: equinox sun path, compass azimuth (x east, y south).
const DEG = Math.PI / 180;

/** @typedef {{latDeg:number, declDeg:number, h0?:number}} SunPath */
/** @typedef {{elevationDeg:number, azimuthDeg:number}} SunPos */

/** Fits a declination-zero path through a fixed world/level sun. */
export function sunPathFrom({ elevation, azimuth }) {
  const el = elevation * DEG, az = azimuth * DEG;
  const lat = Math.atan(-Math.cos(az) * Math.cos(el) / Math.sin(el));
  let H = Math.acos(Math.max(-1, Math.min(1, Math.sin(el) / Math.cos(lat))));
  const compass = ((azimuth % 360) + 360) % 360;
  if (compass > 0 && compass < 180) H = -H;
  return { latDeg: lat / DEG, declDeg: 0, h0: 12 + H / DEG / 15 };
}

export const SUN_PATH_DEFAULT = sunPathFrom({ elevation: 60, azimuth: 112.5 });

/** Hours wrap mod 24; pass a scratch `out` for per-frame calls.
 * @param {number} h @param {SunPath} path @param {SunPos} out */
export function sunFromHours(h, path = SUN_PATH_DEFAULT, out = { elevationDeg: 0, azimuthDeg: 0 }) {
  const hour = ((h % 24) + 24) % 24;
  const H = (hour - 12) * 15 * DEG, f = path.latDeg * DEG, d = path.declDeg * DEG;
  const sinEl = Math.sin(f) * Math.sin(d) + Math.cos(f) * Math.cos(d) * Math.cos(H);
  // At the horizon, floating-point cos(pi/2) must not turn the sun on.
  out.elevationDeg = Math.abs(sinEl) < 1e-15 ? 0 : Math.asin(Math.max(-1, Math.min(1, sinEl))) / DEG;
  const az = Math.atan2(Math.cos(d) * Math.sin(H), Math.cos(d) * Math.cos(H) * Math.sin(f) - Math.sin(d) * Math.cos(f)) / DEG + 180;
  out.azimuthDeg = ((az % 360) + 360) % 360;
  return out;
}
