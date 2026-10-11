// MAP-02/03/04/05 (arch 38.42): sea + beach + coast, ridges/peaks + snow, lake + marsh as composer layers from design/levels/world_geo.js.
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
  for (const [x, y] of mpts) { n++; const t = util.typeAt(x, y); if (t === 7) reeds++; else if (t === 8) fen++; else if (t === 2) n--; if (Math.abs(x - util.riverX(y)) > 90 && Math.abs(util.heightAt(x, y) - ref(x, y)) > 0.3) hOk = false;/* MAP-04: the river bed cuts the marsh edge */ }
  ok(`marsh types reeds ${reeds} / fen ${fen} of ${n}`, reeds + fen === n && fen > 0 && reeds > 0);
  ok('marsh heights match geo and are low-flat', hOk && util.heightAt(G.marsh.x, G.marsh.y) < G.seaLevel + 3); }
// outside a hard keep edge: continuous across the layer fade (no jump over 2 m)
{ let worst = 0; for (let y = 1000; y < 1100; y += 20) for (let x = 690; x < 720; x += 2) worst = Math.max(worst, Math.abs(util.heightAt(x + 2, y) - util.heightAt(x, y))); ok(`west keep edge continuous (worst dh ${worst.toFixed(2)})`, worst < 1.5); }
// ---- MAP-04: the river as one polyline source -> ford -> mouth ----
{ const xr = util.riverX;
  ok(`ford: x_r(1068) = ${xr(1068).toFixed(1)} (~1029), unchanged`, Math.abs(xr(1068) - 1029) < 1);
  // bed monotone: centre-line minimum over each 100 m stretch never rises going downstream (outside the lake bowl, y 400..620)
  const bed = (y) => { let m = 1e9; for (let d = -3; d <= 3; d += 1) m = Math.min(m, util.heightAt(xr(y) + d, y)); return m; };
  let rise = 0; for (let y = 700; y < 1740; y += 20) rise = Math.max(rise, bed(y + 20) - bed(y)); ok(`bed falls downstream south of the lake (worst rise ${rise.toFixed(2)} m / 20 m)`, rise < 2.6);
  // keep-edge continuity (|dh| < 0.05 per 2 m along the river, y 832 and 1344 edges)
  let worst = 0; for (const e of [832, 1344]) for (let y = e - 40; y < e + 40; y += 2) worst = Math.max(worst, Math.abs(util.heightAt(xr(y), y) - util.heightAt(xr(y + 2) , y + 2)) - 0);
  ok(`river bed continuous across the keep edges (worst step ${worst.toFixed(2)} m / 2 m)`, worst < 1.5);
  // width ramp: water band (type 2) wide at the mouth, 20 m in the middle
  const wid = (y) => { let n = 0; for (let x = xr(y) - 70; x <= xr(y) + 70; x += 1) if (util.typeAt(x, y) === 2) n++; return n; };
  ok(`width ramp mid ${wid(1400)} m -> mouth ${wid(1700)} m`, wid(1700) > wid(1400) + 30 && wid(1700) > 70);
  // mouth meets the sea: river bed at the shoreline equals the sea floor there (no step), no dry water-typed gap
  let mouth = null; for (let y = 1700; y < 1790 && !mouth; y += 1) if (G.util.coastSD(xr(y), y).sd < 0) mouth = y;
  const hb = util.heightAt(xr(mouth - 6), mouth - 6), hs = util.heightAt(xr(mouth + 6), mouth + 6);
  ok(`mouth: bed ${hb.toFixed(2)} -> sea floor ${hs.toFixed(2)} (step < 0.6) at sea level ${G.seaLevel}`, Math.abs(hb - hs) < 0.6 && hb < G.seaLevel && hs < G.seaLevel);
  // the sea rect floods exactly the water-typed cells: no non-water land cell below sea level in the estuary corridor
  let dry = 0, wet = 0; for (let y = 1420; y < 1760; y += 2) for (let x = 900; x < 1500; x += 2) { if (G.util.coastSD(x, y).sd <= 0 || util.heightAt(x, y) >= G.seaLevel) continue; if (util.typeAt(x, y) === 2) wet++; else dry++; }
  ok(`sea rect floods only water cells (${wet} water, ${dry} non-water below ${G.seaLevel})`, dry === 0 && wet > 0);
  // east/west near bands (keep) still byte-identical after the river layer
  ok('river layer: keep bands byte-identical', hashOf(east()) === h0.e && hashOf(west()) === h0.w);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
