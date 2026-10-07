// engine/render/gpu/device/webgpuProbe.test.js - WG-1a. Pure tests, no adapter.
//   node engine/render/gpu/device/webgpuProbe.test.js
import { evaluateWebGpuLimits, probeWebGpu, REQUIRED_LIMITS } from './webgpuProbe.js';
import { makeOk } from '../../../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const good = { maxColorAttachmentBytesPerSample: 64, maxSampledTexturesPerShaderStage: 16, maxColorAttachments: 8 };
let r = evaluateWebGpuLimits(good, []);
ok('all pass', r.requiredOk && r.missing.length === 0);
ok('exact minimums pass', evaluateWebGpuLimits({ ...REQUIRED_LIMITS }).requiredOk);

for (const name of Object.keys(REQUIRED_LIMITS)) {
  r = evaluateWebGpuLimits({ ...good, [name]: REQUIRED_LIMITS[name] - 1 });
  ok(`${name} short fails`, !r.requiredOk && r.missing.length === 1 && r.missing[0].startsWith(name), JSON.stringify(r));
}
r = evaluateWebGpuLimits({ ...good, maxColorAttachmentBytesPerSample: 32 });
ok('default 32 B is short', !r.requiredOk);
r = evaluateWebGpuLimits({});
ok('empty limits: all 3 missing', !r.requiredOk && r.missing.length === 3);
r = evaluateWebGpuLimits(null);
ok('no adapter', !r.requiredOk && r.missing[0] === 'no adapter');

// probeWebGpu with fakes
let p = await probeWebGpu({ navigatorGpu: null });
ok('probe: no navigator.gpu', !p.available && !p.requiredOk);
p = await probeWebGpu({ navigatorGpu: { requestAdapter: async () => null } });
ok('probe: null adapter', !p.available && p.missing[0] === 'no adapter');
p = await probeWebGpu({ navigatorGpu: { requestAdapter: async () => ({
  info: { vendor: 'v', architecture: 'a', description: 'd' }, isFallbackAdapter: true,
  features: new Set(['timestamp-query']), limits: { ...good, maxBindGroups: 4 },
}) } });
ok('probe: fake adapter ok', p.available && p.requiredOk && p.adapter.vendor === 'v' && p.adapter.fallback
  && p.features[0] === 'timestamp-query' && p.limits.maxBindGroups === 4);

console.log(`webgpuProbe.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error('FAIL:', f); process.exit(1); }
