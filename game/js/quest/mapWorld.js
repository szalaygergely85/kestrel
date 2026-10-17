// game/js/quest/mapWorld.js (MAP-28): the approved world (design/levels/world_geo.js data) rastered onto the M chart
// grid once, at chart build: per-cell terrain kind + "area" (the unit a chart piece `chart.<id>` reveals) + the
// MAP-27 labels. Pure data, no DOM; mapCard.js composes it under the fog. G = world_geo, U = overworld_far.util
// (riverX, fbm). Cell index = y*innerW + x over the chart's inner grid (no border).
export const KINDS = ['', 'sea', 'beach', 'river', 'lake', 'marsh', 'mountain', 'forest', 'cliff', 'gate', 'wall'];
const K = Object.fromEntries(KINDS.map((k, i) => [k, i]));
// area id = chart piece id (flag `chart.<id>`). Priority = array order.
export const AREAS = ['river', 'sea', 'lake', 'marsh', 'gate', 'wall', 'whitecombs', 'westFells', 'cliffs', 'northwood', 'thornwood', 'hollins'];
// MAP-27 labels (docs/story.md "Places on the chart"); vertical = written down a column. All <= 16 chars.
export const LABELS = [
  { key: 'map.label.sea', text: 'The Quiet Sea', area: 'sea', x: 1500, y: 1960 },
  { key: 'map.label.river', text: 'The Braid', area: 'river', x: 1090, y: 800 },
  { key: 'map.label.estuary', text: 'Braidmouth', area: 'river', x: 1180, y: 1725 },
  { key: 'map.label.lake', text: 'Glasswater', area: 'lake', x: 1235, y: 505 },
  { key: 'map.label.marsh', text: 'The Reedmire', area: 'marsh', x: 1110, y: 1560 },
  { key: 'map.label.whitecombs', text: 'The Whitecombs', area: 'whitecombs', x: 1500, y: 180 },
  { key: 'map.label.fells', text: 'The West Fells', area: 'westFells', also: 'gate', x: 200, y: 640, vertical: true },
  { key: 'map.label.cliffs', text: 'The Shearcliffs', area: 'cliffs', x: 300, y: 1480 },
  { key: 'place.sealedGate', text: 'The Sealed Gate', area: 'gate', x: 240, y: 840 },
  { key: 'map.label.wall', text: "Ferrum's Wall", area: 'wall', x: 1990, y: 1000, vertical: true },
  { key: 'map.label.northwood', text: 'Northwood', area: 'northwood', x: 1660, y: 600 },
  { key: 'map.label.thornwood', text: 'The Thornwood', area: 'thornwood', x: 710, y: 930 },
  { key: 'map.label.hollins', text: 'The Hollins', area: 'hollins', x: 1280, y: 900 },
];

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}
function lineDist(pts, x, y) { let b = 1e9; for (let i = 1; i < pts.length; i++) b = Math.min(b, segDist(x, y, pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1])); return b; }
function ell(o, x, y) { const c = Math.cos(o.rot), s = Math.sin(o.rot), dx = x - o.x, dy = y - o.y; return Math.hypot((dx*c + dy*s) / o.rx, (-dx*s + dy*c) / o.ry); }
const inRect = (r, x, y) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3];

/** Classify one world point -> [kind, areaId] (areaId '' = no area). */
export function classify(G, U, x, y) {
  const c = G.coast, P = c.pts;
  let inside = false, best = 1e9, kind = 'cliff';
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if (((P[i][1] > y) !== (P[j][1] > y)) && (x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0])) inside = !inside;
    const d = segDist(x, y, P[j][0], P[j][1], P[i][0], P[i][1]);
    if (d < best) { best = d; kind = c.kinds[j] === 'open' ? 'cliff' : c.kinds[j]; }
  }
  const eL = ell(G.lake, x, y), dr = Math.abs(x - U.riverX(y));
  const eM = ell(G.marsh, x, y);
  if (eM < 1.15) return [eM < 1 ? K.marsh : 0, 'marsh'];
  if (eL < 1.3) return [eL < 1 ? K.lake : 0, 'lake'];
  if (y > 150 && y < 1790 && dr < 130) return [dr < 22 ? K.river : 0, 'river']; // corridor = the piece's area, water band = the glyph
  if (inside) return [K.sea, 'sea'];
  if (Math.abs(x - G.gate.x) < 240 && Math.abs(y - G.gate.y) < 60) return [Math.abs(x - G.gate.x) < 40 ? K.gate : 0, 'gate']; // the pass + wall run
  if (x >= 1900 && y >= G.wall.y0 && y <= G.wall.y1) return [K.wall, 'wall'];
  if (kind === 'beach' && best < c.beachWidth) return [K.beach, 'sea'];
  for (const R of G.ranges) if (lineDist(R.pts, x, y) < R.w * 0.55 && y > 60) return [K.mountain, R.id];
  if (kind === 'cliff' && best < 80 && x < 760) return [K.cliff, 'cliffs'];
  const rg = G.regions.find((r) => inRect(r.r, x, y));
  if (rg && rg.forest && x < 1880) {
    const thr = Math.min(0.8, rg.forest.thr + 0.1);
    if (U.fbm(x / 280 + 17, y / 280 - 9, G.seed + 13, 3, 0.5, 2) > thr - 0.06) {
      if (rg.id === 'northwood') return [K.forest, 'northwood'];
      if (rg.id === 'thornwood') return [K.forest, 'thornwood'];
      if (rg.forest.kind === 'broadleaf' && rg.id !== 'outwall') return [K.forest, 'hollins'];
    }
  }
  return [0, ''];
}

/** Build the overlay for an innerW x innerH chart over bounds. */
export function buildWorldOverlay(G, U, bounds, innerW, innerH) {
  const n = innerW * innerH, kind = new Uint8Array(n), area = new Uint8Array(n);
  const sx = (bounds.x1 - bounds.x0) / innerW, sy = (bounds.y1 - bounds.y0) / innerH;
  const wx = (cx) => bounds.x0 + (cx + 0.5) * sx, wy = (cy) => bounds.y0 + (cy + 0.5) * sy;
  for (let cy = 0; cy < innerH; cy++) for (let cx = 0; cx < innerW; cx++) {
    const [k, a] = classify(G, U, wx(cx), wy(cy)), i = cy * innerW + cx;
    area[i] = a ? AREAS.indexOf(a) + 1 : 0; kind[i] = k;
  }
  // label = the fitting spot (whole text inside its own area) nearest to its hint anchor; none fits -> cells all -1 (test fails)
  const labels = LABELS.map((L) => {
    const len = L.text.length, ai = AREAS.indexOf(L.area) + 1, ao = L.also ? AREAS.indexOf(L.also) + 1 : -1, // `also` = a sub-area the text may cross (the Gate sits in the Fells)
       hx = (L.x - bounds.x0) / sx, hy = (L.y - bounds.y0) / sy;
    const cells = new Int32Array(len).fill(-1);
    let bestD = 1e9;
    for (let cy = 0; cy < innerH; cy++) for (let cx = 0; cx < innerW; cx++) {
      let ok = true;
      for (let k = 0; k < len && ok; k++) {
        const x = L.vertical ? cx : cx + k, y = L.vertical ? cy + k : cy;
        ok = x < innerW && y < innerH && (area[y * innerW + x] === ai || area[y * innerW + x] === ao);
      }
      const d = Math.hypot(cx + (L.vertical ? 0 : len / 2) - hx, cy + (L.vertical ? len / 2 : 0) - hy);
      if (!ok || d >= bestD) continue;
      bestD = d;
      for (let k = 0; k < len; k++) cells[k] = L.vertical ? (cy + k) * innerW + cx : cy * innerW + cx + k;
    }
    return { key: L.key, text: L.text, area: L.area, areaIdx: ai, alsoIdx: ao, cells };
  });
  const areaCells = AREAS.map((_, a) => { let c = 0; for (let i = 0; i < n; i++) if (area[i] === a + 1) c++; const o = new Int32Array(c); c = 0; for (let i = 0; i < n; i++) if (area[i] === a + 1) o[c++] = i; return o; });
  return { innerW, innerH, kind, area, labels, areaCells };
}
