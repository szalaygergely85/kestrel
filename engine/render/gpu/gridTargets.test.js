// engine/render/gpu/gridTargets.test.js (US-038a, architecture.md 22.4/22.9
// S2): a counting mock `gl` - no real WebGL2 context - that runs 20 alloc/
// free cycles through the 4 player grids and checks the live texture/FBO
// count always returns to the single-alloc value (no leak). Plain Node ESM:
//
//   node engine/render/gpu/gridTargets.test.js

import { allocGridTargets, freeGridTargets, computeGridLimits } from './gridTargets.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// ---- mock gl: create*/delete* count live objects; everything else is a
// no-op; any ALL_CAPS property name is treated as a GL constant (a stable
// number, memoized) so `formatFor`'s switch and `checkFramebufferStatus`
// comparisons both work without a real context. ----
function makeMockGL() {
  let liveTex = 0, liveFbo = 0;
  const consts = {};
  let nextConst = 1;
  const gl = new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (/^[A-Z0-9_]+$/.test(prop)) {
        if (!(prop in consts)) consts[prop] = nextConst++;
        return consts[prop];
      }
      if (prop === 'createTexture') return () => { liveTex++; return {}; };
      if (prop === 'createFramebuffer') return () => { liveFbo++; return {}; };
      if (prop === 'deleteTexture') return (o) => { if (o) liveTex--; };
      if (prop === 'deleteFramebuffer') return (o) => { if (o) liveFbo--; };
      if (prop === 'checkFramebufferStatus') return () => gl.FRAMEBUFFER_COMPLETE;
      return () => {}; // every other GL method (bindTexture, texImage2D, drawBuffers, ...) is a no-op
    },
  });
  return { gl, counts: () => ({ tex: liveTex, fbo: liveFbo }) };
}

const GRIDS = [[240, 90], [320, 120], [400, 150], [480, 180], [240, 90]];
const RAYS = 2;

{
  const { gl, counts } = makeMockGL();
  const fgTex = {}, bgTex = {}; // RenderTarget's own fg/bg - never touched by alloc/free here
  let baseline = null;
  for (let cycle = 0; cycle < 20; cycle++) {
    for (const [cols, rows] of GRIDS) {
      const t = allocGridTargets(gl, cols, rows, RAYS, fgTex, bgTex);
      ok(`cycle ${cycle} ${cols}x${rows}: alloc produced every field`, !!(t.texGI && t.texShadeBg && t.fboFinal));
      const afterAlloc = counts();
      if (baseline === null) baseline = afterAlloc;
      else ok(`cycle ${cycle} ${cols}x${rows}: live count matches the single-alloc baseline`, afterAlloc.tex === baseline.tex && afterAlloc.fbo === baseline.fbo, JSON.stringify(afterAlloc));
      freeGridTargets(gl, t);
    }
  }
  const final = counts();
  ok('20 alloc/free cycles through 240->320->400->480->240 leave zero live textures', final.tex === 0, `tex=${final.tex}`);
  ok('20 alloc/free cycles through 240->320->400->480->240 leave zero live FBOs', final.fbo === 0, `fbo=${final.fbo}`);
}

// ---- computeGridLimits: fake getParameter, no real gl needed ----
function fakeGl2(overrides) {
  const P = { MAX_TEXTURE_SIZE: 2048, MAX_VIEWPORT_DIMS: [4096, 4096], MAX_DRAW_BUFFERS: 8, ...overrides };
  return {
    MAX_TEXTURE_SIZE: 'MAX_TEXTURE_SIZE', MAX_VIEWPORT_DIMS: 'MAX_VIEWPORT_DIMS', MAX_DRAW_BUFFERS: 'MAX_DRAW_BUFFERS',
    getParameter(name) { return P[name]; },
  };
}

{
  const g = fakeGl2({});
  const r = computeGridLimits(g, 480, 180, 2, 4, 8);
  ok('480x180 rays=2 fits comfortably under every limit', r.ok === true, JSON.stringify(r));
}
{
  const g = fakeGl2({ MAX_TEXTURE_SIZE: 1024 }); // 480*2=960 < 1024, but 480*4=1920 > 1024
  const r = computeGridLimits(g, 480, 180, 4, 4, 8);
  ok('a sub-sample grid over MAX_TEXTURE_SIZE is refused', r.ok === false && /MAX_TEXTURE_SIZE/.test(r.reason), JSON.stringify(r));
}
{
  const g = fakeGl2({ MAX_VIEWPORT_DIMS: [100, 100] });
  const r = computeGridLimits(g, 480, 180, 2, 4, 8);
  ok('a canvas backing size over MAX_VIEWPORT_DIMS is refused', r.ok === false && /MAX_VIEWPORT_DIMS/.test(r.reason), JSON.stringify(r));
}
{
  const g = fakeGl2({ MAX_DRAW_BUFFERS: 2 });
  const r = computeGridLimits(g, 240, 90, 2, 4, 8);
  ok('fewer than 3 draw buffers is refused', r.ok === false && /MAX_DRAW_BUFFERS/.test(r.reason), JSON.stringify(r));
}
{
  const g = fakeGl2({});
  const r = computeGridLimits(g, 480, 180, 4, 4, 8); // ~85 MB per the architecture note - still under 256 MB
  ok('480x180 rays=4 (~85 MB) still fits the 256 MB budget', r.ok === true, JSON.stringify(r));
}

// ---- Architect review 1 item 1: computeGridLimits on a lost context must
// return {ok:false}, never throw (gl.getParameter returns null on a lost
// context per spec, so maxViewport[0] etc. would otherwise throw). ----
{
  const g = fakeGl2({});
  g.isContextLost = () => true;
  let threw = false, r = null;
  try { r = computeGridLimits(g, 480, 180, 2, 4, 8); } catch (e) { threw = true; }
  ok('computeGridLimits never throws on a lost context', !threw);
  ok('computeGridLimits on a lost context returns ok:false with a reason', !!r && r.ok === false && /context lost/.test(r.reason), JSON.stringify(r));
}

// ---- Architect review 1 item 2: allocGridTargets throwing mid-way (an
// incomplete FBO, the realistic out-of-memory failure) must not leak the
// textures/FBOs already created on the partial set - they're freed before
// the error propagates. ----
{
  const { gl: baseGl, counts } = makeMockGL();
  const fgTex = {}, bgTex = {};
  // Wrap checkFramebufferStatus so the 3rd FBO check (fboCast) fails -
  // several textures and 2 FBOs (fboCastSub, fboTerrainSub) already exist
  // on `t` by then.
  let fboChecks = 0;
  const gl = new Proxy(baseGl, {
    get(target, prop) {
      if (prop === 'checkFramebufferStatus') {
        return () => { fboChecks++; return fboChecks === 3 ? -1 /* != FRAMEBUFFER_COMPLETE */ : target.FRAMEBUFFER_COMPLETE; };
      }
      return target[prop];
    },
  });
  let threw = false;
  try { allocGridTargets(gl, 240, 90, 2, fgTex, bgTex); } catch (e) { threw = true; }
  ok('allocGridTargets rethrows on an incomplete FBO mid-way', threw);
  const after = counts();
  ok('allocGridTargets frees every partially-created texture/FBO on failure (no leak)', after.tex === 0 && after.fbo === 0, JSON.stringify(after));
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
