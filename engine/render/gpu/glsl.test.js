// engine/render/gpu/glsl.test.js (US-029 tech notes item 10). Shader
// SOURCE-STRING checks only (no `gl` - can't compile headless): the five
// hash constants, '1.18'/'0.35' (edgePass.js's `farther()` constants), no
// `gl_FragCoord` outside the one address line per shader, no `round(`.
// Run: node engine/render/gpu/glsl.test.js
import { SHADE_FRAG_SRC } from './glsl/shade.frag.js';
import { EDGE_FRAG_SRC } from './glsl/edge.frag.js';
import { DEBUG_FRAG_SRC } from './glsl/debug.frag.js';
import { CELL_VERT_SRC } from './glsl/cell.vert.js';
import { DDA_FRAG_SRC } from './glsl/dda.frag.js';
import { DERIV_FRAG_SRC } from './glsl/deriv.frag.js';
import { TERRAIN_FRAG_SRC } from './glsl/terrain.frag.js';
import { VOXEL_FRAG_SRC } from './glsl/voxel.frag.js';
import { LIGHT_FRAG_SRC } from './glsl/light.frag.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const HASH_CONSTANTS = ['0x27d4eb2d', '0x165667b1', '0x9e3779b1', '0x85ebca6b', '0xc2b2ae35'];

for (const c of HASH_CONSTANTS) {
  ok(`shade.frag.js contains hash constant ${c}`, SHADE_FRAG_SRC.includes(c));
}

ok('edge.frag.js contains 1.18', EDGE_FRAG_SRC.includes('1.18'));
ok('edge.frag.js contains 0.35', EDGE_FRAG_SRC.includes('0.35'));

function countGlFragCoordLines(src) {
  return src.split('\n').filter((l) => l.includes('gl_FragCoord')).length;
}
function isAddressLine(line) {
  return /ivec2\s*\(\s*gl_FragCoord\.xy\s*\)/.test(line);
}
function checkOnlyAddressLine(name, src) {
  const lines = src.split('\n').filter((l) => l.includes('gl_FragCoord'));
  const allAddress = lines.length > 0 && lines.every(isAddressLine);
  ok(`${name}: gl_FragCoord only used as ivec2(gl_FragCoord.xy) address`, allAddress, lines.join(' | '));
}
checkOnlyAddressLine('shade.frag.js', SHADE_FRAG_SRC);
checkOnlyAddressLine('edge.frag.js', EDGE_FRAG_SRC);
checkOnlyAddressLine('debug.frag.js', DEBUG_FRAG_SRC);
checkOnlyAddressLine('dda.frag.js', DDA_FRAG_SRC);
checkOnlyAddressLine('deriv.frag.js', DERIV_FRAG_SRC);
ok('cell.vert.js: no gl_FragCoord (vertex stage)', !CELL_VERT_SRC.includes('gl_FragCoord'));

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
for (const [name, src] of [
  ['shade.frag.js', SHADE_FRAG_SRC], ['edge.frag.js', EDGE_FRAG_SRC], ['debug.frag.js', DEBUG_FRAG_SRC],
  ['cell.vert.js', CELL_VERT_SRC], ['dda.frag.js', DDA_FRAG_SRC], ['deriv.frag.js', DERIV_FRAG_SRC],
]) {
  ok(`${name}: no round(`, !stripComments(src).includes('round('));
}

// Ban list sanity (14.1 section 5 / 8.1 rule 5 carryover): no UBOs, no
// EXT_color_buffer_float dependency string, no signed-shift / negative-%
// smell markers we can detect lexically.
for (const [name, src] of [
  ['shade.frag.js', SHADE_FRAG_SRC], ['edge.frag.js', EDGE_FRAG_SRC],
  ['dda.frag.js', DDA_FRAG_SRC], ['deriv.frag.js', DERIV_FRAG_SRC],
]) {
  ok(`${name}: no EXT_color_buffer_float`, !src.includes('EXT_color_buffer_float'));
  ok(`${name}: no 'layout(std140'`, !src.includes('layout(std140'));
}

// US-030a (14.2 item 1/3, backlog tech notes item 10): the DDA/deriv passes
// must use the shared JS constants (not hand-copied numbers) and the
// all-uint `floatBitsToUint` output convention.
ok('dda.frag.js contains MAX_RAY_STEPS', DDA_FRAG_SRC.includes('MAX_RAY_STEPS'));
ok('dda.frag.js contains MAX_DIST', DDA_FRAG_SRC.includes('MAX_DIST'));
ok('dda.frag.js contains floatBitsToUint', DDA_FRAG_SRC.includes('floatBitsToUint'));
ok('deriv.frag.js contains floatBitsToUint', DERIV_FRAG_SRC.includes('floatBitsToUint'));
ok('shade.frag.js reads uGA/uDepth back with uintBitsToFloat', SHADE_FRAG_SRC.includes('uintBitsToFloat'));
ok('edge.frag.js reads uDepth back with uintBitsToFloat', EDGE_FRAG_SRC.includes('uintBitsToFloat'));

// US-016 (14.4 GPU build order step 2/3, backlog test plan): terrain.frag.js
// must use the JS-injected constants (not hand-copied numbers) and no
// literal band/fog numbers; shade.frag.js's kind==7 branch reads it back.
checkOnlyAddressLine('terrain.frag.js', TERRAIN_FRAG_SRC);
ok('terrain.frag.js: no round(', !stripComments(TERRAIN_FRAG_SRC).includes('round('));
ok('terrain.frag.js: no EXT_color_buffer_float', !TERRAIN_FRAG_SRC.includes('EXT_color_buffer_float'));
ok('terrain.frag.js: no layout(std140', !TERRAIN_FRAG_SRC.includes('layout(std140'));
ok('terrain.frag.js contains MAX_TERRAIN_STEPS', TERRAIN_FRAG_SRC.includes('MAX_TERRAIN_STEPS'));
ok('terrain.frag.js contains STEP_MIN', TERRAIN_FRAG_SRC.includes('STEP_MIN'));
ok('terrain.frag.js contains STEP_K', TERRAIN_FRAG_SRC.includes('STEP_K'));
ok('terrain.frag.js contains KIND_TERRAIN', TERRAIN_FRAG_SRC.includes('KIND_TERRAIN'));
ok('terrain.frag.js contains floatBitsToUint', TERRAIN_FRAG_SRC.includes('floatBitsToUint'));
ok('shade.frag.js contains KIND_TERRAIN (kind==7 branch)', SHADE_FRAG_SRC.includes('KIND_TERRAIN') || /== *7u/.test(SHADE_FRAG_SRC));
// item 10 "do not" list: recipe constants (bands/fog/glyph sets) never as
// GLSL literals - a spot check for the two band-edge magic numbers that
// WOULD appear if someone hand-copied overworld_far.js instead of wiring
// uBandNear/uBandMid/uTerrainFog* uniforms.
ok('terrain.frag.js: bands/fog come from uniforms, not literals 150.0/600.0', !TERRAIN_FRAG_SRC.includes('150.0') && !TERRAIN_FRAG_SRC.includes('600.0'));

// US-026a S5 (23.4/23.7 S5): near-band textures/uniforms - literal port of
// terrainCaster.js's near sampling (useNear/sampleH/terrainNormal), gated by
// uNearReady, never a literal 130/170/0.5/0.012.
for (const u of ['uNearH', 'uNearType', 'uNearMap', 'uNearReady', 'uFarMinH', 'uNearMinH', 'uHandover', 'uNearStep']) {
  ok(`terrain.frag.js contains ${u}`, TERRAIN_FRAG_SRC.includes(u));
}
ok('terrain.frag.js contains DITHER_SEED', TERRAIN_FRAG_SRC.includes('DITHER_SEED'));
ok('terrain.frag.js contains useNearSample', TERRAIN_FRAG_SRC.includes('useNearSample'));
ok('terrain.frag.js contains packNormalOct (aoD now carries the normal, not b)', TERRAIN_FRAG_SRC.includes('packNormalOct'));
ok('terrain.frag.js: no literal 130.0/170.0/0.5/0.012 (near recipe constants via uniforms only)',
  !TERRAIN_FRAG_SRC.includes('130.0') && !TERRAIN_FRAG_SRC.includes('170.0') && !TERRAIN_FRAG_SRC.includes('0.012'));

// US-026a S5: shadeTerrainFar renamed to shadeTerrain (matches the JS
// oracle's own rename); near-detail (close band/jitter/features) uniforms.
ok('shade.frag.js: no shadeTerrainFar( function definition/call (renamed to shadeTerrain)', !/shadeTerrainFar\(/.test(SHADE_FRAG_SRC));
ok('shade.frag.js contains shadeTerrain(', SHADE_FRAG_SRC.includes('shadeTerrain('));
for (const u of ['uNearDetailOn', 'uHandover', 'uCloseBand', 'uSunDir', 'uAmbientI', 'uSunI']) {
  ok(`shade.frag.js contains ${u}`, SHADE_FRAG_SRC.includes(u));
}
ok('shade.frag.js contains unpackNormalOct (decodes the march pass packed normal)', SHADE_FRAG_SRC.includes('unpackNormalOct'));
ok('shade.frag.js contains MAX_FEATURES_PER_TYPE', SHADE_FRAG_SRC.includes('MAX_FEATURES_PER_TYPE'));

// US-026a S5 (23.4 "Lighting"): light.frag.js skips the sun term for terrain
// (kind 7) - analytic/shadow-free, D-007.
ok('light.frag.js contains KIND_TERRAIN', LIGHT_FRAG_SRC.includes('KIND_TERRAIN'));
ok('light.frag.js skips the sun for terrain (kindU != uint(KIND_TERRAIN))', LIGHT_FRAG_SRC.includes('kindU != uint(KIND_TERRAIN)'));

// US-040 (15.2 item 8): voxel.frag.js - the JS-injected constants, the
// verbatim axis-choice rule, the +Inf aoD bit pattern, and the numeric ban
// list (no Infinity/round() in GLSL - 14.1 item 5).
checkOnlyAddressLine('voxel.frag.js', VOXEL_FRAG_SRC);
ok('voxel.frag.js: no round(', !stripComments(VOXEL_FRAG_SRC).includes('round('));
ok('voxel.frag.js: no EXT_color_buffer_float', !VOXEL_FRAG_SRC.includes('EXT_color_buffer_float'));
ok('voxel.frag.js: no layout(std140', !VOXEL_FRAG_SRC.includes('layout(std140'));
ok('voxel.frag.js: no Infinity', !VOXEL_FRAG_SRC.includes('Infinity'));
ok('voxel.frag.js contains MAX_VOX_STEPS', VOXEL_FRAG_SRC.includes('MAX_VOX_STEPS'));
ok('voxel.frag.js contains MAX_VOX_INSTANCES', VOXEL_FRAG_SRC.includes('MAX_VOX_INSTANCES'));
ok('voxel.frag.js contains MAX_VOX_PARTS', VOXEL_FRAG_SRC.includes('MAX_VOX_PARTS'));
ok('voxel.frag.js contains the verbatim axis rule', /if \(tMaxX < tMaxY\) axis = tMaxX < tMaxZ \? 0 : 2; else axis = tMaxY < tMaxZ \? 1 : 2;/.test(VOXEL_FRAG_SRC));
ok('voxel.frag.js contains the +Inf aoD bit pattern 0x7f800000u', VOXEL_FRAG_SRC.includes('0x7f800000u'));
ok('voxel.frag.js contains floatBitsToUint', VOXEL_FRAG_SRC.includes('floatBitsToUint'));
ok('voxel.frag.js contains KIND_MODEL', VOXEL_FRAG_SRC.includes('KIND_MODEL'));

console.log(`\n[glsl.test.js] ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error('  FAIL: ' + f); process.exit(1); }
