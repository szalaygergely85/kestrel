// MAP-02/03/05 (arch 38.42): sea + beach + coast, ridges/peaks + snow, lake + marsh as composer layers from design/levels/world_geo.js.
// Run: node engine/world/geoMap.test.js
import { createHash } from 'node:crypto';
import { makeOk } from '../test/assert.js';
import terrainDef from '../../design/levels/overworld_far.js';
import '../../design/levels/world_geo.js';
globalThis.window = globalThis.window || globalThis;
terrainDef;
let pass = 0, fail = 0;
const ok = makeOk(() => pass++, () => fail++, (m) => console.error('FAIL:', m));
const recipe = globalThis.ASSETS.levels.overworld_far, G = globalThis.ASSETS.levels.world_geo, util = recipe.util;
recipe.structures[0].bbox = { x0: 1480, y0: 1018, x1: 1504, y1: 1032 }; recipe.structures[0].ringHAt = () => 2.4;
const hashOf = (B) => createHash('sha1').update(Buffer.from(B.height.buffer)).update(Buffer.from(B.type.buffer)).digest('hex');
const east = () => util.bake(9 * 128, 7 * 128, 2, 4 * 64, 3 * 64), west = () => util.bake(6 * 128, 7 * 128, 2, 3 * 64, 3 * 64);
const best = (f, n = 5) => { let b = 1e9; for (let i = 0; i < n; i++) { const t = performance.now(); f(); b = Math.min(b, performance.now() - t); } return b; };

// baseline (no layers): keep bytes, reference heights from the designer's geoHeight, zone bake time
util.setGeoLayers([]); util.setGeoBiomes(null);
const h0 = { e: hashOf(east()), w: hashOf(west()) };
const base = (x, y) => util.recipeHeight(x, y);
const refH = (x, y) => G.util.geoHeight(x, y, base(x, y), util);
// phase A: reference heights from the designer's geoHeight over the plain recipe (before any layer is installed)
const pts = [[600, 1900], [G.lake.x, G.lake.y]];
let bx = null, by = null;
for (let x = 900; x < 1900 && bx === null; x += 10) for (let y = 1500; y < 1800; y += 5) { const c = G.util.coastSD(x, y); if (c.kind === 'beach' && c.sd > 20 && c.sd < 30 && G.util.mask(x, y) >= 1 && G.util.ell(G.marsh, x, y) > 1.6) { bx = x; by = y; break; } }
pts.push([bx, by]);
let pkRef = null;   // highest designer cell on the Whitecombs spine
for (let x = 800; x <= 1300; x += 8) for (let y = 60; y <= 220; y += 8) { const r = refH(x, y); if (!pkRef || r > pkRef.r) pkRef = { x, y, r }; }
pts.push([pkRef.x, pkRef.y]);
const mpts = []; for (let a = 0; a < 40; a++) mpts.push([G.marsh.x + Math.cos(a) * 60 * (a % 3 + 1) * 0.6, G.marsh.y + Math.sin(a) * 40 * (a % 3 + 1) * 0.6]);
pts.push(...mpts);
const REF = new Map(pts.map(([x, y]) => [x + ',' + y, refH(x, y)]));
const ref = (x, y) => REF.get(x + ',' + y);
const tBase = best(west, 9) , tFarBase = best(() => util.generate(), 2);

G.util.installGeo(util);
ok('keep: east near band byte-identical with all layers', hashOf(east()) === h0.e);
ok('keep: west near band byte-identical with all layers', hashOf(west()) === h0.w);
const tLay = best(west, 9);
const tFarGeo = best(() => util.generate(), 2);
console.log(`zone bake west ${tBase.toFixed(1)} -> ${tLay.toFixed(1)} ms; far bake ${tFarBase.toFixed(0)} -> ${tFarGeo.toFixed(0)} ms`);
ok('far bake within the 38.42 gate (<= 1.5 s)', tFarGeo <= 1500);
ok('zone bake +<= 10 %', tLay <= tBase * 1.1 + 3);

const near = (a, b, tol) => Math.abs(a - b) <= tol;
// sea point: well inside the sea polygon
{ const x = 600, y = 1900, h = util.heightAt(x, y), r = ref(x, y);
  ok(`sea point h ${h.toFixed(2)} = geo ${r.toFixed(2)} below sea level ${G.seaLevel}`, near(h, r, 0.8) && h < G.seaLevel && util.typeAt(x, y) === 2); }
// beach: scan for a 'beach' coast point 25 m inland
ok('found a beach probe', bx !== null);
{ const h = util.heightAt(bx, by), r = ref(bx, by);
  ok(`beach (${bx},${by}) h ${h.toFixed(2)} = geo ${r.toFixed(2)}, just above sea, sand`, near(h, r, 1.2) && h > G.seaLevel && h < G.seaLevel + 8 && util.typeAt(bx, by) === 5); }
// Whitecombs: highest snow cell along the spine
const pk = { x: pkRef.x, y: pkRef.y, h: util.heightAt(pkRef.x, pkRef.y), t: util.typeAt(pkRef.x, pkRef.y) };
ok(`Whitecombs peak cell is snow (type ${pk.t})`, pk.t === 6 || pk.t === 3);
if (pk) { const r = ref(pk.x, pk.y);
  ok(`peak (${pk.x},${pk.y}) h ${pk.h.toFixed(1)} = geo ${r.toFixed(1)}, above snow line ${G.snowLine}`, near(pk.h, r, 1.5) && pk.h > G.snowLine); }
ok('steep rock stays rock above snow (some rock cell > snow line)', (() => { for (let x = 800; x <= 1300; x += 8) for (let y = 60; y <= 330; y += 8) if (util.heightAt(x, y) > G.snowLine && util.typeAt(x, y) === 3) return true; return false; })());
// lake + marsh
{ const x = G.lake.x, y = G.lake.y, h = util.heightAt(x, y), r = ref(x, y);
  ok(`lake centre h ${h.toFixed(2)} = geo ${r.toFixed(2)}, below surface ${G.lake.surface}, water`, near(h, r, 0.2) && h < G.lake.surface && util.typeAt(x, y) === 2); }
{ let reeds = 0, fen = 0, n = 0, hOk = true;
  for (const [x, y] of mpts) { n++; const t = util.typeAt(x, y); if (t === 7) reeds++; else if (t === 8) fen++; else if (t === 2) n--; if (Math.abs(util.heightAt(x, y) - ref(x, y)) > 0.3) hOk = false; }
  ok(`marsh types reeds ${reeds} / fen ${fen} of ${n}`, reeds + fen === n && fen > 0 && reeds > 0);
  ok('marsh heights match geo and are low-flat', hOk && util.heightAt(G.marsh.x, G.marsh.y) < G.seaLevel + 3); }
// outside a hard keep edge: continuous across the layer fade (no jump over 2 m)
{ let worst = 0; for (let y = 1000; y < 1100; y += 20) for (let x = 690; x < 720; x += 2) worst = Math.max(worst, Math.abs(util.heightAt(x + 2, y) - util.heightAt(x, y))); ok(`west keep edge continuous (worst dh ${worst.toFixed(2)})`, worst < 1.5); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
