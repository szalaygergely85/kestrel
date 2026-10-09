// S8-B2-12a NEEDS B1 item (2): pure parse/clamp for `?clouds=<0..1>` (default 0 - cloud shadows are off unless asked
// for). No DOM, no engine import, so it's testable without the page. `parseCloudStrength(raw)`: raw is whatever
// `params.get('clouds')` returns (string or null) - missing, empty, non-numeric or out-of-range all fall back to 0
// rather than throwing (setCloudShadow itself throws on out-of-range, so main.js must clamp before calling it).

/** @param {string|null} raw @returns {number} finite, clamped to [0,1]; 0 for missing/bad input */
export function parseCloudStrength(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
