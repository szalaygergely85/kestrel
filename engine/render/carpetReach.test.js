// OB-121: effective reach of the 3D grass carpet. Eye 1.6 m on a flat field, content-like variants, live footprint k, pitch 0 and -15:
// the farthest horizontal distance of a carpet hit must reach >= 0.9 x the configured radius (radiusScale 1 and 0.5), and no hit past the radius.
// Also logs which limit (NMAX steps, radius clip) binds: max lattice steps per ray vs NMAX.
import { footprintK } from './terrainShade.js';
import { makeFarGrass, farGrassFill } from './terrainShade.js';
import { makeCarpetCtx, makeCarpetHit, traceCarpet, applyCarpetQuality, NMAX, MINW_CELLS } from './carpet.js';

let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const COLS = 480, ROWS = 180, TANX = Math.tan(37.5 * Math.PI / 180), TANY = TANX * ROWS / COLS * 2;
const flat = (q) => { q[2] = 0; };
const FW = 120, fm = new Uint8Array(FW * FW).fill(1);
const mk = (radiusM) => {
  const c = makeCarpetCtx({ cfg: { seed: 7, radiusM, variants: [
    { name: 'meadow', ground: ['grass'], density: 0.75, heightM: [0.15, 0.4], ramp: ['a', 'b'] },
    { name: 'straw', ground: ['grass'], density: 0.75, heightM: [0.4, 0.9], bladeW: 0.05, ramp: ['a', 'b'] }] }, classMap: fm, x0: -120, y0: -120, w: FW, h: FW }, flat, null);
  c.fpK = -footprintK(TANX, COLS);
  return c;
};

/** returns {reach: farthest hit xy distance, p99: 99th percentile, maxSteps} for one frame */
function frame(ctx, pitchDeg) {
  const out = makeCarpetHit(), e = [0, 0, 1.6], d = [0, 0, 0], pitch = pitchDeg * Math.PI / 180;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), dists = [];
  let maxSteps = 0;
  for (let y = 0; y < ROWS; y++) {
    const b = (1 - (2 * (y + 0.5)) / ROWS) * TANY;
    for (let x = 0; x < COLS; x++) {
      const a = ((2 * (x + 0.5)) / COLS - 1) * TANX;
      const dx = cp - b * sp, dy = -a, dz = sp + b * cp, l = Math.hypot(dx, dy, dz);
      if (!(dz < 0)) continue;
      d[0] = dx / l; d[1] = dy / l; d[2] = dz / l;
      const t = -1.6 / d[2];
      const h = traceCarpet(e, d, t, ctx, 0, out);
      if (out.steps > maxSteps) maxSteps = out.steps;
      if (h) dists.push(out.t * Math.hypot(d[0], d[1]));
    }
  }
  dists.sort((p, q) => p - q);
  return { reach: dists.length ? dists[dists.length - 1] : 0, p99: dists.length ? dists[Math.floor(dists.length * 0.99)] : 0, n: dists.length, maxSteps };
}

for (const [scale, tag] of [[1, 'high'], [0.6, 'medium'], [1.4, 'ultra']]) {
  for (const pitch of [0, -15]) {
    const R = 20, c = mk(R); applyCarpetQuality(c, { radiusScale: scale, densScale: 1, minWCells: MINW_CELLS });
    const r = frame(c, pitch), rad = R * scale;
    console.log(`  (info) ${tag} radius ${rad.toFixed(1)} m pitch ${pitch}: reach max ${r.reach.toFixed(2)} m, p99 ${r.p99.toFixed(2)} m, hits ${r.n}, max steps ${r.maxSteps} (NMAX ${NMAX})`);
    check(r.reach >= 0.9 * rad && r.reach <= rad + 1e-6, `${tag} pitch ${pitch}: reach ${r.reach.toFixed(2)} m in [0.9 x ${rad.toFixed(1)}, ${rad.toFixed(1)}]`);
    check(r.maxSteps <= NMAX, `${tag} pitch ${pitch}: max steps ${r.maxSteps} <= NMAX ${NMAX} (step cap does not truncate before the radius)`);
    check(r.maxSteps <= 0.9 * NMAX, `${tag} pitch ${pitch}: max steps ${r.maxSteps} <= 0.9 x NMAX (headroom)`);
  }
}
// ultra window: class map must cover 20 x 1.4 x 1.5 + slack = 44.8 m half-size
{
  const { World } = await import('../world/World.js');
  const w = new World(); w.carpetQuality = { on: true, radiusScale: 1.4, densScale: 1.25 };
  w.carpet = { cfg: { radiusM: 20, classCellM: 2, classJitterM: 0.8 }, w: 120, h: 120, cellM: 0.8 };
  const cw = w.checkCarpetWindow(); check(cw.ok && Math.abs(cw.need - 44.8) < 1e-6, 'ultra window ok (need ' + cw.need + ' have ' + cw.have + ')');
}
{ // far-grass hand-off follows the radius (startM = radius), no code change
  const rec = makeFarGrass(); farGrassFill(rec, { radiusM: 20 }, [], { radiusScale: 1.4 }, null);
  check(Math.abs(rec.startM - 28) < 1e-6, 'far grass startM follows radius (' + rec.startM + ' m)');
}
console.log(fails ? `carpetReach.test: ${fails} FAILED` : 'carpetReach.test: all passed');
process.exit(fails ? 1 : 0);
