// RTX-RAYS-BAND-01 (docs/architecture.md 38.79): per-band resolve rays. JS twin (D-017) of the far path in
// gpu/wgsl/resolve.wgsl.js. At n == 4 and bandM > 0, cells whose nearest rotated-grid sample is farther than a dithered
// threshold vote over 4 sub-samples (RG4) instead of 16. n < 4 and bandM <= 0 never touch this rule.
// Pure, allocation-free per call (caller owns `out`). The WGSL helper text is generated from RG4 / the Bayer formula here.

/** Rotated-grid 4-sample pattern: sub coords (i, j) inside the 4x4 block; covers every row and column once. */
export const RG4 = Object.freeze([Object.freeze({ i: 1, j: 0 }), Object.freeze({ i: 3, j: 1 }), Object.freeze({ i: 0, j: 2 }), Object.freeze({ i: 2, j: 3 })]);
/** Seam dither amplitude: threshold = bandM * (1 +- DITHER/2). */
export const BAND_DITHER = 0.15;
const f = Math.fround;

/** Ordered 4x4 Bayer value 0..15 (bit-interleave form; matches the classic matrix). */
export function bayer4(x, y) {
  const xy = (x ^ y) & 3;
  return ((xy & 1) << 3) | ((y & 1) << 2) | (((xy >> 1) & 1) << 1) | ((y >> 1) & 1);
}

/** Per-cell far threshold in metres (f32 arithmetic, op order = WGSL). bandM <= 0 -> 0. */
export function bandThreshold(bandM, cx, cy) {
  const b = bayer4(cx & 3, cy & 3);
  return f(f(bandM) * f(1 + f(f(BAND_DITHER) * f(f(b / 15) - 0.5))));
}

/** AA-04b: kind the hysteresis never touches (model sprites; stable skips them too). */
const KIND_MODEL_HYST = 8;

/**
 * Resolve one cell's vote. sub = {pid:Int32Array, kind:Uint32Array, mat:Uint32Array, depth:Float32Array} in scan order
 * (index j*n+i, length n*n). out = {idx, cov, far} is filled: idx = scan-order index of the winning sub-sample.
 * histKey = null | {kind, pid, mat}: last frame's key at this cell's reprojected world position (AA-04b); out.bestMinDepth = the
 * un-hysteresised best group's min depth (the depth to reproject with). Near path = the unchanged vote (normative 14.2 item 3); far path = same rule over RG4 only.
 */
export function resolveCellJS(sub, n, bandM, cx, cy, out, histKey = null) {
  out.far = false;
  if (n === 4 && bandM > 0) {
    let dMin = 1e30;
    for (let r = 0; r < 4; r++) {
      const s = RG4[r].j * 4 + RG4[r].i;
      if (sub.kind[s] !== 0 && sub.depth[s] < dMin) dMin = sub.depth[s];
    }
    if (dMin > bandThreshold(bandM, cx, cy)) { out.far = true; return farVote(sub, out); }
  }
  const n2 = n * n;
  let bestCount = -1, bestMin = 1e30, winner = 0;
  for (let a = 0; a < n2; a++) {
    let count = 0, minD = 1e30;
    for (let b = 0; b < n2; b++) {
      if (sub.kind[b] === sub.kind[a] && sub.pid[b] === sub.pid[a] && sub.mat[b] === sub.mat[a]) { count++; if (sub.depth[b] < minD) minD = sub.depth[b]; }
    }
    if (count > bestCount || (count === bestCount && minD < bestMin)) { bestCount = count; bestMin = minD; winner = a; }
  }
  out.bestMinDepth = bestMin;
  // AA-04b (38.82 B) + OB-208: keep last frame's key at this world position (sky included) while its group still has >= n*n/4 samples
  // (or is within HYST of the best). Sky keys match on kind only. Models excluded. A sky winner reprojects with the nearest geometry depth
  // in the cell (sky depth is infinite); no geometry -> 1e4.
  if (sub.kind[winner] === KIND_MODEL_HYST) { /* plain vote */ } else if (histKey && histKey.kind !== KIND_MODEL_HYST) {
    if (sub.kind[winner] === 0) {
      let g = 1e30; for (let b = 0; b < n2; b++) if (sub.kind[b] !== 0 && sub.depth[b] < g) g = sub.depth[b];
      out.bestMinDepth = g < 1e29 ? g : 1e4;
    }
    const hyst = Math.max(1, n2 >> 3), keepMin = Math.max(1, n2 >> 2), sky = histKey.kind === 0;
    let hc = 0, hFirst = -1;
    for (let b = 0; b < n2; b++) {
      if (sub.kind[b] === histKey.kind && (sky || (sub.pid[b] === histKey.pid && sub.mat[b] === histKey.mat))) { hc++; if (hFirst < 0) hFirst = b; }
    }
    if (hFirst >= 0 && (hc >= keepMin || hc >= bestCount - hyst)) { winner = hFirst; bestCount = hc; }
  }
  let nearest = -1, nearestMag = 1e30;
  for (let a = 0; a < n2; a++) {
    if (sub.kind[a] !== sub.kind[winner] || sub.pid[a] !== sub.pid[winner] || sub.mat[a] !== sub.mat[winner]) continue;
    const ox = f(f(f(a % n) + 0.5) / n) - 0.5, oy = f(f(f(Math.floor(a / n)) + 0.5) / n) - 0.5;
    const mag = f(f(ox * ox) + f(oy * oy));
    if (mag < nearestMag) { nearestMag = mag; nearest = a; }
  }
  out.idx = nearest;
  out.cov = Math.min(7, Math.max(0, Math.trunc(f(f(f(bestCount) * 8) / n2) - 1)));
  return out;
}

function farVote(sub, out) {
  let bestCount = -1, bestMin = 1e30, winner = 0;
  for (let a = 0; a < 4; a++) {
    const sa = RG4[a].j * 4 + RG4[a].i;
    let count = 0, minD = 1e30;
    for (let b = 0; b < 4; b++) {
      const sb = RG4[b].j * 4 + RG4[b].i;
      if (sub.kind[sb] === sub.kind[sa] && sub.pid[sb] === sub.pid[sa] && sub.mat[sb] === sub.mat[sa]) { count++; if (sub.depth[sb] < minD) minD = sub.depth[sb]; }
    }
    if (count > bestCount || (count === bestCount && minD < bestMin)) { bestCount = count; bestMin = minD; winner = a; }
  }
  const ws = RG4[winner].j * 4 + RG4[winner].i;
  let nearest = -1, nearestMag = 1e30;
  for (let a = 0; a < 4; a++) {
    const sa = RG4[a].j * 4 + RG4[a].i;
    if (sub.kind[sa] !== sub.kind[ws] || sub.pid[sa] !== sub.pid[ws] || sub.mat[sa] !== sub.mat[ws]) continue;
    const ox = f(f(f(RG4[a].i) + 0.5) / 4) - 0.5, oy = f(f(f(RG4[a].j) + 0.5) / 4) - 0.5;
    const mag = f(f(ox * ox) + f(oy * oy));
    if (mag < nearestMag) { nearestMag = mag; nearest = a; }
  }
  out.idx = RG4[nearest].j * 4 + RG4[nearest].i;
  out.cov = Math.min(7, Math.max(0, Math.trunc(f(f(f(bestCount) * 8) / 4) - 1)));
  return out;
}

const sel = (vals) => { // select() chain returning vals[r] for r = 0..3 (WGSL has no const array indexing in the JS probe)
  let e = String(vals[3]);
  for (let r = 2; r >= 0; r--) e = `select(${e}, ${vals[r]}, r == ${r})`;
  return e;
};

/** WGSL helper functions generated from the tables above (one source of truth). */
export const RESOLVE_BAND_WGSL = `
fn rg4i(r: i32) -> i32 { return ${sel(RG4.map(p => p.i))}; }
fn rg4j(r: i32) -> i32 { return ${sel(RG4.map(p => p.j))}; }
fn bayer4(x: i32, y: i32) -> i32 {
  let xy = (x ^ y) & 3;
  return ((xy & 1) << 3) | ((y & 1) << 2) | (((xy >> 1) & 1) << 1) | ((y >> 1) & 1);
}
fn bandThreshold(bandM: f32, cell: vec2i) -> f32 {
  let b = bayer4(cell.x & 3, cell.y & 3);
  return f32(f32(bandM) * f32(1.0 + f32(f32(${BAND_DITHER}) * f32(f32(f32(b) / 15.0) - 0.5))));
}
`;
