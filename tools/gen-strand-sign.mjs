// STRAND-SIGN-01 (D-070): warning sign on the Long Strand + a row of net stakes at the sea monster's warn distance.
// Meshes only (Prop_Support + plank, OB-035 sign post; stakes = Prop_Support stood in the water). Re-runnable: replaces only strand* ids.
// Usage: node tools/gen-strand-sign.mjs [--dry-run]. Shared layout lives in STRAND (exported for the Node test).
globalThis.window = globalThis.window || globalThis;
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SEA_EDGE_CONFIG, createShore, inSea } from '../game/js/quest/seaEdge.js';

export const STRAND = { x0: 1352, x1: 1416, count: 9, signInlandM: 5, seaLevel: -96, footDown: 0.8 };
const nearest = (shore, x, y) => { let b = Infinity; const S = shore.segs; for (let i = 0; i < S.length; i += 4) { const ax = S[i], ay = S[i + 1], dx = S[i + 2] - ax, dy = S[i + 3] - ay; const l2 = dx * dx + dy * dy; let t = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); b = Math.min(b, Math.hypot(x - ax - t * dx, y - ay - t * dy)); } return b; };
// y (south of the shore, in water) where the shore distance == dist, found by bisection down the column x
function yAtDist(shore, x, dist) { let lo = 1500, hi = 1900; for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; const d = inSea(shore, x, m) ? nearest(shore, x, m) : -nearest(shore, x, m); if (d < dist) lo = m; else hi = m; } return (lo + hi) / 2; }
export function strandLayout(coast) {
  const shore = createShore(coast), W = SEA_EDGE_CONFIG.warnM, stakes = [];
  for (let i = 0; i < STRAND.count; i++) { const x = STRAND.x0 + (STRAND.x1 - STRAND.x0) * i / (STRAND.count - 1); stakes.push({ x: +x.toFixed(2), y: +yAtDist(shore, x, W).toFixed(2) }); }
  const mx = (STRAND.x0 + STRAND.x1) / 2, sy = yAtDist(shore, mx, -STRAND.signInlandM);
  return { shore, stakes, sign: { x: +mx.toFixed(2), y: +sy.toFixed(2) } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await import('../design/palette.js'); await import('../design/detail-pass.js');
  await import('../design/levels/overworld_far.js'); await import('../design/levels/world_geo.js');
  const A = globalThis.ASSETS; A.levels.world_geo.util.installGeo(A.levels.overworld_far.util);
  for (const f of fs.readdirSync('design/models')) if (f.endsWith('.js')) { try { await import('../design/models/' + f); } catch { /* optional */ } }
  const { World, stringifyContent } = await import('../engine/index.js');
  const { loadTestAssets } = await import('./testing/content-node.mjs');
  const FILE = 'content/worlds/world_m1.world.json';
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const isMine = (o) => /^strand(Sign|Stake)/.test(o.id);
  data.structures = data.structures.filter((s) => !isMine(s)); data.entities = data.entities.filter((e) => !isMine(e));
  const { assets } = await loadTestAssets();
  const world = World.load(data, assets, { physics: 'mesh' });
  const L = strandLayout(A.levels.world_geo.coast || A.levels.world_geo.util.coast || A.levels.world_geo.geo.coast);
  const rot = (yaw, lx, ly) => { const r = yaw * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c * lx - s * ly, s * lx + c * ly]; };
  const st = [];
  world.ensureBandFor(L.sign.x, L.sign.y);
  const T = world.terrain, sx = L.sign.x, sy = L.sign.y, yaw = 270;   // post leans, plank turned to face the sea (south)
  const gz = Math.min(T.groundAt(sx, sy), T.groundAt(sx + .6, sy), T.groundAt(sx - .6, sy), T.groundAt(sx, sy + .6), T.groundAt(sx, sy - .6));
  st.push({ id: 'strandSignPost', collide: false, mesh: 'quaternius/Prop_Support', origin: { x: sx, y: sy, z: +(gz - 1.21 - 0.05).toFixed(2) }, yawDeg: yaw });
  const [tx, ty] = rot(yaw, 0, -1.75);
  st.push({ id: 'strandSignPlank', collide: false, mesh: 'quaternius/Prop_WoodenFence_Single', origin: { x: +(sx + tx).toFixed(2), y: +(sy + ty).toFixed(2), z: +(gz - 1.21 - 0.05 + 1.7 - 0.55).toFixed(2) }, scale: 0.55, yawDeg: yaw });
  L.stakes.forEach((p, i) => st.push({ id: 'strandStake' + String(i + 1).padStart(2, '0'), collide: false, mesh: 'quaternius/Prop_Support', origin: { x: p.x, y: p.y, z: +(STRAND.seaLevel - STRAND.footDown - 1.21).toFixed(2) }, yawDeg: (i * 47) % 360 }));
  const ent = { id: 'strandSign', type: 'prop', x: sx, y: sy, z: 'ground', components: { inspect: { text: 'note.strand.monster' } }, note: 'STRAND-SIGN-01 (D-070): Long Strand warning sign; stakes strandStake01.. stand at SEA_EDGE_CONFIG.warnM from the beach coast. Outside the walk bounds (beach y~1747, bounds end y~1110): reachable only once the bounds open.' };
  const at = data.structures.findIndex((s) => s.id === 'seaMonster'); void at;
  data.structures.push(...st); data.entities.push(ent);
  console.log('sign', L.sign, 'gz', gz.toFixed(2), 'stakes', L.stakes.map((p) => p.x + ',' + p.y).join(' '));
  if (!process.argv.includes('--dry-run')) { fs.writeFileSync(FILE, stringifyContent(data), 'utf8'); console.log('wrote', FILE); }
}
