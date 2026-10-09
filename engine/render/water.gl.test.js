// WG-5a-4: GL-only (GLSL source-string) cases split out of water.test.js so the JS/WebGPU suite no longer imports GL modules.
// WG-5: delete this file with the GL path.
import { makeOk } from '../test/assert.js';
import { WATER_VERT_SRC } from './gpu/glsl/water.vert.js';
import { WATER_FRAG_SRC } from './gpu/glsl/water.frag.js';
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
{
  const strip = (src) => src.replace(/\/\/.*$/gm, '');
  ok('water.vert.js: clamp to uAabb, MVP carries O, single vec4 attribute at location 0', /clamp\(aL\.xy, uAabb\.xy, uAabb\.zw\)/.test(WATER_VERT_SRC) && WATER_VERT_SRC.includes('layout(location = 0) in vec4 aL') && WATER_VERT_SRC.includes('uMVP * vec4(l, uZ, 1.0)'));
  const f = strip(WATER_FRAG_SRC);
  ok('water.frag.js: rect half-open + circle inclusive, occluder vD >= scene, WATER channels', f.includes('vL.x >= uShape.x && vL.x < uShape.z') && f.includes('dot(d, d) <= uShape.z') && f.includes('!(vD < sceneD)') && f.includes('1.0 / gl_FragCoord.w') && f.includes('uSlot | (back << 4u)') && f.includes('gl_FrontFacing'));
  ok('water.frag.js: gl_FragCoord only as ivec2 address / 1/w', strip(WATER_FRAG_SRC).split(String.fromCharCode(10)).filter((l) => l.includes('gl_FragCoord')).every((l) => /ivec2\s*\(\s*gl_FragCoord\.xy\s*\)|gl_FragCoord\.w/.test(l)));
}

console.log(`water.gl.test.js: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
