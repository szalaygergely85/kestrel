// S8-B2-12a/S8-B2-20 NEEDS B1 shared helper: pure parse/clamp for the `?clouds=<0..1>` / `?ao=<0..1>` query params
// (default 0 - cloud shadows and horizon AO are both off unless asked for). No DOM, no engine import, so it's
// testable without the page. `parseUnitStrength(raw)`: raw is whatever `params.get(name)` returns (string or
// null) - missing, empty, non-numeric or out-of-range all fall back to 0 rather than throwing (setCloudShadow/
// setHorizonAo themselves throw on out-of-range, so main.js must clamp before calling them).

/** @param {string|null} raw @returns {number} finite, clamped to [0,1]; 0 for missing/bad input */
export function parseUnitStrength(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** @param {string|null} raw @returns {number} `?clouds=<0..1>` parse/clamp (S8-B2-12a NEEDS B1 item 2) */
export function parseCloudStrength(raw) { return parseUnitStrength(raw); }

/** @param {string|null} raw @returns {number} `?ao=<0..1>` parse/clamp (S8-B2-20 NEEDS B1 item 1) */
export function parseAoStrength(raw) { return parseUnitStrength(raw); }
