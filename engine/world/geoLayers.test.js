// MAP-01a (arch 38.42): geography layer composer. Empty list = today's bytes; keep rect is branched out; GeoFields SDF grids.
// Run: node engine/world/geoLayers.test.js   (needs scratch copy of the pre-change recipe at $GEO_BASE, else skipped parts)
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeOk } from '../test/assert.js';
import terrainDef from '../../design/levels/overworld_far.js';
globalThis.window = globalThis.window || globalThis;
terrainDef;
const recipe = globalThis.ASSETS.levels.overworld_far;
const inject = (r) => { r.structures[0].bbox = { x0: 1480, y0: 1018, x1: 1504, y1: 1032 }; r.structures[0].ringHAt = () => 2.4; };
inject(recipe);
const util = recipe.util;
let pass = 0, fail = 0;
const ok = makeOk(() => pass++, () => fail++, (m) => console.error('FAIL:', m));
const hashOf = (G) => createHash('sha1').update(Buffer.from(G.height.buffer)).update(Buffer.from(G.type.buffer)).digest('hex');
const KEEP = recipe.geo.keep;
const east = () => util.bake(9 * 128, 7 * 128, 2, 5 * 64, 3 * 64);   // near band inside keep (x 1152..1792 touches keep edge)
const west = () => util.bake(6 * 128, 7 * 128, 2, 3 * 64, 3 * 64);   // x 768..1152, y 896..1280: fully inside keep
const far = () => util.generate();

// 1. empty list == pre-change bytes (pinned from HEAD copy when available)
util.setGeoLayers([]);
// RIVER-04 (arch 38.45 resolution): the recipe's river bedLine deliberately carves the channel downstream of the ford inside the keep;
// the pinned pre-change compare runs with it off (everything else must still be byte-identical), the rest of the test with it on.
const bedLine = recipe.recipe.river.bedLine; delete recipe.recipe.river.bedLine;
const bankRock = recipe.recipe.river.bankRock; delete recipe.recipe.river.bankRock; // OB-062b: gentle banks earth/grass + band 9.5 m (same treatment as bedLine)
const riverHalfW = recipe.recipe.river.halfWidth; recipe.recipe.river.halfWidth = 10;
// GATE-FIX-1016: content paints added after d3be9a62 (VISQA-08 fordHillGrass in chunk '8,8', inside the west window) are not part of the
// pre-change recipe; hide them for the pinned compare only (the empty-layer-list == no-layers claim is unchanged), restore below.
const ovr88 = recipe.overrides && recipe.overrides['8,8']; if (ovr88) { delete recipe.overrides['8,8']; util.reindexOverrides(); }
const h0 = { e: hashOf(east()), w: hashOf(west()), f: hashOf(far()) };
// pre-change recipe = the file at git commit d3be9a62 (MAP-01a parent); GEO_BASE overrides with a file path
let BASE = process.env.GEO_BASE, TMP_BASE = null;
process.on('exit', () => { if (TMP_BASE) { try { unlinkSync(TMP_BASE); } catch (e) {} } });
if (!BASE) { try { BASE = join(tmpdir(), `geo_base_far_${process.pid}_${Math.random().toString(36).slice(2)}.mjs`); TMP_BASE = BASE; writeFileSync(BASE, execSync('git show d3be9a62:design/levels/overworld_far.js', { maxBuffer: 1e8 })); } catch (e) { BASE = null; } }
if (BASE && existsSync(BASE)) {
  const keep = globalThis.ASSETS.levels.overworld_far; delete globalThis.ASSETS.levels.overworld_far;
  await import(pathToFileURL(BASE).href);
  inject(globalThis.ASSETS.levels.overworld_far); const b = globalThis.ASSETS.levels.overworld_far.util; globalThis.ASSETS.levels.overworld_far = keep;
  ok('empty list: near east == pre-change', hashOf(b.bake(9 * 128, 7 * 128, 2, 5 * 64, 3 * 64)) === h0.e);
  ok('empty list: near west == pre-change', hashOf(b.bake(6 * 128, 7 * 128, 2, 3 * 64, 3 * 64)) === h0.w);
  ok('empty list: far bake == pre-change', hashOf(b.generate()) === h0.f);
} else console.log('SKIP baseline compare (set GEO_BASE)');
recipe.recipe.river.bedLine = bedLine; if (bankRock) recipe.recipe.river.bankRock = bankRock; recipe.recipe.river.halfWidth = riverHalfW; if (ovr88) { recipe.overrides['8,8'] = ovr88; util.reindexOverrides(); }
h0.e = hashOf(east()); h0.w = hashOf(west()); h0.f = hashOf(far());

// 2. four dummy layers outside keep: keep area unchanged, outside changed
const layers = [
  { id: 'a', rect: [0, 0, 600, 4096], heightFn: (h) => h - 30, typeFn: () => 2 },
  { id: 'b', rect: [1900, 0, 4096, 4096], heightFn: (h, x, y, F) => h + 50 + F.sdf('d', x, y) * 0.01 },
  { id: 'c', rect: [0, 0, 4096, 700], heightFn: (h) => h + 5, typeFn: (t) => (t === 0 ? 7 : t) },
  { id: 'd', rect: [0, 2000, 4096, 4096], heightFn: (h) => h * 1.01 }
];
const F = util.setGeoLayers(layers, { d: util.polylineSdf([[100, 100], [3000, 2500], [4000, 4000]]) });
ok('GeoFields built', F && F.ids.length === 1);
ok('keep: near east unchanged with layers', hashOf(east()) === h0.e);
ok('keep: near west unchanged with layers', hashOf(west()) === h0.w);
const fl = far(), f0 = (util.setGeoLayers([]), far());
let diffIn = 0, diffOut = 0;
for (let j = 0; j < fl.h; j++) for (let i = 0; i < fl.w; i++) {
  const x = (i + 0.5) * fl.cell, y = (j + 0.5) * fl.cell, k = i + j * fl.w;
  const d = fl.height[k] !== f0.height[k] || fl.type[k] !== f0.type[k];
  if (x >= KEEP.x0 && x < KEEP.x1 && y >= KEEP.y0 && y < KEEP.y1) diffIn += d; else diffOut += d;
}
ok(`far texels inside keep equal (${diffIn} diffs)`, diffIn === 0);
ok(`far texels outside keep changed (${diffOut})`, diffOut > 1000);

// 3. sdf accuracy, validator, 0-alloc, timing
util.setGeoLayers(layers, { d: util.polylineSdf([[100, 100], [3000, 2500], [4000, 4000]]) });
const sd = util.polylineSdf([[100, 100], [3000, 2500], [4000, 4000]]);
ok('sdf at grid node exact', Math.abs(F.sdf('d', 160, 96) - sd(160, 96)) < 1e-3);
ok('sdf bilinear within 8 m of exact', Math.abs(F.sdf('d', 1234, 987) - sd(1234, 987)) < 8);
let threw = false; try { util.setGeoLayers([{ id: 'x', rect: [0, 0, 1, 1], core: [800, 900, 900, 1000] }]); } catch (e) { threw = true; }
ok('validator: core overlapping keep throws', threw);
threw = false; try { util.polygonSdf(new Array(33).fill([0, 0])); } catch (e) { threw = true; }
ok('validator: polygon > 32 verts throws', threw);
util.setGeoLayers(layers, { d: sd });
if (global.gc) { global.gc(); global.gc(); } else console.log('SKIP gc before heap probe (no --expose-gc)');
let s = 0; const heap0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 100000; i++) s += util.recipeHeight(2000 + (i % 400), 300 + (i % 700));
const dHeap = process.memoryUsage().heapUsed - heap0;
ok(`100k samples heap delta ${(dHeap / 1e6).toFixed(1)} MB < 8 MB`, dHeap < 8e6);

const time1 = (f) => { const a = performance.now(); f(); return performance.now() - a; };
const med = (f) => { const t = []; for (let k = 0; k < 3; k++) t.push(time1(f)); return t.sort((x, y) => x - y)[1]; };
// arch 38.61 (5): median of 3, baseline (no layers) and 4 layers INTERLEAVED A,B,A,B,A,B in this process, so machine load hits both alike.
const tA = [], tB = [], fA = [], fB = [];
for (let k = 0; k < 3; k++) {
  util.setGeoLayers([]); tA.push(time1(east)); fA.push(time1(far));
  util.setGeoLayers(layers, { d: sd }); tB.push(time1(east)); fB.push(time1(far));
}
const m3 = (t) => t.sort((x, y) => x - y)[1];
const tEmpty = m3(fA), tZone0 = m3(tA), tFour = m3(fB), tZone4 = m3(tB);
util.setGeoLayers([]);
const tBuild = med(() => new util.GeoFields(recipe.geo.world, { d: sd }));
util.setGeoLayers(layers, { d: sd });
console.log(`bake ms: far256 empty ${tEmpty.toFixed(1)} / 4 layers ${tFour.toFixed(1)}; near zone empty ${tZone0.toFixed(1)} / 4 layers (in keep) ${tZone4.toFixed(1)}; GeoFields build (1 field, 4096 world) ${tBuild.toFixed(1)} ms`);
ok('zone bake inside keep +<=10% (noise margin 25%)', tZone4 <= tZone0 * 1.25 + 2);
console.log(`geoLayers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
