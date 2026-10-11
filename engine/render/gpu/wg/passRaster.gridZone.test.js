// MAP-12 (arch 38.43): the GPU near-band path follows ANY grid zone - type texture re-upload on a swap, band origin in the terrain
// uniforms, WGSL typeAt == JS oracle (terrain._nearGridType + far grid) at zones that are neither east nor west.
// Run: node engine/render/gpu/wg/passRaster.gridZone.test.js
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { WgRasterPass } from './passRaster.js';
import { TERRAIN_BLOCK, TERRAIN_RASTER_WGSL } from '../wgsl/terrainRaster.wgsl.js';
import { World } from '../../../world/World.js';
import paletteMod from '../../../../design/palette.js';
import detailPassMod from '../../../../design/detail-pass.js';
import terrainDef from '../../../../design/levels/overworld_far.js';
import lanternMod from '../../../../design/models/lantern.js';
import leverMod from '../../../../design/models/lever.js';
import voxelPropsMod from '../../../../design/models/voxel_props.js';
import boulderMod from '../../../../design/models/boulder.js';
import rubbleMod from '../../../../design/models/rubble.js';
import wreckageMod from '../../../../design/models/wreckage.js';
import relayMod from '../../../../design/models/relay.js';
import swordMod from '../../../../design/models/sword.js';
import m3PropsMod from '../../../../design/models/m3_props.js';
import farTowerMod from '../../../../design/models/far_tower.js';
import ferrumLightsMod from '../../../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod; m3PropsMod; farTowerMod; ferrumLightsMod;
const { assets } = await loadTestAssets();
const def0 = JSON.parse(JSON.stringify(assets.world('world_m1'))); delete def0.terrainBand; delete def0.terrainBands;
const GRID = { cx0: 0, cy0: 0, cx1: 32, cy1: 32, cw: 5, ch: 3, stepX: 2, stepY: 1, ox: 0, oy: 0 };
const mk = (spawn) => World.load({ ...def0, terrainGrid: GRID }, assets, { detail: true, spawn });

// WGSL type lookup evaluated as JS (same extraction as terrainRaster.wgsl.test.js)
function fnBody(name) {
  const m = TERRAIN_RASTER_WGSL.match(new RegExp(String.raw`fn ${name}\(([^)]*)\)\s*->[^{]+\{`));
  let level = 1, end = m.index + m[0].length;
  for (; level; end++) { if (TERRAIN_RASTER_WGSL[end] === '{') level++; if (TERRAIN_RASTER_WGSL[end] === '}') level--; }
  return TERRAIN_RASTER_WGSL.slice(m.index + m[0].length, end - 1);
}
const js = (c) => c.replace(/\blet\b|\bvar\b/g, 'let').replace(/i32\(/g, 'toI(').replace(/\bu\.nearReady != 0u/g, 'u.nearReady != 0')
  .replace(/textureLoad\((\w+), (vec2i\([^)]*\)), 0\)\.r/g, 'load($1, $2)');
function typeAtFor(terrain, u) {
  const tex = { near: { w: terrain.near.w, h: terrain.near.h, data: terrain.near.type }, far: { w: terrain.mapW, data: terrain.farType } };
  const toI = Math.trunc, vec2i = (x, y) => [x, y], load = (t, c) => t.data[c[1] * t.w + c[0]], floor = Math.floor;
  const farFn = new Function('u', 'uFarType', 'toI', 'vec2i', 'load', 'floor', `return function(x, y){${js(fnBody('farTypeNearest'))}};`)(u, tex.far, toI, vec2i, load, floor);
  return new Function('u', 'uNearType', 'toI', 'vec2i', 'load', 'floor', 'farTypeNearest', 'textureDimensions', `return function(x, y){${js(fnBody('terrainTypeAt'))}};`)(u, tex.near, toI, vec2i, load, floor, farFn, (t) => ({ x: t.w, y: t.h }));
}
function oracle(terrain, x, y) { // TerrainMeshSet.typeAt: near band first, then the far grid (with its offset)
  const t = terrain._nearGridType(x, y); if (t !== null) return t;
  const g = terrain._farGridDraw, ix = Math.floor((x - g.x0) / g.cell), iy = Math.floor((y - g.y0) / g.cell);
  return ix < 0 || iy < 0 || ix >= terrain.mapW || iy >= terrain.mapH ? 0 : terrain.farType[iy * terrain.mapW + ix];
}

const mock = makeMockGpuDevice(), d = mock.device, rp = new WgRasterPass(d);
const writes = []; const ow = d.writeTexture; d.writeTexture = (t, data) => { writes.push(data); return ow && ow.call(d, t, data); };
const NEAR = TERRAIN_BLOCK.field('nearMap').word;
const world = mk({ x: 1344, y: 1088 }), T = world.terrain; if (!T.farReady) T.bakeFarSync();
let seed = 11; const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };

function checkZone(label, expectId) {
  assert.equal(world.bandId, expectId, label + ' band id');
  const z = world.terrainBands[world._bandCur];
  assert.equal(T.near.x0, z.cx0 * 128, label + ' x0'); assert.equal(T.near.y0, z.cy0 * 128, label + ' y0');
  const before = writes.length;
  rp._terrainTextures(world);
  assert.equal(writes.length - before, 1, label + ': exactly one near re-upload (far unchanged)');
  assert.equal(writes[writes.length - 1], T.near.type, label + ': uploaded bytes are the zone type grid');
  assert.deepEqual(rp.nearDims, [T.near.w, T.near.h], label + ' tex dims');
  for (let i = 0; i < 5; i++) rp._terrainTextures(world);
  assert.equal(writes.length - before, 1, label + ': no per-frame upload');
  rp._terrainUniforms(world);
  assert.deepEqual([...rp.tu.slice(NEAR, NEAR + 4)], [T.near.x0, T.near.y0, T.near.cell, T.near.w], label + ' band origin in the uniform block');
  const u = { nearReady: 1, nearMap: { x: T.near.x0, y: T.near.y0, z: T.near.cell, w: T.near.w }, farMap: { x: T._farGridDraw.x0, y: T._farGridDraw.y0, z: T.mapCell, w: T.mapW } };
  const typeAt = typeAtFor(T, u);
  const bw = T.near.w * T.near.cell, bh = T.near.h * T.near.cell; let inside = 0;
  for (let i = 0; i < 6000; i++) {
    const x = T.near.x0 - 60 + rand() * (bw + 120), y = T.near.y0 - 60 + rand() * (bh + 120);
    assert.equal(typeAt(x, y), oracle(T, x, y), `${label} typeAt(${x},${y})`);
    if (T._nearGridType(x, y) !== null) inside++;
  }
  assert.ok(inside > 2000, label + ' near band exercised');
}
rp._terrainTextures(world); // initial: far + near
writes.length = 0; rp.nearVersion = -1; rp.nearWorld = null; // re-arm near only
checkZone('spawn g4_7', 'g4_7');
// zones that are neither east (g4_7) nor west (g3_7): far corner-ish, north, south-east
for (const [x, y, id] of [[1856, 1344, 'g6_9'], [1100, 500, null], [3000, 3200, null], [1344, 1088, 'g4_7']]) {
  assert.equal(world.ensureBandFor(x, y), true);
  checkZone('zone@' + x + ',' + y, id || world.bandId);
}
assert.ok(world.bandId === 'g4_7');
// a second world with an equal version number must still re-upload (world guard)
const w2 = mk({ x: 1856, y: 1344 }); if (!w2.terrain.farReady) w2.terrain.bakeFarSync(); const before = writes.length;
rp._terrainTextures(w2); assert.equal(writes.length - before, 2, 'new world re-uploads far + near type grids'); assert.equal(writes[writes.length - 1], w2.terrain.near.type);
rp.dispose();
console.log('passRaster.gridZone.test.js: all checks passed.');
