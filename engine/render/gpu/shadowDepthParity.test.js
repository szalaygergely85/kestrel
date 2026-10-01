// ME-15b: compareShadowDepth bars (16 ULP of 24-bit depth on >= 99.5 % of co-covered texels, coverage mismatch <= 0.3 %).
// Run: node engine/render/gpu/shadowDepthParity.test.js
import { compareShadowDepth, SHADOW_DEPTH_MAX } from './gpuCompare.js';
import { makeOk } from '../../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const bits = (d01) => { f32[0] = d01; return u32[0]; };
const RES = 100, N = RES * RES;
function build(fn) {
  const g = new Uint32Array(N), j = new Float64Array(N).fill(1);
  for (let i = 0; i < N; i++) g[i] = bits(1);
  fn(g, j);
  return { g, j };
}
const k2d = (k) => k / SHADOW_DEPTH_MAX;                // 24-bit code -> depth01
const k2z = (k) => (2 * k) / SHADOW_DEPTH_MAX - 1;        // 24-bit code -> NDC z

{ const { g, j } = build((g, j) => { for (let i = 0; i < 3000; i++) { g[i] = bits(k2d(1000000 + i)); j[i] = k2z(1000000 + i + 10); } });
  const r = compareShadowDepth(g, j, RES);
  ok('10 ULP offset on 3000 texels passes', r.pass && r.both === 3000 && r.maxUlp <= 11, JSON.stringify(r)); }
{ const { g, j } = build((g, j) => { for (let i = 0; i < 3000; i++) { g[i] = bits(k2d(1000000)); j[i] = k2z(1000000 + 40); } });
  const r = compareShadowDepth(g, j, RES);
  ok('40 ULP offset fails the bar', !r.pass && r.withinPct < 1, JSON.stringify(r)); }
{ const { g, j } = build((g, j) => { for (let i = 0; i < 3000; i++) { g[i] = bits(k2d(500000)); j[i] = k2z(500000); } for (let i = 3000; i < 3040; i++) g[i] = bits(k2d(1)); }); // 40 / 10000 = 0.4 % one-sided
  const r = compareShadowDepth(g, j, RES);
  ok('0.4 % coverage mismatch fails, 0.2 % passes', !r.pass && r.gpuOnly === 40);
  for (let i = 3020; i < 3040; i++) g[i] = bits(1);
  ok('0.2 % coverage mismatch passes', compareShadowDepth(g, j, RES).pass); }
{ // steep slope: a +60 code difference on a texel whose JS neighbours step 5000 codes passes (position error 0.012 texel), on a flat texel it fails
  const { g, j } = build((g, j) => { for (let i = 0; i < 3000; i++) { j[i] = k2z(1000000 + i * 5000); g[i] = bits(k2d(1000000 + i * 5000 + 60)); } });
  const r = compareShadowDepth(g, j, RES);
  ok('60 ULP on a 5000 codes/texel slope passes the slope-aware gate but not the flat-16 figure', r.pass && r.within16Pct < 1 && r.withinPct > 99.9, JSON.stringify(r)); }
{ const { g, j } = build(() => {});
  const r = compareShadowDepth(g, j, RES);
  ok('empty maps (both cleared to 1) pass', r.pass && r.both === 0 && r.covGpu === 0); }

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); } else console.log('ALL PASS');
