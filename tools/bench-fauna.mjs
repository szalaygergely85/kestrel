// WILD-05 bench (docs/architecture.md 38.31 item 9): fauna feed cost at 40 alive / 20 drawn, with the real
// rabbit + deer models and ASSETS.wildlifeFx.   node --expose-gc tools/bench-fauna.mjs [frames]
// Reports feed ms p50/p95/max and the quads of the drawn set (tris/2 from the engine mesher).
// Budgets: feed p95 <= 0.05 ms, wildlife quads drawn <= 30k. (The brain step is benched by WILD-04's test.)
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/voxel_wildlife.js';
import { compileFaunaDef, createFaunaFeed, VoxelPool, packVoxelModel, buildVoxelMesh, createClipPlayer, clipPlay } from '../engine/index.js';

const FRAMES = +process.argv[2] || 20000;
const A = globalThis.ASSETS;
const ids = [];
const matId = (m) => { let i = ids.indexOf(m); if (i < 0) { ids.push(m); i = ids.length - 1; } return i + 1; };
const pms = {}, quads = {};
for (const k of ['rabbit', 'deer', 'deerBuck']) {
  const def = A.models[k].voxel;
  pms[k] = packVoxelModel(def, matId);
  quads[k] = buildVoxelMesh(pms[k], { id: k, partNames: Object.keys(def.parts) }).triCount / 2;
}
const fauna = compileFaunaDef(A.wildlifeFx, (n) => pms[n]);
const pool = new VoxelPool(); pool.renderer = 'mesh';
for (const k of Object.keys(pms)) pool.models.set(k, pms[k]);
const slots = [];
for (let i = 0; i < 40; i++) {
  const s = { alive: true, species: i % 2, model: 0, x: ((i * 7) % 13) - 6, y: -3 - i * 1.5, z: 0, yaw: i * 9, cp: createClipPlayer() };
  const pm = pms[fauna.species[s.species].models[0]];
  clipPlay(s.cp, pm, 0, true, 0); clipPlay(s.cp, pm, 1, true, 1e9); // permanent fade: exercises blendInstance
  slots.push(s);
}
const f = createFaunaFeed(fauna, slots);
const cam = { x: 0, y: 0, z: 1.7, yawDeg: 0, pitchDeg: 0 };
for (let i = 0; i < 3000; i++) { pool.beginFrame(); f.feed(pool, cam); }
globalThis.gc && globalThis.gc();
const t = new Float64Array(FRAMES);
for (let i = 0; i < FRAMES; i++) {
  pool.beginFrame();
  const t0 = performance.now(); f.feed(pool, cam); t[i] = performance.now() - t0;
}
t.sort();
const q = (p) => t[Math.min(FRAMES - 1, Math.floor(p * FRAMES))];
let drawnQuads = 0;
for (let i = 0; i < pool._rawCount; i++) drawnQuads += quads[pool.raw[i].modelKey] || 0;
console.log(`quads per model: ${Object.entries(quads).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`feed: alive 40, drawn ${f.stats.drawn}, candidates ${f.stats.candidates}, drawn quads ${drawnQuads} (budget <= 30000)`);
console.log(`feed ms: p50 ${q(0.5).toFixed(4)}  p95 ${q(0.95).toFixed(4)}  max ${t[FRAMES - 1].toFixed(4)}  (budget p95 <= 0.05)`);
const ok = q(0.95) <= 0.05 && drawnQuads <= 30000;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
