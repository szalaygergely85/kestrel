// WG-5a-4: GL-only (GLSL source-string) cases split out of crosshair.test.js so the JS/WebGPU suite no longer imports GL modules.
// WG-5: delete this file with the GL path.
import { makeOk } from '../test/assert.js';
import { FRAGMENT_SRC } from '../render/RenderTargetGL.js';
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
// ---- GL present path (source-string, glsl.test.js's technique) ----
{
  const alpha128 = 128 / 255, alpha255 = 255 / 255;
  ok('GL: 128/255 (bg alpha) falls in the glyph-only band [0.5, 0.75)', alpha128 >= 0.5 && alpha128 < 0.75);
  ok('GL: 255/255 (bg alpha) stays in the opaque band (>= 0.75)', alpha255 >= 0.75);
  ok('GL: transparent cells (bg.a < 0.5) still discard', FRAGMENT_SRC.includes('if (uLayer == 1 && bg.a < 0.5) discard;'));
  ok('GL: glyph-only branch gates on bg.a < 0.75', FRAGMENT_SRC.includes('if (uLayer == 1 && bg.a < 0.75)'));
  ok('GL: glyph-only discards where glyph coverage < 0.5 (scene shows through)', FRAGMENT_SRC.includes('if (a < 0.5) discard;'));
  ok('GL: glyph-only outputs only fg over the scene (no bg box)', FRAGMENT_SRC.includes('fragColor = vec4(fg.rgb, 1.0);'));
  ok('GL: opaque cells still mix bg<->fg by coverage', FRAGMENT_SRC.includes('fragColor = vec4(mix(bg.rgb, fg.rgb, a), 1.0);'));
}


console.log(`crosshair.gl.test.js: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
