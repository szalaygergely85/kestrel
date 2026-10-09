// WG-2c: terrain raster WGSL probes against the JS oracle (TerrainMeshSet.typeAt via Terrain._nearGridType / farType),
// the GLSL twin text, and shader/layout string rules. node engine/render/gpu/wgsl/terrainRaster.wgsl.test.js
import assert from 'node:assert/strict';
import { TERRAIN_RASTER_WGSL, TERRAIN_BLOCK, TERRAIN_TEXTURES } from './terrainRaster.wgsl.js';
import { TERRAIN_RASTER_FRAG_SRC, TERRAIN_VERT_SRC } from './terrainVert.glslref.js';
import { WGSL_MODULES } from './index.js';
import { KIND_TERRAIN, FACE_PACKED } from '../../GBuffer.js';
import { MAX_STRUCTS } from '../WorldTextures.js';

// Evaluate the WGSL type lookup (farTypeNearest + terrainTypeAt) as JS with a fake uniform block / textures.
function fnBody(name) {
  const m = TERRAIN_RASTER_WGSL.match(new RegExp(String.raw`fn ${name}\(([^)]*)\)\s*->[^{]+\{`));
  assert.ok(m, name);
  let level = 1, end = m.index + m[0].length;
  for (; level; end++) { if (TERRAIN_RASTER_WGSL[end] === '{') level++; if (TERRAIN_RASTER_WGSL[end] === '}') level--; }
  return { params: m[1].split(',').map((p) => p.split(':')[0].trim()), code: TERRAIN_RASTER_WGSL.slice(m.index + m[0].length, end - 1) };
}
function js(code) {
  return code.replace(/\blet\b|\bvar\b/g, 'let').replace(/i32\(/g, 'toI(').replace(/vec2i\(/g, 'vec2i(')
    .replace(/\bu\.nearReady != 0u/g, 'u.nearReady != 0').replace(/textureLoad\((\w+), (vec2i\([^)]*\)), 0\)\.r/g, 'load($1, $2)');
}
function makeTypeAt(tex, u) {
  const far = fnBody('farTypeNearest'), tpa = fnBody('terrainTypeAt');
  const toI = Math.trunc, vec2i = (x, y) => [x, y], load = (t, c) => t.data[c[1] * t.w + c[0]];
  const floor = Math.floor;
  const farFn = new Function('u', 'uFarType', 'toI', 'vec2i', 'load', 'floor', `return function(x, y){${js(far.code)}};`)(u, tex.far, toI, vec2i, load, floor);
  return new Function('u', 'uNearType', 'toI', 'vec2i', 'load', 'floor', 'farTypeNearest', `return function(x, y){${js(tpa.code)}};`)(u, tex.near, toI, vec2i, load, floor, farFn);
}

let seed = 7;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
const mapW = 16, mapCell = 8, nearW = 12, nearCell = 2, x0 = 24, y0 = 40;
const farType = new Uint8Array(mapW * mapW).map(() => (rand() * 6) | 0), nearType = new Uint8Array(nearW * nearW).map(() => (rand() * 6) | 0);
const terrain = { nearReady: true, near: { x0, y0, cell: nearCell, w: nearW, h: nearW, type: nearType }, mapCell, mapW, mapH: mapW, farType,
  _nearGridType(x, y) { const g = this.near, i = Math.floor((x - g.x0) / g.cell), j = Math.floor((y - g.y0) / g.cell); return i < 0 || j < 0 || i >= g.w || j >= g.h ? null : g.type[i + j * g.w]; } };
function oracle(x, y) { // TerrainMeshSet.typeAt, source of truth (engine/mesh/terrainMesh.js)
  if (terrain.nearReady) { const t = terrain._nearGridType(x, y); if (t !== null) return t; }
  const ix = Math.floor(x / terrain.mapCell), iy = Math.floor(y / terrain.mapCell);
  if (ix < 0 || iy < 0 || ix >= terrain.mapW || iy >= terrain.mapH) return 0;
  return terrain.farType[iy * terrain.mapW + ix];
}
const u = { nearReady: 1, nearMap: { x: x0, y: y0, z: nearCell, w: nearW }, farMap: { x: 0, y: 0, z: mapCell, w: mapW } };
// vec4 fields are .x/.y/.z/.w in WGSL, the fake block uses the same names
const typeAt = makeTypeAt({ near: { w: nearW, data: nearType }, far: { w: mapW, data: farType } }, u);
let near = 0;
for (let i = 0; i < 5000; i++) {
  const x = rand() * 160 - 16, y = rand() * 160 - 16;
  assert.equal(typeAt(x, y), oracle(x, y), `typeAt(${x},${y})`);
  if (terrain._nearGridType(x, y) !== null) near++;
}
assert.ok(near > 100, 'near band was exercised');
u.nearReady = 0; terrain.nearReady = false;
for (let i = 0; i < 1000; i++) { const x = rand() * 160 - 16, y = rand() * 160 - 16; assert.equal(typeAt(x, y), oracle(x, y)); }

// Same-op-order string checks against the GLSL twin.
const src = TERRAIN_RASTER_WGSL;
assert.ok(src.includes('o.pos.y = -o.pos.y; o.pos.z = 0.5 * (o.pos.z + o.pos.w);'));
assert.ok(src.includes('let dist = select(1.0 / v.pos.w, 0.05 + v.pos.z * (2000.0 - 0.05), u.projMode == 2u);'));
assert.ok(src.includes('const PLANEID_TERRAIN: u32 = 0xFFFFFFFFu;')); // GL uint(-1)
assert.ok(src.includes(`const KIND_TERRAIN: u32 = ${KIND_TERRAIN}u;`) && src.includes(`const FACE_PACKED: u32 = ${FACE_PACKED}u;`));
assert.ok(src.includes('KIND_TERRAIN | (FACE_PACKED << 8u) | (u32(terrType) << 16u)'));
assert.ok(src.includes('bitcast<u32>(1.0e30f)'));
assert.ok(/x >= b\.x && .*x < b\.z && .*y >= b\.y && .*y < b\.w\) \{ discard; \}/.test(src.replace(/v\.vWorldPos\./g, '')), 'half-open footprint carve');
assert.ok(TERRAIN_RASTER_FRAG_SRC.includes('vWorldPos.x >= b.x && vWorldPos.x < b.z') && TERRAIN_VERT_SRC.includes('unpackNormalOct(aNrmBits)'));
assert.ok(!/\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample|%/.test(src));
assert.ok(src.includes(`for (var i = 0; i < ${MAX_STRUCTS}; i++)`));
assert.deepEqual(TERRAIN_TEXTURES, ['uint', 'uint']);
assert.ok(src.includes('@group(0) @binding(0) var uNearType: texture_2d<u32>;') && src.includes('@group(0) @binding(1) var uFarType: texture_2d<u32>;'));
assert.ok(WGSL_MODULES.some((m) => m.name === 'rasterTerrain' && m.code === TERRAIN_RASTER_WGSL));
assert.equal(TERRAIN_BLOCK.sizeBytes % 16, 0);
// PREC-01a (37.9 step 6): clip from the rebased modelRel, vWorldPos still from the absolute model (kind-7 GA.xy = world metres).
assert.ok(TERRAIN_RASTER_WGSL.includes('o.pos = u.viewProj * (u.modelRel * vec4f(a.aPos, 1.0));'));
assert.ok(TERRAIN_RASTER_WGSL.includes('let worldPos = u.model * vec4f(a.aPos, 1.0);') && TERRAIN_RASTER_WGSL.includes('o.vWorldPos = worldPos.xyz;'));
assert.ok(!/origin/.test(TERRAIN_RASTER_WGSL));
console.log('terrainRaster.wgsl.test.js: 6000 type-lookup probes (near ' + near + ') and shader/layout checks passed. block ' + TERRAIN_BLOCK.sizeBytes + ' B');
