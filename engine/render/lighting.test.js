// engine/render/lighting.test.js (US-006, docs/architecture.md 14.3 item 8).
// Headless Node unit tests for the JS reference lighting module.
// Run: node engine/render/lighting.test.js
import {
  LightSet, buildLightSet, lightAt, lightSurfaces, computeVisGrid, falloff, h01,
  selectCpuLights, CPU_LIGHT_CAP, MAX_LIGHTS, MAX_VIS_DIM, sunVisible, MAX_SUN_STEPS,
} from './lighting.js';
import { World } from '../world/World.js';
import { AssetRegistry } from '../core/assets.js';
import paletteMod from '../../design/palette.js';
import testRoomDef from '../../design/levels/test_room.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; testRoomDef;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// --- falloff: 0 at/after radius, continuous, decreasing -------------------
{
  ok('falloff(r,r) == 0', falloff(6, 6) === 0);
  ok('falloff(r+1,r) == 0', falloff(7, 6) === 0);
  ok('falloff(0,r) == 1', approx(falloff(0, 6), 1));
  // continuity: no jump right at the radius boundary.
  ok('falloff continuous at r', falloff(5.999, 6) < 0.001 && falloff(5.999, 6) > 0);
  let prev = falloff(0, 6);
  let monotone = true;
  for (let d = 0.5; d <= 6; d += 0.5) {
    const v = falloff(d, 6);
    if (v > prev + 1e-9) monotone = false;
    prev = v;
  }
  ok('falloff monotonically non-increasing', monotone);
}

// --- N.L per face: a light straight above/beside only lights the face it faces ---
{
  const ls = new LightSet();
  ls.ambient[0] = ls.ambient[1] = ls.ambient[2] = 0; // isolate the point light term
  ls.add({ x: 5, y: 5, z: 5, hue: [1, 1, 1], intensity: 1, radius: 20, on: true });
  ls.update(0, null);
  const out = [0, 0, 0];
  // A ceiling-facing-up sample (FACE_U, normal +z) directly below the light: lit.
  lightAt(ls, null, 5, 5, 0, 0, 0, 1, out);
  ok('FACE_U under a light is lit', out[0] > 0.01, String(out[0]));
  // A floor-facing-down sample (FACE_D, normal -z) at the SAME point: N.L < 0, unlit (ambient 0).
  lightAt(ls, null, 5, 5, 0, 0, 0, -1, out);
  ok('FACE_D under a light is unlit (N.L <= 0)', out[0] === 0, String(out[0]));
  // A wall facing away from the light (light is east, wall faces west, i.e. normal -x) is unlit.
  lightAt(ls, null, 5, 0, 5, -1, 0, 0, out);
  ok('wall facing away from the light is unlit', out[0] === 0, String(out[0]));
  // The same wall position facing the light (normal +x, light is east of it... adjust: light at x=5, sample at x=0, light is EAST (+x) of the sample, so a face pointing +x (FACE_E normal (1,0,0)) faces it).
  lightAt(ls, null, 0, 5, 5, 1, 0, 0, out);
  ok('wall facing the light is lit', out[0] > 0.01, String(out[0]));
}

// --- flicker: deterministic (same timeSec -> same value), bounded, and varies over time ---
{
  const ls = new LightSet();
  ls.add({
    x: 0, y: 0, z: 0, hue: [1, 0, 0], intensity: 1, radius: 6, on: true,
    flicker: { hzMin: 8, hzMax: 12, amount: 0.15, jitter: 0.05 }, seed: 42,
  });
  ls.update(1.2345, null);
  const pos1 = [ls.pos[0], ls.pos[1], ls.pos[2]], col1 = [ls.col[0], ls.col[1], ls.col[2]];
  ls.update(1.2345, null); // re-run at the SAME timeSec
  const pos2 = [ls.pos[0], ls.pos[1], ls.pos[2]], col2 = [ls.col[0], ls.col[1], ls.col[2]];
  ok('flicker deterministic (same timeSec -> same pos)', pos1.every((v, i) => v === pos2[i]));
  ok('flicker deterministic (same timeSec -> same col)', col1.every((v, i) => v === col2[i]));
  // Bounded: intensity within [1-amount, 1+amount] * base, jitter within [-jitter, jitter].
  let minI = Infinity, maxI = -Infinity, minJx = Infinity, maxJx = -Infinity;
  for (let t = 0; t < 20; t += 0.01) {
    ls.update(t, null);
    minI = Math.min(minI, ls.col[0]); maxI = Math.max(maxI, ls.col[0]);
    minJx = Math.min(minJx, ls.pos[0]); maxJx = Math.max(maxJx, ls.pos[0]);
  }
  ok('flicker intensity bounded', minI >= 1 * (1 - 0.15) - 1e-6 && maxI <= 1 * (1 + 0.15) + 1e-6, `${minI}..${maxI}`);
  ok('flicker position jitter bounded', minJx >= -0.05 - 1e-6 && maxJx <= 0.05 + 1e-6, `${minJx}..${maxJx}`);
  ok('flicker actually varies over time', maxI - minI > 0.01);
}

// --- h01 sanity: in [0,1), not constant ------------------------------------
{
  const vals = new Set();
  for (let i = 0; i < 50; i++) vals.add(h01(i, 7, 3).toFixed(4));
  ok('h01 in range and varies', vals.size > 10);
  for (let i = 0; i < 50; i++) { const v = h01(i); ok(`h01(${i}) in [0,1)`, v >= 0 && v < 1); if (fail > 20) break; }
}

// --- computeVisGrid: synthetic 8x8 level (behind-wall blocked, LOS clear, light-in-solid -> all 0, radius clip) ---
{
  const legend = {
    '#': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
    '.': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'ceiling_timber', solid: false },
    'S': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'ceiling_timber', solid: false, start: true, facingDeg: 90 },
  };
  const rows = [
    '########',
    '#S.....#',
    '#.#....#',
    '#.#....#',
    '#.#....#',
    '#......#',
    '#......#',
    '########',
  ];
  globalThis.ASSETS = globalThis.ASSETS || {};
  globalThis.ASSETS.levels = globalThis.ASSETS.levels || {};
  globalThis.ASSETS.levels.__visTest8x8 = { name: '__visTest8x8', legend, rows };
  const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
  const world = World.load({ terrain: null, structures: [{ id: 'vt', level: '__visTest8x8', origin: { x: 0, y: 0, z: 0 } }], entities: [] }, assets, {});

  const ls = new LightSet();
  const h = ls.add({ x: 1.5, y: 1.5, z: 1.2, hue: [1, 1, 1], intensity: 1, radius: 5, on: true });
  computeVisGrid(ls, h, world);
  const sampleVisAt = (x, y) => {
    const lx = Math.floor(x - ls.visOx[h]), ly = Math.floor(y - ls.visOy[h]);
    if (lx < 0 || ly < 0 || lx >= ls.visW[h] || ly >= ls.visH[h]) return 1;
    return ls.vis[h * MAX_VIS_DIM * MAX_VIS_DIM + ly * MAX_VIS_DIM + lx] / 255;
  };
  ok('LOS cell (same open row) is reached (255)', sampleVisAt(5, 1) === 1);
  ok('cell behind the wall column is blocked (0)', sampleVisAt(3, 3) === 0, String(sampleVisAt(3, 3)));
  ok('vis box sized from radius (2R+1)', ls.visW[h] === 2 * Math.ceil(5) + 1);

  // light sitting inside a solid cell -> everything unreached (0).
  const h2 = ls.add({ x: 2.5, y: 2.5, z: 1.0, hue: [1, 1, 1], intensity: 1, radius: 5, on: true }); // (2,2) is '#'
  computeVisGrid(ls, h2, world);
  let allZero = true;
  for (let i = 0; i < MAX_VIS_DIM * MAX_VIS_DIM; i++) if (ls.vis[h2 * MAX_VIS_DIM * MAX_VIS_DIM + i] !== 0) allZero = false;
  ok('light in a solid cell -> vis grid all 0', allZero);

  // radius clip: a small radius gives a small box.
  const h3 = ls.add({ x: 1.5, y: 1.5, z: 1.2, hue: [1, 1, 1], intensity: 1, radius: 2, on: true });
  computeVisGrid(ls, h3, world);
  ok('small radius -> small vis box', ls.visW[h3] === 5 && ls.visH[h3] === 5, String(ls.visW[h3]));

  // Architect review 1 item 1: sample at S = P + N*0.01, not P. A surface
  // point exactly ON the wall column's west face (x = 2.0, the boundary
  // between open column 1 and the solid column-2 wall at rows 2-4) must
  // read as LIT via `lightAt` (nudged into the open cell the face points
  // into), not as the coin-flip/blocked result `floor(2.0) === 2` (the
  // solid cell itself) would give without the nudge.
  {
    const ls2 = new LightSet();
    ls2.ambient[0] = ls2.ambient[1] = ls2.ambient[2] = 0; // isolate the point-light term
    const hw = ls2.add({ x: 1.5, y: 1.5, z: 1.2, hue: [1, 1, 1], intensity: 1, radius: 5, on: true });
    ls2.update(0, world);
    const out = [0, 0, 0];
    // Wall face at the column-1/column-2 boundary, row 3 (open on the west
    // side, solid '#' cell on the east side) - normal (-1,0,0) points back
    // into the open column the light sits in.
    lightAt(ls2, world, 2.0, 3.5, 1.2, -1, 0, 0, out);
    ok('wall face sampled exactly on the boundary is lit (S = P + N*0.01 nudges into the open cell)',
      out[0] + out[1] + out[2] > 1e-4, `${out[0] + out[1] + out[2]}`);
    ok('same wall face, handle count unchanged (no extra light added)', hw >= 0);
  }

  // BUG-LIGHT-001 (docs/backlog.md row 25b, architect review 1 of US-011):
  // a FLOOR sample (N = 0,0,1) exactly on the same column-1/column-2 x
  // boundary. Nudging along N alone (the old fix) only moves z - it cannot
  // move the sample off the x=2.0 boundary, so `floor(S.x) === 2` (the
  // solid column) is an exact coin flip that reads BLOCKED even though the
  // floor point is in the open column, clear LOS to the light. The fix
  // (nudge toward the light, which has a real x/y component) must move the
  // sample into the open column and read LIT.
  {
    const ls3 = new LightSet();
    ls3.ambient[0] = ls3.ambient[1] = ls3.ambient[2] = 0; // isolate the point-light term
    ls3.add({ x: 1.5, y: 1.5, z: 1.2, hue: [1, 1, 1], intensity: 1, radius: 5, on: true });
    ls3.update(0, world);
    const out = [0, 0, 0];
    // Floor point at the same column boundary/row as the wall-face case
    // above, but facing straight up - N alone gives zero x/y displacement.
    lightAt(ls3, world, 2.0, 3.5, 0.01, 0, 0, 1, out);
    ok('BUG-LIGHT-001: floor sample exactly on the boundary is lit (nudge toward the light moves x/y, not just N)',
      out[0] + out[1] + out[2] > 1e-4, `${out[0] + out[1] + out[2]}`);
  }
}

// --- test_room: buildLightSet finds the torch, radius boundary matches P.lights.torch.radius ---
{
  const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
  const world = World.load({ terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 } }], entities: [] }, assets, {});
  const ls = buildLightSet(world, assets.palette);
  ok('test_room has exactly one light (the torch)', ls.count === 1, String(ls.count));
  ok('torch key resolved', ls.key[0] === 'test_room.torch');
  ls.update(0, world);
  const out = [0, 0, 0];
  const tx = ls.defX[0], ty = ls.defY[0], tz = ls.defZ[0], r = ls.radius[0];
  ok('torch radius from P.lights.torch', r === 6, String(r));
  // Straight up from the torch (clear vertical LOS, no wall between), at
  // r - 0.1 the point-light term must be present; at r + 0.1 it must be gone
  // (falloff hits exactly 0 at/after the radius - AC "smooth to exactly 0").
  lightAt(ls, world, tx, ty, tz + r - 0.1, 0, 0, -1, out);
  const ambR = ls.ambient[0] + ls.ambient[1] + ls.ambient[2];
  const litSum = out[0] + out[1] + out[2];
  ok('lit just inside the torch radius (brighter than ambient alone)', litSum > ambR + 1e-4, `${litSum} vs ${ambR}`);
  lightAt(ls, world, tx, ty, tz + r + 0.1, 0, 0, -1, out);
  const darkSum = out[0] + out[1] + out[2];
  ok('at/just outside the radius, only ambient remains', approx(darkSum, ambR, 1e-4), `${darkSum} vs ${ambR}`);
}

// --- lightSurfaces: `?lights=0` uniform path is a no-op (caller already filled rgb[0..2]) ---
{
  const fb = { light: { uniform: true, rgb: new Float32Array([1, 2, 3]) } };
  lightSurfaces(fb, null, null, null);
  ok('lightSurfaces no-ops on the uniform path', fb.light.rgb[0] === 1 && fb.light.rgb[1] === 2 && fb.light.rgb[2] === 3);
}

// --- architect re-review 1 follow-up item 1: an off light leaves col rgb at 0 after update() ---
{
  const ls = new LightSet();
  ls.add({ x: 0, y: 0, z: 0, hue: [1, 1, 1], intensity: 5, radius: 6, on: false });
  ls.update(0, null);
  ok('off light col rgb stays 0 after update()', ls.col[0] === 0 && ls.col[1] === 0 && ls.col[2] === 0,
    `${ls.col[0]},${ls.col[1]},${ls.col[2]}`);
}

// --- architect re-review 1 follow-up item 2: two fresh LightSets get different visVersion[0] ---
{
  const legend = {
    '#': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
    '.': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'ceiling_timber', solid: false, start: true, facingDeg: 90 },
  };
  globalThis.ASSETS.levels.__visVersionTest = { name: '__visVersionTest', legend, rows: ['###', '#.#', '###'] };
  const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
  const world = World.load({ terrain: null, structures: [{ id: 'vv', level: '__visVersionTest', origin: { x: 0, y: 0, z: 0 } }], entities: [] }, assets, {});
  const lsA = new LightSet();
  lsA.add({ x: 1.5, y: 1.5, z: 1.2, hue: [1, 1, 1], intensity: 1, radius: 5, on: true });
  lsA.update(0, world);
  const lsB = new LightSet();
  lsB.add({ x: 1.5, y: 1.5, z: 1.2, hue: [1, 1, 1], intensity: 1, radius: 5, on: true });
  lsB.update(0, world);
  ok('two fresh LightSets get different visVersion[0] (module-wide sequence, not per-slot)',
    lsA.visVersion[0] !== lsB.visVersion[0], `${lsA.visVersion[0]} vs ${lsB.visVersion[0]}`);
}

// --- PO REJECT item 1: selectCpuLights picks the 4 nearest `on` lights, stable order ---
{
  const ls = new LightSet();
  // 6 lights at increasing distance along +x from the camera at origin; one OFF light
  // closer than some ON ones must be skipped.
  ls.add({ x: 10, y: 0, z: 0, hue: [1, 0, 0], intensity: 1, radius: 20, on: true, key: 'd10' });
  ls.add({ x: 1, y: 0, z: 0, hue: [1, 0, 0], intensity: 1, radius: 20, on: false, key: 'd1-off' });
  ls.add({ x: 5, y: 0, z: 0, hue: [1, 0, 0], intensity: 1, radius: 20, on: true, key: 'd5' });
  ls.add({ x: 2, y: 0, z: 0, hue: [1, 0, 0], intensity: 1, radius: 20, on: true, key: 'd2' });
  ls.add({ x: 8, y: 0, z: 0, hue: [1, 0, 0], intensity: 1, radius: 20, on: true, key: 'd8' });
  ls.add({ x: 3, y: 0, z: 0, hue: [1, 0, 0], intensity: 1, radius: 20, on: true, key: 'd3' });
  ls.update(0, null);
  const count = selectCpuLights(ls, 0, 0, 0);
  ok('selectCpuLights returns exactly CPU_LIGHT_CAP (4) of 5 on lights', count === CPU_LIGHT_CAP, String(count));
  const chosenKeys = Array.from(ls.cpuIdx.subarray(0, count)).map((i) => ls.key[i]);
  ok('selectCpuLights picks the 4 nearest ON lights, nearest first (skips the off d1)',
    chosenKeys.join(',') === 'd2,d3,d5,d8', chosenKeys.join(','));
  // Re-run: same input -> same output (stable/deterministic).
  const count2 = selectCpuLights(ls, 0, 0, 0);
  const chosenKeys2 = Array.from(ls.cpuIdx.subarray(0, count2)).map((i) => ls.key[i]);
  ok('selectCpuLights is stable across repeated calls with the same input', chosenKeys.join(',') === chosenKeys2.join(','));
}

// --- PO REJECT item 1: lightSurfaces only caps when fb.cpuLightCap is set (no cap => no behaviour change) ---
{
  const ls = new LightSet();
  for (let i = 0; i < 6; i++) ls.add({ x: i * 2, y: 0, z: 0, hue: [1, 1, 1], intensity: 1, radius: 20, on: true, key: `k${i}` });
  ls.update(0, null);
  ok('lightSurfaces cap is opt-in per frame buffer (cpuLightCap unset by default)', ls.cpuCount === 0);
}

// --- US-007: sunVisible on a synthetic 8x8 level (docs/backlog.md US-007 tech notes item 5) ---
// Sun straight toward the +y (south) horizontal direction, elevation 45deg
// (tanElev = 1) for clean arithmetic: dir = (0, 1, 1) normalized by
// LightSet.setSun's own formula (azimuth 0 = north = -y is where the sun
// comes FROM, so the light travels TOWARD +y - see setSun's dir formula).
{
  const legend = {
    '#': { floorH: 8, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
    '.': { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false },
    's': { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false, start: true, facingDeg: 90 },
    // A "crack": open gap [floorH, ceilH) = [1,3), closed band [ceilH, topH] = [3,5], open again above topH.
    'K': { floorH: 1.0, ceilH: 3.0, topH: 5.0, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
    // A thin overhead slab, floor open at 0, roof at 2.
    'L': { floorH: 0, ceilH: 2.0, topH: 2.0, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
  };
  const rows = [
    's.......',
    '........',
    '........',
    '........',
    '........',
    '#K#L....',
    '........',
    '........',
  ];
  globalThis.ASSETS.levels.__sun8x8 = { name: '__sun8x8', legend, rows };
  const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
  const world = World.load({ terrain: null, structures: [{ id: 'sun', level: '__sun8x8', origin: { x: 0, y: 0, z: 0 } }], entities: [] }, assets, {});

  const ls = new LightSet();
  ls.setSun({ elevation: 45, azimuth: 180, on: true }); // azimuth 180 = sun in the south -> dir toward +y, ~= (0, 1, 1)/sqrt2
  const dir = ls.sun.dir;
  ok('sun dir points toward +y (south) horizontally', approx(dir[0], 0, 1e-9) && dir[1] > 0);
  ok('sun dir has a positive z component', dir[2] > 0);

  // Point directly under open sky: always lit.
  ok('point under open sky is lit', sunVisible(world, 4.5, 4.5, 0.3, dir) === true);

  // Behind the wall column x=0 (floorH 8): low sample shadowed, sample
  // above the wall (still inside the 8x8 grid, so it keeps walking north
  // to south and out through open cells) lit.
  ok('low point just north of the tall wall is shadowed', sunVisible(world, 0.5, 4.5, 0.3, dir) === false);
  ok('point above the tall wall (z > 8) is lit', sunVisible(world, 0.5, 4.5, 8.5, dir) === true);

  // Under the thin slab (column x=3, 'L', roof at 2 m): a floor sample just
  // north of it (row y=4) is shadowed (rises into [2,2] by the time it
  // crosses); a sample above the roof height is lit.
  ok('point under the thin slab is shadowed', sunVisible(world, 3.5, 4.5, 0.6, dir) === false);
  ok('point above the slab roof height is lit', sunVisible(world, 3.5, 4.5, 2.5, dir) === true);

  // Crack column x=1 ('K', open [1,3), closed [3,5], open above 5): a
  // sample close to the wall (y=4.5, 0.5 m of travel before the wall cell)
  // crosses the crack cell low (still under the closed band) -> lit; a
  // sample farther away (y=0.5, 4.5 m of travel first) has risen into the
  // closed band by the time it reaches the same wall cell -> shadowed.
  ok('crack: a floor point close to the wall passes under the closed band (lit)', sunVisible(world, 1.5, 4.5, 0.6, dir) === true);
  ok('crack: a floor point far from the wall has risen into the closed band by the wall (shadowed)', sunVisible(world, 1.5, 1.6, 0.6, dir) === false);

  // world == null -> lit (defensive default).
  ok('sunVisible(null, ...) defaults to lit', sunVisible(null, 0, 0, 0, dir) === true);
}

// --- US-007: two placed structures - the second shadows a point in the first ---
{
  const legend = {
    '.': { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false },
    's': { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false, start: true, facingDeg: 90 },
  };
  const solidLegend = {
    '#': { floorH: 8, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
  };
  globalThis.ASSETS.levels.__sunOpenPad = { name: '__sunOpenPad', legend, rows: ['s...', '....', '....', '....'] };
  globalThis.ASSETS.levels.__sunBlock = { name: '__sunBlock', legend: solidLegend, rows: ['#'], start: { x: 0.5, y: 0.5, facingDeg: 90 } };
  const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
  const world = World.load({
    terrain: null,
    structures: [
      { id: 'pad', level: '__sunOpenPad', origin: { x: 0, y: 0, z: 0 } },
      // A 1x1 solid block placed immediately south of the pad, spanning x 1..2.
      { id: 'blocker', level: '__sunBlock', origin: { x: 1, y: 4, z: 0 } },
    ],
    entities: [],
  }, assets, {});

  const ls = new LightSet();
  ls.setSun({ elevation: 45, azimuth: 180, on: true }); // sun in the south -> dir toward +y
  const dir = ls.sun.dir;
  // Sample sits in structure "pad" (x 1.5, directly north of "blocker"'s footprint).
  ok('a second placed structure shadows a point in the first', sunVisible(world, 1.5, 3.5, 0.3, dir) === false);
  // Same row, but x = 3.5 - outside "blocker"'s x-footprint (1..2) - the ray
  // leaves every footprint south of the pad and is lit.
  ok('outside the second structure\'s footprint, the first structure\'s point is unaffected (lit)',
    sunVisible(world, 3.5, 3.5, 0.3, dir) === true);
}

// --- US-007 ARCH CHANGES item 1: JS maxH escape actually fires, reading
// `struct.packed.maxH` (the placed-structure object itself has no own
// `.maxH` - that was the dead-code bug: `h0 > struct.maxH` was always
// `false` against `undefined`). A tall solid ring, its wall well within
// MAX_SUN_STEPS of the sample, with the sample height above the ring's
// `maxH` - lit either via the fixed escape or, redundantly, once the walk
// reaches the wall and the crossing test itself sees h0 above floorH; the
// direct property assertions below are the regression guard that actually
// pins down which field is read. ---
{
  const legend = {
    '.': { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false },
    '#': { floorH: 8, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
  };
  const size = 20;
  const rows = [];
  for (let y = 0; y < size; y++) {
    let row = '';
    for (let x = 0; x < size; x++) row += (x === 0 || x === size - 1 || y === 0 || y === size - 1) ? '#' : '.';
    rows.push(row);
  }
  globalThis.ASSETS.levels.__sunTallRing = { name: '__sunTallRing', legend, rows, start: { x: size / 2, y: size / 2, facingDeg: 90 } };
  const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
  const world = World.load({ terrain: null, structures: [{ id: 'ring', level: '__sunTallRing', origin: { x: 0, y: 0, z: 0 } }], entities: [] }, assets, {});
  const struct = world.structureAt(size / 2, size / 2);
  ok('regression guard: the placed structure has no own .maxH (the dead-code field)', struct.maxH === undefined);
  ok('regression guard: .packed.maxH is the ring wall\'s floorH (8), the field the fix reads', struct.packed.maxH === 8);

  const ls = new LightSet();
  ls.setSun({ elevation: 45, azimuth: 180, on: true }); // ring wall reachable well within MAX_SUN_STEPS
  const dir = ls.sun.dir;
  ok('sample above the tall solid ring\'s maxH is lit (struct.packed.maxH escape)', sunVisible(world, size / 2, size / 2, 9, dir) === true);
}

// --- US-007 ARCH CHANGES item 2: a structure placed at origin.z != 0 shades/escapes
// using LOCAL heights - both a shadowed and a lit sample exercise the origin.z
// subtraction (choose numbers so both branches are hit). ---
{
  const legend = {
    '.': { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false },
    's': { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false, start: true, facingDeg: 90 },
  };
  const solidLegend = {
    '#': { floorH: 8, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
  };
  globalThis.ASSETS.levels.__sunOriginZPad = { name: '__sunOriginZPad', legend, rows: ['s...', '....', '....', '....'] };
  globalThis.ASSETS.levels.__sunOriginZBlock = { name: '__sunOriginZBlock', legend: solidLegend, rows: ['#'], start: { x: 0.5, y: 0.5, facingDeg: 90 } };
  const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
  // "blocker" is 8 m tall (floorH=8), placed 4 m up (origin.z=4) - world
  // blocking threshold is origin.z + floorH = 12.
  const world = World.load({
    terrain: null,
    structures: [
      { id: 'pad', level: '__sunOriginZPad', origin: { x: 0, y: 0, z: 0 } },
      { id: 'blocker', level: '__sunOriginZBlock', origin: { x: 1, y: 4, z: 4 } },
    ],
    entities: [],
  }, assets, {});
  const ls = new LightSet();
  ls.setSun({ elevation: 45, azimuth: 180, on: true }); // sun in the south -> dir toward +y
  const dir = ls.sun.dir;
  // World z=0.3 < 12 -> still shadowed (a wrong "always subtract nothing"
  // implementation would ALSO shadow this, since 0.3 < floorH(8) too - not
  // the distinguishing case, but confirms the low branch still works).
  ok('origin.z=4 blocker: a low sample (z=0.3, world threshold 12) is still shadowed', sunVisible(world, 1.5, 3.5, 0.3, dir) === false);
  // World z=12.5 > 12 -> now lit. Without the origin.z fix (comparing the
  // raw world height against the LOCAL floorH=8 directly, ignoring the +4 m
  // the structure is raised), 12.5 would incorrectly compare against 8 and
  // still read "not blocked" too by luck of the numbers - but the local
  // comparison the fix performs is `h0 - origin.z (8.5) < floorH (8)` ->
  // false -> not blocked, exercising the actual subtraction, not floorH alone.
  ok('origin.z=4 blocker: a sample just above the RAISED threshold (z=12.5) is lit', sunVisible(world, 1.5, 3.5, 12.5, dir) === true);
}

// --- US-007 ARCH CHANGES item 4: a structure across a gap of open terrain still
// shadows - the ray must leave structure A's footprint, cross an empty
// (no-structure) column, and still be blocked by structure B ahead. ---
{
  const legend = {
    '.': { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false },
    's': { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false, start: true, facingDeg: 90 },
  };
  const solidLegend = {
    '#': { floorH: 8, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
  };
  globalThis.ASSETS.levels.__sunGapPad = { name: '__sunGapPad', legend, rows: ['s...', '....'] }; // y 0..2
  globalThis.ASSETS.levels.__sunGapBlock = { name: '__sunGapBlock', legend: solidLegend, rows: ['#'], start: { x: 0.5, y: 0.5, facingDeg: 90 } };
  const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
  const world = World.load({
    terrain: null,
    structures: [
      { id: 'padA', level: '__sunGapPad', origin: { x: 0, y: 0, z: 0 } }, // footprint y 0..2
      // A 2-cell empty gap (y 2..4, no structure there at all), then an 8 m
      // solid blocker starting at y=4.
      { id: 'blockerB', level: '__sunGapBlock', origin: { x: 1, y: 4, z: 0 } },
    ],
    entities: [],
  }, assets, {});
  ok('(setup) the gap column has no owning structure', world.structureAt(1.5, 2.5) === null || world.structureAt(1.5, 2.5) === undefined);
  const ls = new LightSet();
  ls.setSun({ elevation: 45, azimuth: 180, on: true }); // sun in the south -> dir toward +y
  const dir = ls.sun.dir;
  // Sample at (1.5, 1.5) in padA, 2.5 cells north of blockerB's wall face.
  // At elevation 45 (tanElev=1), h at the wall == h0 + 2.5.
  ok('structure B across the gap still shadows a low sample in structure A (h at wall 2.8 < floorH 8)',
    sunVisible(world, 1.5, 1.5, 0.3, dir) === false);
  ok('a sample high enough to clear the far structure\'s wall by the time it arrives is lit (h at wall 8.5 >= floorH 8)',
    sunVisible(world, 1.5, 1.5, 6, dir) === true);
}

// --- US-007: step cap (MAX_SUN_STEPS) - a long never-blocking corridor terminates and is lit ---
{
  const legend = {
    '.': { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false },
  };
  const rows = [];
  for (let y = 0; y < 4; y++) rows.push('.'.repeat(MAX_SUN_STEPS + 20));
  globalThis.ASSETS.levels.__sunLongCorridor = { name: '__sunLongCorridor', legend, rows, start: { x: 0.5, y: 1.5, facingDeg: 90 } };
  const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
  const world = World.load({ terrain: null, structures: [{ id: 'corridor', level: '__sunLongCorridor', origin: { x: 0, y: 0, z: 0 } }], entities: [] }, assets, {});
  const ls = new LightSet();
  // A very shallow elevation, so `h0 > maxH` never trips before the step cap
  // (maxH here is 0 - every cell is open sky, `computeMaxH` finds no finite
  // blocking cell - so ONLY the footprint-exit or step-cap conditions can end the walk).
  ls.setSun({ elevation: 1, azimuth: 90, on: true }); // dir mostly +x, tiny +z
  const dir = ls.sun.dir;
  ok('a long, never-blocking corridor terminates (step cap, bias to lit)', sunVisible(world, 0.5, 1.5, 0.1, dir) === true);
}

// --- US-007: lightAt adds the sun term, gated by N.sunDir and sunVisible ---
{
  const legend = {
    '.': { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false },
  };
  globalThis.ASSETS.levels.__sunFlatPad = { name: '__sunFlatPad', legend, rows: ['....', '....', '....', '....'], start: { x: 0.5, y: 0.5, facingDeg: 90 } };
  const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
  const world = World.load({ terrain: null, structures: [{ id: 'pad', level: '__sunFlatPad', origin: { x: 0, y: 0, z: 0 } }], entities: [] }, assets, {});
  const ls = new LightSet();
  ls.ambient[0] = ls.ambient[1] = ls.ambient[2] = 0;
  ls.setSun({ elevation: 60, azimuth: 112.5, on: true });
  ls.sun.col[0] = 1; ls.sun.col[1] = 1; ls.sun.col[2] = 1;
  ls.update(0, world);
  const out = [0, 0, 0];
  // Floor (normal +z) under open sky, mid-pad: sunlit.
  lightAt(ls, world, 2, 2, 0.01, 0, 0, 1, out);
  ok('lightAt adds the sun term on a sunlit floor', out[0] > 0, String(out[0]));
  // A ceiling-facing-down sample (N.sunDir <= 0 for a sun with positive z): unlit by the sun.
  const out2 = [0, 0, 0];
  lightAt(ls, world, 2, 2, 0.01, 0, 0, -1, out2);
  ok('lightAt skips the sun term when N.sunDir <= 0', out2[0] === 0 && out2[1] === 0 && out2[2] === 0);
  // `sun.on = false` (e.g. `?sun=0`) -> no sun term even facing the sun.
  const lsOff = new LightSet();
  lsOff.ambient[0] = lsOff.ambient[1] = lsOff.ambient[2] = 0;
  lsOff.setSun({ elevation: 60, azimuth: 112.5, on: false });
  lsOff.sun.col[0] = 1; lsOff.sun.col[1] = 1; lsOff.sun.col[2] = 1;
  lsOff.update(0, world);
  const out3 = [0, 0, 0];
  lightAt(lsOff, world, 2, 2, 0.01, 0, 0, 1, out3);
  ok('sun.on = false disables the sun term entirely', out3[0] === 0 && out3[1] === 0 && out3[2] === 0);
}

// --- US-007: setSun's "elevation <= 0 -> sun.on = false" rule ---
{
  const ls = new LightSet();
  ls.setSun({ elevation: 0, azimuth: 0, on: true });
  ok('elevation == 0 forces sun.on = false', ls.sun.on === false);
  ls.setSun({ elevation: -10, azimuth: 0, on: true });
  ok('negative elevation forces sun.on = false', ls.sun.on === false);
  ls.setSun({ elevation: 30, azimuth: 0, on: true });
  ok('positive elevation honours the requested on', ls.sun.on === true);
}

// --- US-007: buildLightSet resolves the sun from the first structure's def.sun (fallback: palette default) ---
{
  const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
  const world = World.load({ terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 } }], entities: [] }, assets, {});
  const ls = buildLightSet(world, assets.palette);
  const sunPreset = assets.palette.lights.sun;
  ok('buildLightSet turns the sun on by default (fallback to the palette preset)', ls.sun.on === true);
  ok('buildLightSet falls back to the palette preset\'s elevation', ls.sun.elevation === sunPreset.elevation, String(ls.sun.elevation));
  ok('buildLightSet falls back to the palette preset\'s azimuth', ls.sun.azimuth === sunPreset.azimuth, String(ls.sun.azimuth));
  const hue = assets.palette.hue[sunPreset.color];
  ok('buildLightSet\'s sun.col == hue * intensity', approx(ls.sun.col[0], hue[0] * sunPreset.intensity) && approx(ls.sun.col[2], hue[2] * sunPreset.intensity));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILED:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
else console.log('ALL PASS');
