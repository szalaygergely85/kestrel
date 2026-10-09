// S8-B2-12a/S8-B2-20 NEEDS B1 shared helper: pure parse/clamp for the `?ao=<0..1>` (+ the `?cloudshadow=1` flag) query params
// (default 0 - cloud shadows and horizon AO are both off unless asked for). No DOM, no engine import, so it's
// testable without the page. `parseUnitStrength(raw)`: raw is whatever `params.get(name)` returns (string or
// null) - missing, empty, non-numeric or out-of-range all fall back to 0 rather than throwing (setCloudShadow/
// lights.ao themselves throw on out-of-range, so main.js must clamp before calling them).

/** @param {string|null} raw @returns {number} finite, clamped to [0,1]; 0 for missing/bad input */
export function parseUnitStrength(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** `?cloudshadow=1` (S8-B2-12c, WebGPU/dev only): true only for exactly "1". */
export function parseCloudShadowFlag(raw) { return raw === '1'; }

/** Default dev cloud-shadow block for `lights.cloud` (same shape setLook builds from look.clouds.shadow + clouds.seed/wind). Fresh object. */
export function devCloudShadow() {
  return { strength: 0.45, scale: 48, cover: 0.5, soft: 0.25, deckH: 300, seed: 3, wind: new Float32Array([0.006, 0.0015]) };
}

/** @param {string|null} raw @returns {number} `?ao=<0..1>` parse/clamp (S8-B2-20 NEEDS B1 item 1) */
export function parseAoStrength(raw) { return parseUnitStrength(raw); }
