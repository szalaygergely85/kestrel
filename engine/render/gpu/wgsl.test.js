// 38.8a 24b: WGSL pairing rule. A pipeline has ONE bind group layout, so the vertex and the fragment module of a pipeline must declare
// the SAME type for every shared @group/@binding (the terrain raster VS `TerrainU` paired with the shadow FS `ShadowTerrainU` made the FS read
// structCount from model[0]; `--mode wgsl` compiles modules alone and cannot see it). Also: no module binds two names to one slot.
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../test/assert.js';
import { WGSL_MODULES } from './wgsl/index.js';
import { WgShadowPass } from './wg/passShadow.js';
import { WgRasterPass } from './wg/passRaster.js';
import { SHADOW_TERRAIN_WGSL } from './wgsl/shadow.wgsl.js';
import { TERRAIN_RASTER_WGSL } from './wgsl/terrainRaster.wgsl.js';

const BIND_RE = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<[^>]*>)?\s+(\w+)\s*:\s*([^;]+);/g;
/** @returns {Map<string, {name: string, type: string}>} "group/binding" -> declaration */
export function parseBindings(code) {
  const out = new Map();
  for (const m of code.matchAll(BIND_RE)) {
    const key = `${m[1]}/${m[2]}`;
    assert.ok(!out.has(key), `slot ${key} bound twice in one module (${out.get(key) && out.get(key).name} and ${m[3]})`);
    out.set(key, { name: m[3], type: m[4].trim() });
  }
  return out;
}
/** Returns the list of conflicts between a vertex and a fragment module (same slot, different declared type). */
export function pairConflicts(vsCode, fsCode) {
  if (vsCode === fsCode) return [];
  const v = parseBindings(vsCode), f = parseBindings(fsCode), bad = [];
  for (const [key, d] of f) { const o = v.get(key); if (o && o.type !== d.type) bad.push(`@${key}: vertex ${o.type} vs fragment ${d.type}`); }
  return bad;
}

// registry: every module parses, no slot is bound twice
for (const m of WGSL_MODULES) parseBindings(m.code);

// the checker itself: the historic bug (terrain raster VS + stand-alone shadow FS) is caught, the fixed pairing is not
assert.ok(parseBindings(TERRAIN_RASTER_WGSL).get('1/0').type === 'TerrainU');
assert.ok(parseBindings(SHADOW_TERRAIN_WGSL).get('1/0').type === 'ShadowTerrainU');
assert.equal(pairConflicts(TERRAIN_RASTER_WGSL, SHADOW_TERRAIN_WGSL).length, 1, 'TerrainU vs ShadowTerrainU at @group(1) @binding(0) is a conflict');
assert.deepEqual(pairConflicts(SHADOW_TERRAIN_WGSL, SHADOW_TERRAIN_WGSL), []);

// every real pipeline of the shadow and raster passes pairs consistent modules
const mock = makeMockGpuDevice();
const pipes = [];
for (const pass of [new WgShadowPass(mock.device, { shadows: { res: 256 } }), new WgRasterPass(mock.device)]) {
  for (const key of Object.keys(pass)) { const v = pass[key]; if (v && v.desc && v.desc.vertex) pipes.push([key, v]); }
  for (const pipe of pass.pipes || []) if (!pipes.some(([, p]) => p === pipe)) pipes.push(['pipes[]', pipe]);
}
assert.ok(pipes.length >= 5, 'found the shadow/raster pipelines: ' + pipes.length);
for (const [name, pipe] of pipes) {
  const d = pipe.desc, fs = d.fragment && d.fragment.src;
  if (!fs) continue;
  assert.deepEqual(pairConflicts(d.vertex.src.wgsl, fs.wgsl), [], `${name}: vertex/fragment bindings agree`);
}
const terrain = pipes.find(([n]) => n === 'terrainPipe');
assert.ok(terrain && terrain[1].desc.vertex.src.wgsl === terrain[1].desc.fragment.src.wgsl && /ShadowTerrainU/.test(terrain[1].desc.vertex.src.wgsl), 'terrain shadow pipeline uses one module / one block');
console.log(`wgsl.test.js: binding rules over ${WGSL_MODULES.length} modules, ${pipes.length} shadow/raster pipelines paired consistently.`);
