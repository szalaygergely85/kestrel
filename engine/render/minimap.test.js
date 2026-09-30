// engine/render/minimap.test.js (RE-13, docs/architecture.md 28.4 "RE-13
// minimap"). Zero-alloc gate needs --expose-gc: re-runs itself when missing
// (same pattern as engine/render/pick.test.js). Run: node engine/render/minimap.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createMinimap, bakeTerrain, bindFog, update, minimapToWorld, worldToMinimap,
} from './minimap.js';
import { createPitchedTerms, pitchedTerms, screenRay } from './projection.js';
import { rayTerrain } from './pick.js';
import { Visibility } from '../world/Visibility.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function makeUnits(cap) {
  return { count: 0, x: new Float64Array(cap), y: new Float64Array(cap), team: new Uint8Array(cap), half: new Uint8Array(cap) };
}

// ---------------------------------------------------------------------------
// minimapToWorld / worldToMinimap: exact linear inverses (AC3).
// ---------------------------------------------------------------------------
{
  const mm = createMinimap({ width: 256, height: 256, x0: -100, y0: -50, x1: 300, y1: 450, teamRgb: new Uint8Array(24) });
  const out2 = [0, 0];
  const cases = [[0, 0], [128, 128], [255.5, 0.25], [1e-3, 255.999]];
  for (const [u, v] of cases) {
    minimapToWorld(mm, u, v, out2);
    const back = worldToMinimap(mm, out2[0], out2[1], [0, 0]);
    ok(`worldToMinimap(minimapToWorld(${u},${v})) round-trips within 1e-9`,
      Math.abs(back[0] - u) < 1e-9 && Math.abs(back[1] - v) < 1e-9,
      `u'=${back[0]} v'=${back[1]}`);
  }
  // A click at pixel (10.5, 20.5) [pixel centre] maps into world cell 10,20.
  const click = minimapToWorld(mm, 10.5, 20.5, out2);
  const expX = -100 + 10.5 * ((300 - -100) / 256);
  const expY = -50 + 20.5 * ((450 - -50) / 256);
  ok('click at a pixel centre maps to the exact expected world cell', Math.abs(click[0] - expX) < 1e-9 && Math.abs(click[1] - expY) < 1e-9);
}

// ---------------------------------------------------------------------------
// bakeTerrain: flat terrain, single type, known shade (deterministic formula
// check) + a structureAt override.
// ---------------------------------------------------------------------------
{
  const mm = createMinimap({ width: 8, height: 8, x0: 0, y0: 0, x1: 8, y1: 8, teamRgb: new Uint8Array(24) });
  const typeRgb = new Uint8Array([200, 150, 100]); // one type
  const terrain = {
    heightAt: () => 0,
    normalAt: (x, y, out) => { out.x = 0; out.y = 0; out.z = 1; },
    typeAt: () => 0,
  };
  bakeTerrain(mm, terrain, typeRgb, { hMin: 0, hMax: 10, structureAt: (x, y) => x === 4.5 && y === 4.5 ? false : x < 1 && y < 1, structureRgb: [9, 9, 9] });
  const lsZ = 2 / Math.sqrt(6);
  const shade = (0.35 + 0.65 * lsZ) * (0.8 + 0.2 * 0); // hn=0 (h==hMin)
  const expR = Math.round(200 * shade), expG = Math.round(150 * shade), expB = Math.round(100 * shade);
  // pixel (4,4): centre (4.5,4.5) is outside the structureAt(x<1,y<1) box.
  const idx = (4 * 8 + 4) * 3;
  ok('bakeTerrain: flat terrain shade matches the documented formula exactly', mm.base[idx] === expR && mm.base[idx + 1] === expG && mm.base[idx + 2] === expB, `got ${mm.base[idx]},${mm.base[idx + 1]},${mm.base[idx + 2]} want ${expR},${expG},${expB}`);
  // pixel (0,0): centre (0.5,0.5) is inside the structure box -> flat override.
  const idx0 = 0;
  ok('bakeTerrain: structureAt pixel gets structureRgb, not the shaded type colour', mm.base[idx0] === 9 && mm.base[idx0 + 1] === 9 && mm.base[idx0 + 2] === 9);
}

// ---------------------------------------------------------------------------
// bindFog + update: fog LUT (0->unseen, 128->explored*exploredQ8, 255->base).
// ---------------------------------------------------------------------------
{
  const mm = createMinimap({
    width: 4, height: 4, x0: 0, y0: 0, x1: 4, y1: 4,
    teamRgb: new Uint8Array([255, 0, 0, 0, 255, 0]), unseenRgb: [1, 2, 3], exploredQ8: 128,
  });
  const typeRgb = new Uint8Array([100, 100, 100]);
  const flat = { heightAt: () => 0, normalAt: (x, y, out) => { out.x = 0; out.y = 0; out.z = 1; }, typeAt: () => 0, groundAt: () => 0 };
  bakeTerrain(mm, flat, typeRgb, { hMin: 0, hMax: 1 });

  const view = new Visibility({ x0: 0, y0: 0, w: 4, h: 4, cell: 1, teams: 2, maxSources: 8, maxRadiusCells: 4 });
  bindFog(mm, view);
  // Explore (0,0) permanently, make (1,1) currently visible via a source.
  view.revealAll(0); // everything explored (state 128) for team 0
  view.setSource(1, 0b01, 1.5, 1.5, 0.4); // small circle covering cell (1,1) only, team 0

  const cam = createPitchedTerms();
  pitchedTerms({ x: 2, y: 2, z: 50, yawDeg: 0, pitchDeg: -89 }, { cols: 16, rows: 16 }, cam);
  const terms = cam;
  const units = makeUnits(1);
  update(mm, units, view, 0, terms, flat);

  const base00 = [mm.base[0], mm.base[1], mm.base[2]];
  const px00 = [mm.rgba[0], mm.rgba[1], mm.rgba[2]];
  const expExplored = base00.map((c) => (c * 128) >> 8);
  ok('fogged cell (explored, not visible) = base*exploredQ8>>8', px00[0] === expExplored[0] && px00[1] === expExplored[1] && px00[2] === expExplored[2], `got ${px00} want ${expExplored}`);

  const idxVis = (1 * 4 + 1) * 4;
  const baseVis = [mm.base[(1 * 4 + 1) * 3], mm.base[(1 * 4 + 1) * 3 + 1], mm.base[(1 * 4 + 1) * 3 + 2]];
  ok('fogged cell (currently visible) = base unchanged', mm.rgba[idxVis] === baseVis[0] && mm.rgba[idxVis + 1] === baseVis[1] && mm.rgba[idxVis + 2] === baseVis[2]);

  // Cell (3,3) untouched by revealAll before bindFog? revealAll marks the
  // whole grid explored, so re-check unseen behaviour on a fresh view.
  const view2 = new Visibility({ x0: 0, y0: 0, w: 4, h: 4, cell: 1, teams: 1, maxSources: 4, maxRadiusCells: 4 });
  const mm2 = createMinimap({ width: 4, height: 4, x0: 0, y0: 0, x1: 4, y1: 4, teamRgb: new Uint8Array([0, 0, 0]), unseenRgb: [7, 8, 9] });
  bakeTerrain(mm2, flat, typeRgb, { hMin: 0, hMax: 1 });
  bindFog(mm2, view2);
  update(mm2, makeUnits(0), view2, 0, terms, flat);
  ok('fogged cell (never seen) = unseenRgb', mm2.rgba[0] === 7 && mm2.rgba[1] === 8 && mm2.rgba[2] === 9);
}

// ---------------------------------------------------------------------------
// hideUnseen: an enemy unit is drawn only where its cell is currently
// visible (state 255) to viewTeam; own-team units always draw.
// ---------------------------------------------------------------------------
{
  const mm = createMinimap({ width: 10, height: 10, x0: 0, y0: 0, x1: 10, y1: 10, teamRgb: new Uint8Array([255, 0, 0, 0, 255, 0]), hideUnseen: true });
  const typeRgb = new Uint8Array([0, 0, 0]);
  const flat = { heightAt: () => 0, normalAt: (x, y, out) => { out.x = 0; out.y = 0; out.z = 1; }, typeAt: () => 0, groundAt: () => 0 };
  bakeTerrain(mm, flat, typeRgb, { hMin: 0, hMax: 1 });
  const view = new Visibility({ x0: 0, y0: 0, w: 10, h: 10, cell: 1, teams: 2, maxSources: 8, maxRadiusCells: 4 });
  bindFog(mm, view);
  const cam = createPitchedTerms();
  pitchedTerms({ x: 5, y: 5, z: 50, yawDeg: 0, pitchDeg: -89 }, { cols: 16, rows: 16 }, cam);

  const units = makeUnits(2);
  units.count = 2;
  units.x[0] = 3.5; units.y[0] = 3.5; units.team[0] = 1; units.half[0] = 0; // enemy, unseen cell
  units.x[1] = 7.5; units.y[1] = 7.5; units.team[1] = 0; units.half[1] = 0; // own team

  update(mm, units, view, 0, cam, flat);
  // px = Math.round((x-x0)/sx): 3.5 -> 4, 7.5 -> 8 (JS rounds .5 up).
  const enemyIdx = (4 * 10 + 4) * 4;
  const ownIdx = (8 * 10 + 8) * 4;
  ok('hideUnseen: enemy unit in an unseen cell is not drawn', !(mm.rgba[enemyIdx] === 0 && mm.rgba[enemyIdx + 1] === 255 && mm.rgba[enemyIdx + 2] === 0));
  ok('own-team unit always drawn', mm.rgba[ownIdx] === 255 && mm.rgba[ownIdx + 1] === 0 && mm.rgba[ownIdx + 2] === 0);

  // Now make the enemy's cell visible -> it must be drawn.
  view.setSource(99, 0b01, 3.5, 3.5, 0.4);
  update(mm, units, view, 0, cam, flat);
  ok('hideUnseen: enemy unit becomes visible once its cell is state 255', mm.rgba[enemyIdx] === 0 && mm.rgba[enemyIdx + 1] === 255 && mm.rgba[enemyIdx + 2] === 0);
}

// ---------------------------------------------------------------------------
// Clipping: a unit square drawn at the very edge does not throw and does not
// write outside the buffer (array bounds enforced naturally, but also check
// the opposite-edge pixel is untouched).
// ---------------------------------------------------------------------------
{
  const mm = createMinimap({ width: 6, height: 6, x0: 0, y0: 0, x1: 6, y1: 6, teamRgb: new Uint8Array([255, 255, 255]) });
  const typeRgb = new Uint8Array([0, 0, 0]);
  const flat = { heightAt: () => 0, normalAt: (x, y, out) => { out.x = 0; out.y = 0; out.z = 1; }, typeAt: () => 0, groundAt: () => 0 };
  bakeTerrain(mm, flat, typeRgb, { hMin: 0, hMax: 1 });
  const view = new Visibility({ x0: 0, y0: 0, w: 6, h: 6, cell: 1, teams: 1, maxSources: 4, maxRadiusCells: 4 });
  view.revealAll(0);
  bindFog(mm, view);
  const cam = createPitchedTerms();
  pitchedTerms({ x: 3, y: 3, z: 50, yawDeg: 0, pitchDeg: -89 }, { cols: 16, rows: 16 }, cam);
  const units = makeUnits(1);
  units.count = 1;
  units.x[0] = 0.5; units.y[0] = 0.5; units.team[0] = 0; units.half[0] = 3; // half=3 spills past (0,0)
  let threw = false;
  try { update(mm, units, view, 0, cam, flat); } catch (e) { threw = true; }
  ok('drawSquare at the edge with a large half does not throw', !threw);
  const oppositeCorner = ((5) * 6 + 5) * 4;
  ok('the square does not wrap to the opposite corner', !(mm.rgba[oppositeCorner] === 255 && mm.rgba[oppositeCorner + 1] === 255 && mm.rgba[oppositeCorner + 2] === 255));
}

// ---------------------------------------------------------------------------
// AC2: camera footprint corners match worldToMinimap(rayTerrain hit) within
// 1 px, on a slope fixture.
// ---------------------------------------------------------------------------
{
  const slope = {
    heightAt: (x, y) => 0.1 * x,
    normalAt: (x, y, out) => { out.x = -0.1; out.y = 0; out.z = 1; },
    typeAt: () => 0,
    groundAt: (x, y) => 0.1 * x,
  };
  const mm = createMinimap({ width: 128, height: 128, x0: -200, y0: -200, x1: 200, y1: 200, teamRgb: new Uint8Array(24), footprintRgb: [255, 255, 0] });
  const typeRgb = new Uint8Array([80, 120, 60]);
  bakeTerrain(mm, slope, typeRgb, { hMin: -20, hMax: 20 });
  const view = new Visibility({ x0: -200, y0: -200, w: 128, h: 128, cell: (400 / 128), teams: 1, maxSources: 4, maxRadiusCells: 4 });
  view.revealAll(0);
  bindFog(mm, view);

  const cam = createPitchedTerms();
  pitchedTerms({ x: 10, y: 0, z: 40, yawDeg: 0, pitchDeg: -55 }, { cols: 32, rows: 24 }, cam);
  update(mm, makeUnits(0), view, 0, cam, slope);

  const ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
  const hit = { x: 0, y: 0, z: 0, t: 0, hit: false };
  const corners = [[-0.5, 0], [cam.cols - 0.5, 0], [cam.cols - 0.5, cam.rows], [-0.5, cam.rows]];
  let maxErr = 0;
  for (let k = 0; k < 4; k++) {
    screenRay(cam, corners[k][0], corners[k][1], ray);
    rayTerrain(slope, ray, hit);
    ok(`footprint corner ${k}: ray hits the slope`, hit.hit, `dz=${ray.dz}`);
    const expPx = worldToMinimap(mm, hit.x, hit.y, [0, 0]);
    const gotPxX = mm._cornerPx[k * 2], gotPxY = mm._cornerPx[k * 2 + 1];
    const err = Math.max(Math.abs(gotPxX - expPx[0]), Math.abs(gotPxY - expPx[1]));
    maxErr = Math.max(maxErr, err);
  }
  ok('AC2: footprint corners match worldToMinimap(rayTerrain hit) within 1 px', maxErr <= 1, `maxErr=${maxErr}`);
}

// ---------------------------------------------------------------------------
// AC1: update() <= 0.5 ms at 256^2 with 200 units and the fog rebuilt each
// call (warn-only, per this repo's perf-budget convention).
// ---------------------------------------------------------------------------
{
  const mm = createMinimap({ width: 256, height: 256, x0: -500, y0: -500, x1: 500, y1: 500, teamRgb: new Uint8Array(24) });
  const typeRgb = new Uint8Array([100, 120, 90, 60, 90, 140]);
  const flat = {
    heightAt: () => 0,
    normalAt: (x, y, out) => { out.x = 0; out.y = 0; out.z = 1; },
    typeAt: (x, y) => (x + y) & 1,
    groundAt: () => 0,
  };
  bakeTerrain(mm, flat, typeRgb, { hMin: 0, hMax: 1 });
  const view = new Visibility({ x0: -500, y0: -500, w: 256, h: 256, cell: (1000 / 256), teams: 2, maxSources: 256, maxRadiusCells: 8 });
  view.revealAll(0);
  bindFog(mm, view);
  const cam = createPitchedTerms();
  pitchedTerms({ x: 0, y: 0, z: 80, yawDeg: 0, pitchDeg: -70 }, { cols: 64, rows: 48 }, cam);

  const units = makeUnits(200);
  units.count = 200;
  for (let i = 0; i < 200; i++) {
    units.x[i] = -400 + (i * 4); units.y[i] = -300 + (i * 3);
    units.team[i] = i & 1; units.half[i] = (i % 3) === 0 ? 2 : 0;
  }

  // Warm-up, then time enough iterations to reject noise. Bump view.version
  // every call so the fog LUT is rebuilt every time (worst case).
  let srcId = 1000;
  for (let i = 0; i < 5; i++) { view.setSource(srcId++, 1, i, i, 0.4); update(mm, units, view, 0, cam, flat); }
  const N = 30;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    view.setSource(srcId++, 1, i, -i, 0.4); // forces version[0] to bump every call
    update(mm, units, view, 0, cam, flat);
  }
  const t1 = process.hrtime.bigint();
  const msPerCall = Number(t1 - t0) / 1e6 / N;
  if (msPerCall > 0.5) {
    console.warn(`WARN: minimap update() ${msPerCall.toFixed(3)} ms > 0.5 ms budget (256^2, 200 units, fog rebuilt) - not failing the suite (perf-budget convention)`);
  }
  ok('AC1: update() perf measured (warn-only budget check ran)', true, `${msPerCall.toFixed(3)} ms/call`);
}

// ---------------------------------------------------------------------------
// Zero allocation: update() (fog already stable - no version bump) does not
// grow the heap over many calls.
// ---------------------------------------------------------------------------
{
  const mm = createMinimap({ width: 256, height: 256, x0: -500, y0: -500, x1: 500, y1: 500, teamRgb: new Uint8Array(24) });
  const typeRgb = new Uint8Array([100, 120, 90]);
  const flat = { heightAt: () => 0, normalAt: (x, y, out) => { out.x = 0; out.y = 0; out.z = 1; }, typeAt: () => 0, groundAt: () => 0 };
  bakeTerrain(mm, flat, typeRgb, { hMin: 0, hMax: 1 });
  const view = new Visibility({ x0: -500, y0: -500, w: 256, h: 256, cell: (1000 / 256), teams: 1, maxSources: 64, maxRadiusCells: 8 });
  view.revealAll(0);
  bindFog(mm, view);
  const cam = createPitchedTerms();
  pitchedTerms({ x: 0, y: 0, z: 80, yawDeg: 0, pitchDeg: -70 }, { cols: 64, rows: 48 }, cam);
  const units = makeUnits(200);
  units.count = 200;
  for (let i = 0; i < 200; i++) { units.x[i] = i - 100; units.y[i] = -i + 100; units.team[i] = 0; units.half[i] = 1; }

  for (let i = 0; i < 20; i++) update(mm, units, view, 0, cam, flat); // warm up (JIT)
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 2000; i++) update(mm, units, view, 0, cam, flat);
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('zero alloc: 2000 update() calls (stable fog) do not grow the heap materially', grew < 2_000_000, `heap grew ${grew} bytes`);
}

// ---------------------------------------------------------------------------
// 28.4 pseudocode: mm.bakeTerrain/mm.bindFog/mm.update work as bound methods
// (so game code can drive a minimap through the instance alone).
// ---------------------------------------------------------------------------
{
  const mm = createMinimap({ width: 4, height: 4, x0: 0, y0: 0, x1: 4, y1: 4, teamRgb: new Uint8Array(24) });
  const typeRgb = new Uint8Array([50, 60, 70]);
  const flat = { heightAt: () => 0, normalAt: (x, y, out) => { out.x = 0; out.y = 0; out.z = 1; }, typeAt: () => 0, groundAt: () => 0 };
  mm.bakeTerrain(flat, typeRgb, { hMin: 0, hMax: 1 });
  const view = new Visibility({ x0: 0, y0: 0, w: 4, h: 4, cell: 1, teams: 1, maxSources: 4, maxRadiusCells: 4 });
  view.revealAll(0);
  mm.bindFog(view);
  const cam = createPitchedTerms();
  pitchedTerms({ x: 2, y: 2, z: 20, yawDeg: 0, pitchDeg: -80 }, { cols: 16, rows: 16 }, cam);
  let threw = false;
  try { mm.update(makeUnits(0), view, 0, cam, flat); } catch (e) { threw = true; }
  ok('mm.bakeTerrain/mm.bindFog/mm.update work as bound instance methods', !threw && mm.rgba[3] === 255);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
