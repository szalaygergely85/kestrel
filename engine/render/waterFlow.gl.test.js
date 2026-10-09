// WG-5a-4: GL-only (GLSL source-string) cases split out of waterFlow.test.js so the JS/WebGPU suite no longer imports GL modules.
// WG-5: delete this file with the GL path.
import { makeOk } from '../test/assert.js';
import { WATER_COMPOSITE_FRAG_SRC } from './gpu/glsl/waterComposite.frag.js';
import { WATER_FLOW_SALT } from './waterLook.js';
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
{
  const S = WATER_COMPOSITE_FRAG_SRC;
  ok('glsl: the streak block repeats the 35.4 expressions in the JS order',
    S.includes(`hashFastU(ia & 1023, int(fib) & 1023, ${WATER_FLOW_SALT})`) && S.includes('fa = P.x * r7.x + P.y * r7.y;') && S.includes('fib = floor((-P.x * r7.y + P.y * r7.x) / r6.z);') &&
    S.includes('int ia = int(floor((fa - r7.w) / r6.y));') && S.includes('> r6.w) glyph = r6.x;') && S.includes('float diamondAngle(') && S.includes('diamondAngle(ddx, ddy) * 0.25 * r8.w'));
}

console.log(`waterFlow.gl.test.js: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
