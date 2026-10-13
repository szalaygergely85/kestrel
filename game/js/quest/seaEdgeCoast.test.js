// WM-09: the sea edge works along the WHOLE sea coast (beach + cliff), strikes before the WM-05 walk polygon edge. Node only.
import assert from 'node:assert/strict';
import '../../../design/levels/world_geo.js';
import { SEA_EDGE_CONFIG as C, createShore, createSeaEdgeOut, seaEdgeState, inSea } from './seaEdge.js';
import { outsidePolygon } from './bandPose.js';

const G = globalThis.ASSETS.levels.world_geo, shore = createShore(G.coast), old = createShore(G.coast, ['beach']);
const out = createSeaEdgeOut(), w = { bounds: G.bounds };
assert.ok(C.killM + 15 <= 110, 'killM + margin <= polygon offset 110 m');
const st = (x, y) => { out.state = 0; return seaEdgeState({ x, y }, shore, out); };

// 1) 200 points along the whole non-open coast, pushed out to sea along the local seaward normal until dist >= killM + 1:
//    each must strike, and must still be inside the walk polygon (= strike comes before the edge).
const P = G.coast.pts, K = G.coast.kinds, segs = [];
for (let k = 0; k < P.length; k++) if (K[k] !== 'open') segs.push(k);
let tested = 0, kinds = new Set();
for (let i = 0; i < 200; i++) {
  const k = segs[i % segs.length], a = P[k], b = P[(k + 1) % P.length], t = ((i / segs.length | 0) + 0.5) / (200 / segs.length + 1);
  const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (x < 25 || x > 1875) { i--; segs.push(segs.shift()); continue; } // map-edge corners (x<20 / Wall x>1880) are not reachable
  let nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L;               // a normal; pick the side that is sea
  if (!inSea(shore, x + nx * 3, y + ny * 3)) { nx = -nx; ny = -ny; }
  assert.ok(inSea(shore, x + nx * 3, y + ny * 3), `seg ${k} has a sea side`);
  let d = 0, hit = null;
  for (; d < 130; d += 1) { const px = x + nx * d, py = y + ny * d; if (st(px, py).strike) { hit = [px, py]; break; } }
  assert.ok(hit && d <= C.killM + 25, `seg ${k} t=${t.toFixed(2)} strike at ${d} m`);
  assert.ok(!outsidePolygon(w, hit[0], hit[1]) || hit[0] < 20 || hit[0] > 1880 /* x<20, x>1880 = Fells foot / Wall edges: other limits */, `seg ${k}: strike point (${hit[0] | 0},${hit[1] | 0}) is inside the walk polygon`);
  kinds.add(K[k]); tested++;
}
assert.equal(tested, 200); assert.ok(kinds.has('cliff') && kinds.has('beach'));

// 2) the polygon edge itself: every edge sample that lies in the sea is >= killM from the shore (monster already struck)
const B = G.bounds.pts; let seaEdgePts = 0;
for (let k = 0; k < B.length; k++) {
  const a = B[k], b = B[(k + 1) % B.length];
  if (a[0] === b[0]) continue; // the Wall (x 1880) / Fells foot (x 20) edges are land-side limits, not the sea side
  for (let s = 0; s <= 20; s++) { const x = a[0] + (b[0] - a[0]) * s / 20, y = a[1] + (b[1] - a[1]) * s / 20;
    if (!inSea(shore, x, y)) continue; seaEdgePts++;
    assert.ok(st(x, y).dist >= C.killM + 15, `polygon edge (${x | 0},${y | 0}) dist ${out.dist.toFixed(1)} < killM+15`); }
}
assert.ok(seaEdgePts > 50, 'the polygon has a long sea side: ' + seaEdgePts);

// 3) lakes / rivers / land never trigger (only the sea polygon is "wet")
for (const L of [G.lake, G.lakes, G.river, G.rivers, G.marsh].flat().filter(Boolean)) if (typeof L.x === 'number' && typeof L.y === 'number') assert.equal(st(L.x, L.y).state, 0, 'water body ' + (L.id || L.name));
for (let y = 100; y < 1400; y += 90) for (let x = 40; x < 1880; x += 90) assert.equal(st(x, y).state, 0, `inland ${x},${y}`);

// 4) Strand unchanged: beach-only shore gives the identical result on the old fixture line
const o2 = createSeaEdgeOut();
for (let dy = -30; dy <= 110; dy += 5) { const a = seaEdgeState({ x: 1525, y: 1770 + dy }, shore, createSeaEdgeOut()), b = seaEdgeState({ x: 1525, y: 1770 + dy }, old, o2); assert.deepEqual(a, b, 'strand dy ' + dy); }
console.log('seaEdgeCoast ok (' + seaEdgePts + ' polygon sea samples)');
