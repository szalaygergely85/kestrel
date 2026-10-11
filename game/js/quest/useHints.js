// INT-HL-01: faint "you can use this" markers over usable interactables near the player (UI layer, no render-pipeline change).
// Pure + allocation-free: selection (reach, on screen, LOS, skip the crosshair target, cap, nearest first) and the pulse curve.
// main.js owns the projection (worldToCell on the scene grid) and the drawing (ui.setGlyph with a precomputed colour).
export const HINT_REACH = 3;      // m from the eye
export const HINT_CAP = 6;
export const PULSE_PERIOD = 1.6;  // s
export const ALPHA_MIN = 0.25, ALPHA_MAX = 0.45;
export const HINT_GLYPH = '·'; // middle dot (the font already has it: used by HUD separators)
export const ALPHA_STEPS = 6;

/** Pulse alpha at time t (s): smooth 0.25..0.45 over PULSE_PERIOD. */
export function pulseAlpha(t) {
  const s = 0.5 + 0.5 * Math.sin((t / PULSE_PERIOD) * 2 * Math.PI);
  return ALPHA_MIN + (ALPHA_MAX - ALPHA_MIN) * s;
}
/** Quantised pulse step 0..ALPHA_STEPS-1 (index into the precomputed colour table). */
export function pulseStep(t) {
  const k = Math.round(((pulseAlpha(t) - ALPHA_MIN) / (ALPHA_MAX - ALPHA_MIN)) * (ALPHA_STEPS - 1));
  return k < 0 ? 0 : k > ALPHA_STEPS - 1 ? ALPHA_STEPS - 1 : k;
}
/** Once at boot: colour table for the pulse steps = base hex scaled toward black by alpha (glyph-only cells have no real blend). */
export function buildHintColors(baseHex) {
  const n = parseInt(baseHex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255, out = [];
  for (let i = 0; i < ALPHA_STEPS; i++) {
    const a = ALPHA_MIN + (ALPHA_MAX - ALPHA_MIN) * (i / (ALPHA_STEPS - 1));
    const h = (v) => ('0' + Math.round(v * a).toString(16)).slice(-2);
    out.push('#' + h(r) + h(g) + h(b));
  }
  return out;
}

/** Reused result: n markers, col/row (scene cells, floats), dist, key (nearest first). */
export function createHintSet() {
  return { n: 0, col: new Float64Array(HINT_CAP), row: new Float64Array(HINT_CAP), dist: new Float64Array(HINT_CAP), key: new Array(HINT_CAP).fill(null) };
}
const scr = new Float64Array(3); // projection scratch

/**
 * @param {object} world - needs .interactables [{key,x,y,z,usedKey,requires}] and .state
 * @param {{x,y,z}} eye
 * @param {string|null} targetKey - current crosshair target (not marked)
 * @param {(x,y,z,out3)=>Float64Array} project - fills out3 = [col,row,viewDepth]; viewDepth <= 0 = behind
 * @param {{cols:number,rows:number}} grid - scene grid the projection uses
 * @param {((ax,ay,az,bx,by,bz)=>boolean)|null} los - line-of-sight test (null = no occlusion test)
 * @param {ReturnType<typeof createHintSet>} out
 * @returns {number} out.n
 */
export function selectHints(world, eye, targetKey, project, grid, los, out) {
  const list = world.interactables, st = world.state, r2 = HINT_REACH * HINT_REACH;
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const rec = list[i];
    if (rec.key === targetKey) continue;
    if (rec.usedKey && st[rec.usedKey]) continue;
    if (rec.requires && !st[rec.requires]) continue;
    const dx = rec.x - eye.x, dy = rec.y - eye.y, dz = rec.z - eye.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    if (n === HINT_CAP && d2 >= out.dist[HINT_CAP - 1] * out.dist[HINT_CAP - 1]) continue; // cheap reject before project/LOS
    project(rec.x, rec.y, rec.z, scr);
    const c = scr[0], r = scr[1];
    if (!(scr[2] > 0) || c < 0 || c >= grid.cols || r < 0 || r >= grid.rows) continue;
    if (los && !los(eye.x, eye.y, eye.z, rec.x, rec.y, rec.z)) continue;
    const d = Math.sqrt(d2);
    // insertion into the sorted (nearest first) fixed-size arrays
    let p = n < HINT_CAP ? n : HINT_CAP - 1;
    while (p > 0 && out.dist[p - 1] > d) { out.dist[p] = out.dist[p - 1]; out.col[p] = out.col[p - 1]; out.row[p] = out.row[p - 1]; out.key[p] = out.key[p - 1]; p--; }
    out.dist[p] = d; out.col[p] = c; out.row[p] = r; out.key[p] = rec.key;
    if (n < HINT_CAP) n++;
  }
  out.n = n;
  return n;
}
