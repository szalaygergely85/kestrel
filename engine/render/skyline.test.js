// MAP-06a (architecture.md 38.42 Skyline) JS-twin tests: the look's haze.skyline fog cap, the sea horizon skirt, shadow casters.
// Perspective raster has no far clip (rasterJS outcode tests only w < PROJ_NEAR; depth = 1/w), so 6 km needs no change in the JS twin;
// PROJ_FAR (16000 since MAP-06b) is the GPU far clip for perspective + ortho depth; the JS raster has no far clip.
// Run: node engine/render/skyline.test.js
import { skylineFogF, skylineError, SKYLINE_FROM_T } from './skyline.js';
import { resolveLook, validateLook } from './look.js';
import { shadeTerrainCells } from './terrainShade.js';
import { Terrain } from '../world/Terrain.js';
import { TerrainMeshSet, buildSeaSkirts } from '../mesh/terrainMesh.js';
import { DrawList } from '../mesh/DrawList.js';
import { GBuffer, KIND_TERRAIN } from './GBuffer.js';
import { CellBuffer } from './CellBuffer.js';
import { packNormalOct } from '../voxel/octNormal.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const ok = makeOk(() => pass++, () => fail++, (m) => console.error('FAIL:', m));

// ---- 1. pure cap ----
const S = { fogMax: 0.55, fromZ: 80, seaFogMax: 0.7, seaLevel: -96 };
ok('null skyline = passthrough', skylineFogF(0.9, 1000, 0, 500, null) === 0.9);
ok('peak far texel capped at fogMax', skylineFogF(0.9, 1000, 3, 200, S) === 0.55);
ok('peak below cap untouched', skylineFogF(0.4, 1000, 3, 200, S) === 0.4);
ok('low ground untouched', skylineFogF(0.9, 1000, 0, 10, S) === 0.9);
ok('sea texel at sea level capped at seaFogMax', skylineFogF(0.95, 1000, 2, -96, S) === 0.7);
ok('sea type above sea level (lake) untouched', skylineFogF(0.95, 1000, 2, -40, S) === 0.95);
ok('near texels never capped', skylineFogF(0.9, SKYLINE_FROM_T - 1, 3, 200, S) === 0.9 && skylineFogF(0.9, SKYLINE_FROM_T - 1, 2, -96, S) === 0.9);
ok('NaN z = no peak cap', skylineFogF(0.9, 1000, 3, NaN, S) === 0.9);
ok('skylineError good/bad', skylineError({ fogMax: 0.5, fromZ: 0, seaFogMax: 0.6 }) === '' && skylineError({ fogMax: 0, fromZ: 0, seaFogMax: 0.6 }) !== '' && skylineError({ fogMax: 1, fromZ: NaN, seaFogMax: 1 }) !== '');

// ---- 2. look ----
const rgb = { sun: [255, 240, 200], amb: [40, 50, 80], fogN: [230, 220, 190], fogF: [200, 236, 243], gl: [10, 40, 10], gm: [20, 80, 20], gh: [40, 120, 40] };
const hue = {}; for (const k of Object.keys(rgb)) { const m = Math.max(...rgb[k]) || 1; hue[k] = rgb[k].map((c) => c / m); }
const HAZE = { near: 'fogN', far: 'fogF', start: 15, full: 700, curve: 0.65, max: 0.78, bgK: 0.9, blank: 1.01, thin0: 0.45, thinK: 1, edgeMax: 0.5 };
function pal(skyline) {
  return {
    rgb, hue, ramps: {}, defaultTime: 'day',
    fog: { far: { start: 50, full: 1500, curve: 0.7, color: 'gl', colorFar: 'fogF' } },
    shading: { fgMin: 0.15, fgGamma: 0.6, fgMaxGain: 1.6 },
    timeOfDay: { day: { sun: 'sun', sunI: 1, sunElev: 60, ambient: 'amb', ambientI: 0.3, sky: [{ t: 0, c: 'fogF' }], haze: skyline === undefined ? { ...HAZE } : { ...HAZE, skyline } } },
  };
}
const SK = { fogMax: 0.55, fromZ: 80, seaFogMax: 0.7 };
ok('look: haze.skyline resolves', JSON.stringify(resolveLook(pal(SK)).haze.skyline) === JSON.stringify(SK));
ok('look: absent skyline = null', resolveLook(pal(undefined)).haze.skyline === null);
{
  const v = validateLook(pal({ fogMax: 2, fromZ: 0, seaFogMax: 0.5 }), 'day');
  const errs = Array.isArray(v) ? v : (v && v.errors) || [];
  ok('look: bad skyline reported', errs.some((e) => /haze\.skyline/.test(String(e))));
}

// ---- 3. shadeTerrainCells ----
const W = 8, CELL = 8;
function recipeFor(geo) {
  const r = {
    seed: 1, map: { w: W, h: W, cell: CELL }, bands: { near: 150, mid: 600 },
    terrain: { grass: { id: 0, colors: ['gl', 'gm', 'gh'], glyphs: { near: '",', mid: ',.', far: '.' }, albedo: 0.85 },
               forest: { id: 1, colors: ['gl', 'gm', 'gh'], glyphs: { near: '^', mid: '^', far: '^' }, albedo: 0.5 },
               water: { id: 2, colors: ['gl', 'gm', 'gh'], glyphs: { near: '~', mid: '~', far: '~' }, albedo: 0.5 } },
    recipe: {},
    util: {
      heightAt: (x) => (x < 32 ? 200 : -96), typeAt: (x) => (x < 32 ? 0 : 2),
      generate() { const n = W * W, height = new Float32Array(n), type = new Uint8Array(n); for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { height[i + j * W] = i < 4 ? 200 : -96; type[i + j * W] = i < 4 ? 0 : 2; } return { height, type, w: W, h: W, cell: CELL }; },
      bake(x0, y0, c2, bw, bh) { const n = bw * bh; return { x0, y0, w: bw, h: bh, cell: c2, height: new Float32Array(n), type: new Uint8Array(n) }; },
      gridHeight() { return 0; },
    },
  };
  if (geo) r.geo = geo;
  return r;
}
const GEO = { seaLevel: -96, seaSides: ['s'], seaSkirtM: 6000 };
const world = { sun: { azimuth: 90, elevation: 60 } };
function shadeAt(terrain, palette, u, v, type, t, z) {
  const gbuf = new GBuffer(1, 1);
  gbuf.kind[0] = KIND_TERRAIN; gbuf.mat[0] = type; gbuf.u[0] = u; gbuf.v[0] = v; gbuf.z[0] = z;
  new Uint32Array(gbuf.aoD.buffer)[0] = packNormalOct(0, 0, 1);
  const fb = { rt: new CellBuffer(1, 1), gbuf, palette, matTable: null, depth: { depth: Float32Array.of(t) }, light: null };
  shadeTerrainCells(fb, terrain, world, 0, 0);
  return { fg: Array.from(fb.rt.fg.slice(0, 3)), bg: Array.from(fb.rt.bg.slice(0, 3)), fogF: gbuf.fogF[0] };
}
{
  const tGeo = new Terrain(recipeFor(GEO)); tGeo.bakeFarSync();
  const tPlain = new Terrain(recipeFor(null)); tPlain.bakeFarSync();
  const P = pal(SK), Pno = pal(undefined);
  const a = shadeAt(tGeo, P, 4, 4, 0, 1200, 200), b = shadeAt(tGeo, Pno, 4, 4, 0, 1200, 200);
  ok('far peak: skyline look changes the colour', a.fg.join() !== b.fg.join());
  ok('far peak: gbuf.fogF stays the uncapped terrain fog', a.fogF === b.fogF);
  const c = shadeAt(tGeo, P, 60, 4, 2, 1000, -96), d = shadeAt(tGeo, Pno, 60, 4, 2, 1000, -96);
  ok('far sea line: colour changes', c.fg.join() !== d.fg.join());
  const lo = shadeAt(tGeo, P, 4, 4, 0, 1200, 20), lo2 = shadeAt(tGeo, Pno, 4, 4, 0, 1200, 20);
  ok('far texel below fromZ (gbuf.z 20): no cap', lo.fg.join() === lo2.fg.join() && lo.bg.join() === lo2.bg.join());
  const e = shadeAt(tGeo, P, 4, 4, 0, 100, 200), f = shadeAt(tGeo, Pno, 4, 4, 0, 100, 200);
  ok('near texel identical with/without skyline', e.fg.join() === f.fg.join() && e.bg.join() === f.bg.join());
  const g = shadeAt(tPlain, P, 4, 4, 0, 1200, 200), h = shadeAt(tPlain, Pno, 4, 4, 0, 1200, 200);
  ok('recipe without geo.seaLevel: skyline look inert', g.fg.join() === h.fg.join() && g.bg.join() === h.bg.join());
}

// ---- 4. sea skirt ----
{
  const t0 = new Terrain(recipeFor(null)); t0.bakeFarSync();
  ok('no geo = no skirts', buildSeaSkirts(t0).length === 0);
  const t = new Terrain(recipeFor(GEO)); t.bakeFarSync();
  const sk = buildSeaSkirts(t);
  ok('one skirt for seaSides [s]', sk.length === 1);
  const r = sk[0].rect, m = sk[0].mesh;
  ok('skirt rect: south edge, 6000 m out, widened along the edge', r.y0 === W * CELL && r.y1 === W * CELL + 6000 && r.x0 === -6000 && r.x1 === W * CELL + 6000);
  ok('skirt mesh: 4 verts at seaLevel, 2 tris', m.pos.length === 12 && [2, 5, 8, 11].every((i) => m.pos[i] === -96) && m.triCount === 2 && m.idx.length === 6);
  let threw = false; try { buildSeaSkirts(new Terrain(recipeFor({ ...GEO, seaSides: ['q'] }))); } catch (_) { threw = true; }
  ok('bad side throws', threw);

  const set = new TerrainMeshSet(t);
  ok('typeAt: off-grid in skirt = 2; in grid = farType; off-grid outside = 0', set.typeAt(30, 5000) === 2 && set.typeAt(4, 4) === t.farType[0] && set.typeAt(-9000, 30) === 0);
  const list = new DrawList();
  const count = (cam, noSkirt) => { list.begin(); set.addToDrawList(list, cam, noSkirt); return list.count; };
  const withSkirt = count({ x: 30, y: 30, z: 5 }, false), without = count({ x: 30, y: 30, z: 5 }, true);
  ok('skirt drawn for camera, excluded from sun-shadow lists', withSkirt === without + 1);
  ok('skirt culled beyond its own reach', count({ x: 30, y: -8000, z: 5 }, false) < withSkirt);
}

console.log(`skyline.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
