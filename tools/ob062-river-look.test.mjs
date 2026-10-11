// OB-062: river look rules (data + JS twin helpers): depth tint monotonic, soft shoreline alpha, streaks present, streak glyph distinct.
// Run: node tools/ob062-river-look.test.mjs
import '../design/water-looks.js';
import { packWaterLook, packRiverLook, riverAlpha, riverStreakHit, WL_STRIDE } from '../engine/render/waterLook.js';
let fail = 0;
const ok = (n, c) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + n); };
const L = globalThis.ASSETS.waterLooks.river;
const row = packWaterLook('river', L), rr = packRiverLook('river', L);
const tintAt = (c, col) => { const t = Math.min(col / row[38], 1); return row[c] + (row[c + 4] - row[c]) * t; };
{ // depth tint: deeper = darker in every channel, monotonic over 0..1.5 m; deep is greener/bluer than red
  let mono = true; for (let c = 0; c < 3; c++) for (let d = 0; d < 1.5; d += 0.05) if (tintAt(c, d + 0.05) > tintAt(c, d) + 1e-6) mono = false;
  ok('depth tint monotonic darker', mono);
  ok('deep is green-blue (b > g > r) and darker than shallow', row[6] > row[5] && row[5] > row[4] && row[4] + row[5] + row[6] < 0.5 * (row[0] + row[1] + row[2]));
}
{ // soft shoreline: alpha rises smoothly from 0 at the bank, no step bigger than 0.1 per 5 cm, reaches full by 0.5 m
  let prev = riverAlpha(1, 5, 0, 0, rr[0]), maxStep = 0, mono = true;
  for (let c = 0.05; c <= 0.6; c += 0.05) { const a = riverAlpha(1, 5, c, 0, rr[0]); maxStep = Math.max(maxStep, a - prev); if (a < prev) mono = false; prev = a; }
  ok('shoreline alpha monotonic, 0 at the bank, 1 by 0.5 m, soft steps (<= 0.12 per 5 cm)', mono && riverAlpha(1, 5, 0, 0, rr[0]) === 0 && prev === 1 && maxStep <= 0.12 && rr[0] >= 0.4);
}
{ // streaks: distinct glyph from the ramp, and present (about 1 - streakK of the river cells) on a flow-field sample
  const ramp = L.ramp.split('').map((ch) => ch.charCodeAt(0) - 32), sg = row[24];
  ok('streak glyph differs from every ramp glyph', !ramp.includes(sg));
  const t = new Float32Array(WL_STRIDE); t.set(row); t[26] = 0.3; t[28] = 0; t[29] = rr[1];
  let hits = 0, n = 0; for (let ti = 0; ti < 60; ti += 0.25) for (let e = 0; e < 18; e += 0.2) { n++; if (riverStreakHit(t, 0, ti, e)) hits++; }
  const f = hits / n; ok(`streak density ${f.toFixed(3)} within 0.12..0.30`, f > 0.12 && f < 0.3);
}
process.exit(fail ? 1 : 0);
