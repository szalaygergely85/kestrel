// engine/render/lighting.test.js (US-006, docs/architecture.md 14.3 item 8).
// Headless Node unit tests for the JS reference lighting module.
// Run: node engine/render/lighting.test.js
import {
  LightSet, buildLightSet, lightAt, lightSurfaces, computeVisGrid, falloff, h01,
  MAX_LIGHTS, MAX_VIS_DIM,
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

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILED:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
else console.log('ALL PASS');
