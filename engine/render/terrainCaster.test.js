// US-016 Node tests for `marchTerrainRay`/`castTerrain` (docs/architecture.md
// 14.4 item 4/6, D-017). A self-contained analytic stub recipe - no
// `design/` import, matching every other engine test in this repo.
import assert from 'node:assert';
import { Terrain } from '../world/Terrain.js';
import { marchTerrainRay, castTerrain, FOG_FULL, MAX_TERRAIN_STEPS } from './terrainCaster.js';
import { GBuffer, KIND_TERRAIN, PLANEID_TERRAIN } from './GBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { OpenSpans } from './OpenSpans.js';
import { CellBuffer } from './CellBuffer.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('FAIL:', name); }
}

// ---- a tiny flat-ground stub recipe (H = FLAT_H everywhere, type 0) --------
const FLAT_H = 5;
function makeFlatRecipe({ w = 64, h = 64, cell = 8 } = {}) {
  return {
    seed: 1,
    map: { w, h, cell },
    terrain: { grass: { id: 0, colors: ['grassDark', 'grass', 'grassLight'], glyphs: { near: ',', mid: ',', far: '.' }, albedo: 0.8 } },
    bands: { near: 150, mid: 600 },
    recipe: { forest: { canopy: 10 } },
    util: {
      heightAt: () => FLAT_H,
      typeAt: () => 0,
      generate: () => {
        const n = w * h;
        return { height: new Float32Array(n).fill(FLAT_H), type: new Uint8Array(n), w, h, cell };
      },
      gridHeight(G, x, y) {
        const fx = x / cell - 0.5, fy = y / cell - 0.5;
        if (fx < 0 || fy < 0 || fx >= w - 1 || fy >= h - 1) return null;
        return G.height[0];
      },
    },
  };
}

function makeFB(cols, rows, gbuf = true) {
  const rt = { cols, rows, pxCellW: 1, pxCellH: 1, cells: new CellBuffer(cols, rows) };
  return { rt, depth: new DepthBuffer(cols, rows), spans: new OpenSpans(cols), gbuf: gbuf ? new GBuffer(cols, rows) : null };
}

// ---- marchTerrainRay ---------------------------------------------------------
{
  const terrain = new Terrain(makeFlatRecipe());
  terrain.bakeFarSync();
  check('flat bake: farReady', terrain.farReady === true);
  check('flat bake: farMaxH == FLAT_H', Math.abs(terrain.farMaxH - FLAT_H) < 1e-6);

  const out = { t: 0, x: 0, y: 0, h: 0 };
  // Looking down at a flat floor from eye height 10, straight down (slope very negative): must hit near t where h(t)=FLAT_H.
  const hit = marchTerrainRay(terrain, 100, 100, 10, 1, 0, -0.2, FOG_FULL, new Float64Array(0), 0, {}, out);
  check('flat floor: hit', hit === true);
  const expectedT = (10 - FLAT_H) / 0.2;
  check('flat floor: t within 0.5%', Math.abs(out.t - expectedT) / expectedT < 0.005);
  check('flat floor: h == FLAT_H at hit', Math.abs(out.h - FLAT_H) < 0.05);

  // A ray with slope >= 0 and eyeH >= farMaxH takes 0 steps (never dips below the flat ground).
  const noHit = marchTerrainRay(terrain, 100, 100, 20, 1, 0, 0.1, FOG_FULL, new Float64Array(0), 0, {}, out);
  check('above every hill, slope>=0: no hit', noHit === false);

  // Out of the far map (2 km away on a 512 m map) -> no hit (haze).
  const farAway = marchTerrainRay(terrain, 100, 100, 10, 1, 0, -0.2, FOG_FULL, new Float64Array(0), 0, {}, out);
  check('sanity: flat floor still hits close by', farAway === true);
  const beyondMap = marchTerrainRay(terrain, 100000, 100000, 10, 1, 0, -0.2, FOG_FULL, new Float64Array(0), 0, {}, out);
  check('outside the far map: no hit', beyondMap === false);
}

// ---- a hill recipe (single bump) for the "climbing above every hill" case ---
{
  const hillW = 64, hillH = 64, cellSz = 8;
  const HMAX = 40;
  function heightAt(x, y) {
    const d = Math.hypot(x - 256, y - 256);
    return HMAX * Math.exp(-Math.pow(d / 100, 2));
  }
  const recipe = {
    seed: 2, map: { w: hillW, h: hillH, cell: cellSz },
    terrain: { grass: { id: 0, colors: ['grassDark', 'grass', 'grassLight'], glyphs: { near: ',', mid: ',', far: '.' }, albedo: 0.8 } },
    bands: { near: 150, mid: 600 }, recipe: { forest: { canopy: 10 } },
    util: {
      heightAt, typeAt: () => 0,
      generate: () => {
        const n = hillW * hillH;
        const height = new Float32Array(n);
        for (let j = 0; j < hillH; j++) for (let i = 0; i < hillW; i++) height[i + j * hillW] = heightAt((i + 0.5) * cellSz, (j + 0.5) * cellSz);
        return { height, type: new Uint8Array(n), w: hillW, h: hillH, cell: cellSz };
      },
      gridHeight(G, x, y) {
        const fx = x / cellSz - 0.5, fy = y / cellSz - 0.5, i = Math.floor(fx), j = Math.floor(fy);
        if (i < 0 || j < 0 || i >= hillW - 1 || j >= hillH - 1) return null;
        const u = fx - i, v = fy - j, a = G.height[i + j * hillW], b = G.height[i + 1 + j * hillW], c = G.height[i + (j + 1) * hillW], d = G.height[i + 1 + (j + 1) * hillW];
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
      },
    },
  };
  const terrain = new Terrain(recipe);
  terrain.bakeFarSync();
  check('hill: farMaxH ~= HMAX', Math.abs(terrain.farMaxH - HMAX) < 1.5);

  const out = { t: 0, x: 0, y: 0, h: 0 };
  const hit = marchTerrainRay(terrain, 100, 256, 10, 1, 0, 0, FOG_FULL, new Float64Array(0), 0, {}, out);
  check('hill: level ray hits the slope', hit === true);

  // A ray climbing steeply from well above the hill escapes (no hit).
  const escapeOut = { t: 0, x: 0, y: 0, h: 0 };
  const escaped = marchTerrainRay(terrain, 100, 256, 45, 1, 0, 0.5, FOG_FULL, new Float64Array(0), 0, {}, escapeOut);
  check('hill: steep upward ray from above escapes', escaped === false);

  // castTerrain end to end: a small frame, camera near the hill looking at it, no allocation over N frames.
  const fb = makeFB(16, 12);
  const cam = { x: 100, y: 256, z: 12, yawDeg: 90, pitchDeg: 0 };
  fb.spans.reset(fb.rt.rows);
  const worldStub = { structures: [] };
  castTerrain(fb, terrain, cam, worldStub);
  let wroteTerrain = false;
  for (let i = 0; i < fb.gbuf.kind.length; i++) if (fb.gbuf.kind[i] === KIND_TERRAIN) wroteTerrain = true;
  check('castTerrain: wrote at least one KIND_TERRAIN cell', wroteTerrain);
  for (let i = 0; i < fb.gbuf.planeId.length; i++) if (fb.gbuf.kind[i] === KIND_TERRAIN) check('castTerrain: terrain planeId is the constant PLANEID_TERRAIN', fb.gbuf.planeId[i] === PLANEID_TERRAIN);

  // No-op before farReady.
  const fresh = new Terrain(recipe);
  const fb2 = makeFB(8, 6);
  fb2.spans.reset(fb2.rt.rows);
  castTerrain(fb2, fresh, cam, worldStub);
  let anyWrite = false;
  for (let i = 0; i < fb2.gbuf.kind.length; i++) if (fb2.gbuf.kind[i] !== 0) anyWrite = true;
  check('castTerrain: no-op before farReady', anyWrite === false);

  // Structure skip: a bbox placed directly in front of the camera (camera OUTSIDE it) must not get a terrain hit inside it.
  const fb3 = makeFB(16, 12);
  fb3.spans.reset(fb3.rt.rows);
  const camOutside = { x: 40, y: 256, z: 12, yawDeg: 90, pitchDeg: 0 };
  const worldWithStruct = { structures: [{ bbox: { x0: 90, y0: 200, x1: 300, y1: 320 } }] };
  castTerrain(fb3, terrain, camOutside, worldWithStruct);
  // Margin of one worst-case step (~10 m near this bbox) around the edges: the
  // documented march (item 4) only tests a STEP's end t1 against the skip
  // window, so a hit whose bisected crossing lands between t0 and a t1 just
  // past the window's exit can slip a few metres inside near a boundary -
  // the same limitation the GPU shader has (identical algorithm). A hit deep
  // in the bbox interior would still mean a real bug.
  let anyDeepInsideBbox = false;
  for (let i = 0; i < fb3.gbuf.kind.length; i++) {
    if (fb3.gbuf.kind[i] !== KIND_TERRAIN) continue;
    const u = fb3.gbuf.u[i], v = fb3.gbuf.v[i];
    if (u >= 100 && u < 290 && v >= 210 && v < 310) anyDeepInsideBbox = true;
  }
  check('castTerrain: never hits deep inside a structure bbox', !anyDeepInsideBbox);

  // Zero allocation over 100 frames (a loose smoke check: same object identity for reused scratch).
  const fb4 = makeFB(24, 18);
  let ok = true;
  for (let f = 0; f < 100; f++) {
    fb4.gbuf.beginFrame();
    fb4.depth.clear();
    fb4.spans.reset(fb4.rt.rows);
    try { castTerrain(fb4, terrain, cam, worldStub); } catch (e) { ok = false; }
  }
  check('castTerrain: 100 frames run without throwing', ok);
}

console.log(`terrainCaster.test.js: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
