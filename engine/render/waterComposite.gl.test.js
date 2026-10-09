// WG-5a-4: GL-only (GLSL source-string) cases split out of waterComposite.test.js so the JS/WebGPU suite no longer imports GL modules.
// WG-5: delete this file with the GL path.
import { makeOk } from '../test/assert.js';
import { WATER_COMPOSITE_FRAG_SRC } from './gpu/glsl/waterComposite.frag.js';
import { EDGE_FRAG_SRC } from './gpu/glsl/edge.frag.js';
import { WATER_HASH_SALT } from './waterLook.js';
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
// ---- 7. shader source parity (the GLSL twin) ----
{
  const S = WATER_COMPOSITE_FRAG_SRC;
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('glsl: the composite uses the shared water hash salt and the (x,y,salt+31*tick) key', S.includes(`${WATER_HASH_SALT} + 31 * tick`) && S.includes('hashFastU(iu & 1023, iv & 1023,'));
  ok('glsl: opacity / seeThrough / glint / bgK rules are the 32.2 ones', S.includes('clamp((raw - dW) / opaqueAt, 0.0, 1.0)') && S.includes('a >= seeThrough') && S.includes('> 1.0 - r3.w') && S.includes('* 0.5') && S.includes('wc * bgK'));
  ok('glsl: gl_FragCoord only as the ivec2 cell address, no round(, no Infinity literal', (S.match(/gl_FragCoord/g) || []).length === 1 && /ivec2\s*\(\s*gl_FragCoord\.xy\s*\)/.test(S) && !strip(S).includes('round(') && !S.includes('Infinity'));
  ok('glsl: reads the +Inf WATER clear by bit pattern, passthrough cells (bg.a < 0.5) are copied', S.includes('0x7f800000u') && S.includes('sbg.a < 0.5'));
  ok('glsl: terrain sun term on an up normal with the cell sun-map bits', S.includes('max(uSunDir.z, 0.0)') && S.includes('uSunMapOn != 0'));
  ok('glsl: sampler budget - 6 samplers in the composite, and the edge pass adds only uWater', (S.match(/uniform u?sampler2D/g) || []).length === 6 && (EDGE_FRAG_SRC.match(/uniform u?sampler2D/g) || []).length === 5);
  ok('glsl: the edge pass suppresses outlines on opaque water (uWaterOn / waterOpaque)', EDGE_FRAG_SRC.includes('!waterOpaque(cell, distRaw)') && EDGE_FRAG_SRC.includes('(raw - dW) / os.x >= os.y'));
}


console.log(`waterComposite.gl.test.js: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
