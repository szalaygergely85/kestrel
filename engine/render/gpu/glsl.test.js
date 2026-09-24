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

console.log(`\n[glsl.test.js] ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error('  FAIL: ' + f); process.exit(1); }
