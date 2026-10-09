// engine/render/gpu/sunShadowLookup.glsl.test.js (ME-15c, docs/architecture.md 27.9a amendment: "GLSL must bounds-check
// taps explicitly"). Static checks on the light/shade GLSL sources (no GL in Node): every texelFetch of the shadow map is
// guarded by an explicit range test, the sun DDA is skipped in map mode, and the LIGHT.w bit layout is shared with JS.
// Run: node engine/render/gpu/sunShadowLookup.glsl.test.js
import { LIGHT_FRAG_SRC } from './glsl/light.frag.js';
import { SHADE_FRAG_SRC } from './glsl/shade.frag.js';
import { SUN_N_SHIFT, SUN_N_MASK } from '../shadowSun.js';
import { makeOk } from '../../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const fn = LIGHT_FRAG_SRC.slice(LIGHT_FRAG_SRC.indexOf('int sunShadowTaps('), LIGHT_FRAG_SRC.indexOf('vec3 faceNormal('));
ok('light: sunShadowTaps found', fn.length > 100);
const fetches = fn.split('texelFetch(uSunShadow').length - 1;
ok('light: exactly one shadow-map fetch (inside the tap loop)', fetches === 1, `fetches=${fetches}`);
ok('light: bounds check precedes the fetch on all four sides',
  /t\.x < 0 \|\| t\.y < 0 \|\| t\.x >= res \|\| t\.y >= res\) \{ n\+\+; continue; \}/.test(fn) && fn.indexOf('t.x >= res') < fn.indexOf('texelFetch(uSunShadow'));
ok('light: outside the box (uv/depth outside [0,1]) is sunlit (n = 4)', /d < 0\.0 \|\| d > 1\.0\) return 4;/.test(fn));
ok('light: explicit compare, no hardware compare / sampler2DShadow', !/sampler2DShadow|textureProj|shadow2D/.test(LIGHT_FRAG_SRC));
ok('light: shadow-map sun replaced the DDA (ME-19c2: uSunMode == 2 branch, no sunVisible/uWorldGeom)', LIGHT_FRAG_SRC.indexOf('if (uSunMode == 2)') > 0 && !/sunVisible|uWorldGeom|uStructA/.test(LIGHT_FRAG_SRC));
ok('light: no shadow resolution / bias literals (uniforms only)', !/2048|0\.04|1\.5\b/.test(fn));
ok('light writes n at bits 16..18', LIGHT_FRAG_SRC.includes(`uint SUN_N_SHIFT = ${SUN_N_SHIFT}u`) && LIGHT_FRAG_SRC.includes('uint(sunN) << SUN_N_SHIFT'));
ok('shade reads n with the same shift/mask and scales only the terrain sun term',
  SHADE_FRAG_SRC.includes(`>> ${SUN_N_SHIFT}u) & ${SUN_N_MASK}u`) && SHADE_FRAG_SRC.includes('uSunI * max(0.0, ndotlT) * sunFT'));

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
