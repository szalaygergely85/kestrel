// ENV-02c: real-recipe look bake: bake ms + MB before/after table, null -> bytes unchanged, blendM >= 3 far texels.
// Run: node engine/world/lookBakeReal.test.js (hand-written lookMap in the spec's 38.63 shape: engine tests may not import game/)
import assert from 'node:assert/strict';
import { Terrain } from './Terrain.js';
import terrainDef from '../../design/levels/overworld_far.js';
import '../../design/levels/world_geo.js';
globalThis.window = globalThis.window || globalThis;
terrainDef;
const recipe = globalThis.ASSETS.levels.overworld_far, G = globalThis.ASSETS.levels.world_geo;
for (const st of recipe.structures || []) { st.bbox = st.bbox || { x0: -9000, y0: -9000, x1: -8990, y1: -8990 }; st.ringHAt = st.ringHAt || (() => 0); } // standalone Terrain: stub placement (CO-9)
G.util.installBiomes(recipe.util);
const T = {}; for (const [k, v] of Object.entries(recipe.terrain)) T[k] = v.id;
const ids = (...n) => n.map(k => T[k]).filter(v => v !== undefined);
const cfg = { lookMap: [{ look: 6, ground: ids('sand', 'reeds'), biomes: null }, { look: 3, ground: null, biomes: [5] }, { look: 4, ground: null, biomes: [6] }, { look: 2, ground: ids('forest'), biomes: null }, { look: 5, ground: ids('grass', 'rock'), biomes: [9] }, { look: 1, ground: ids('grass', 'grassTall'), biomes: [0] }] };
const small = Object.entries(G.biomes).filter(([, b]) => (b.blendM || 24) < 3 * recipe.map.cell).map(([id, b]) => id + ':' + (b.blendM || 24));
const minBlend = Math.min(...Object.values(G.biomes).map(b => b.blendM || 24));
if (small.length) console.log('FINDING: biomes with blendM < 3 x far texel (' + recipe.map.cell + ' m): ' + small.join(' ') + ' -> ENV-02c assert would throw if the game passes blendM; ASK ARCHITECT');
let n = 0; const ok = (name, c, x) => { assert.ok(c, name + (x ? ' ' + x : '')); n++; };

const ms = (f) => { const t = performance.now(); f(); return performance.now() - t; };
function run(label, look) {
  const t = new Terrain(recipe); if (look) t.setGroundLook(cfg);
  const far = ms(() => t.bakeFarSync());
  const cx0 = 8, cy0 = 7; // the world_m1 band area
  let b; const near = ms(() => { const st = t.newBandState(cx0, cy0, 3, 3, null); t.stepBandState(st, Infinity); b = t.finishBandState(st); });
  const bytes = b.height.byteLength + b.type.byteLength + b.hDraw.byteLength + (b.look ? b.look.byteLength : 0);
  const farBytes = t.farH.byteLength + t.farType.byteLength + t.farHDraw.byteLength + (t.farLook ? t.farLook.byteLength : 0);
  return { label, far, near, nearMB: bytes / 1048576, farMB: farBytes / 1048576, chk: t.checksum(), t, b };
}
run('warm', false); run('warm', true);
const off = run('looks off', false), on = run('looks on', true), off2 = run('looks null', false);
ok('null: checksum identical', off.chk === off2.chk);
ok('null: no look bytes', !off.b.look && !off.t.farLook);
ok('type/height unchanged with looks on', Buffer.compare(Buffer.from(on.b.type), Buffer.from(off.b.type)) === 0 && Buffer.compare(Buffer.from(on.b.height.buffer), Buffer.from(off.b.height.buffer)) === 0);
const hist = new Array(16).fill(0); for (let i = 0; i < on.b.look.length; i += 2) { hist[on.b.look[i] & 15]++; hist[on.b.look[i] >> 4]++; }
ok('real band: some non-zero looks', hist.slice(1).some(v => v > 0));
console.log('| config     | far ms | near 192x192 ms | near MB | far MB |');
for (const r of [off, on]) console.log(`| ${r.label.padEnd(10)} | ${r.far.toFixed(1).padStart(6)} | ${r.near.toFixed(1).padStart(15)} | ${r.nearMB.toFixed(3).padStart(7)} | ${r.farMB.toFixed(3).padStart(6)} |`);
console.log(`delta: near bake +${((on.near / off.near - 1) * 100).toFixed(1)} %, near bytes +${((on.nearMB / off.nearMB - 1) * 100).toFixed(1)} %, far bake +${((on.far / off.far - 1) * 100).toFixed(1)} %, look histogram (ids 0..6) ${hist.slice(0, 7).join(',')}`);
console.log(`groundLookBake.test.js: ${n} checks passed`);
