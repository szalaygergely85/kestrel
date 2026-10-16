import { loadM1 } from '../game/js/quest/under/loadM1.mjs';
const { world, groundAt } = await loadM1('mesh');
const U = globalThis.ASSETS.levels.world_geo.util;
const pts = [...world.structures.map((s) => [s.origin.x, s.origin.y, s.id]), ...(world.entities ? [...world.entities.values?.() ?? []].map((e) => e.transform ? [e.transform.x, e.transform.y, e.id] : null).filter(Boolean) : [])];
const near = (x, y) => pts.reduce((m, p) => Math.min(m, Math.hypot(p[0] - x, p[1] - y)), 1e9);
const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const out = [];
for (let x = 1480; x < 1860; x += 8) for (let y = 360; y < 860; y += 8) {
  const reg = U.regionAt(x, y); if (reg.id !== 'northwood') continue;
  for (const [dx, dy] of dirs) {
    const px = -dy, py = dx; // across
    const gm = groundAt(x, y); if (gm < 5) continue;
    const floor = gm - 3.6;
    let minG = 1e9, maxSlopeAcross = 0;
    for (let a = 8; a <= 18; a += 2) for (let b = -5; b <= 5; b += 2) minG = Math.min(minG, groundAt(x + dx * a + px * b, y + dy * a + py * b));
    for (let a = 0; a <= 18; a += 6) maxSlopeAcross = Math.max(maxSlopeAcross, Math.abs(groundAt(x + dx * a + px * 8, y + dy * a + py * 8) - groundAt(x + dx * a - px * 8, y + dy * a - py * 8)));
    const rise = groundAt(x + dx * 24, y + dy * 24) - gm;
    if (minG - floor < 5.2 || rise < 7 || rise > 13 || maxSlopeAcross > 3) continue;
    out.push({ x, y, dx, dy, gm: +gm.toFixed(1), rise: +rise.toFixed(1), clear: +(minG - floor).toFixed(1), across: +maxSlopeAcross.toFixed(1), poi: Math.round(near(x, y)), reg: reg.id });
  }
}
out.filter((o) => o.poi > 60).sort((a, b) => b.poi - a.poi).slice(0, 12).forEach((o) => console.log(JSON.stringify(o)));
console.log(out.length);
