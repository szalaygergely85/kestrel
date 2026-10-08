import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPresets, resolveQuality } from './ui/gfxPresets.js';
import { resolveBootOptions, describeQuality } from './gfxBoot.js';
import { resolveShadowLevel } from '../../engine/index.js';

await loadPresets(JSON.parse(readFileSync(new URL('../../content/settings/gfx-presets.json', import.meta.url))));
const warn = () => {};
const boot = (query, { saved = {}, auto = null, captureLike = false, geometryCompare = false, noPresets = false } = {}) => {
  const params = new URLSearchParams(query);
  const resolved = noPresets ? null : resolveQuality({ param: params, saved: { quality: saved.quality, shadowQuality: saved.shadowQuality }, auto, warn });
  return resolveBootOptions({ params, resolved, savedSettings: { grid: '240x90', ...saved }, captureLike, geometryCompare, defaultCols: 240, shadowLevel: resolveShadowLevel, warn });
};

// default = high (400x150, rays 2, today's instCastM 32), source 'default'
let o = boot('');
assert.deepEqual([o.reqCols, o.reqRows, o.rays], [400, 150, 2]);
assert.equal(o.quality.name, 'high'); assert.equal(o.quality.source, 'default');
assert.equal(o.shadowOpts.sun, 'map'); assert.equal(o.shadowOpts.instCastM, 32); assert.equal(o.shadowOpts.res, 2048);
assert.deepEqual(o.gfx, { scatterDensity: 1, lodScale: 1 });

// every preset
const expect = { low: [240, 90, 1, 1024, 0.5, 0.6], medium: [240, 90, 2, 1536, 0.75, 0.8], high: [400, 150, 2, 2048, 1, 1], ultra: [480, 180, 4, 2048, 1, 1.25] };
for (const [name, [c, r, rays, res, sc, lod]] of Object.entries(expect)) {
  o = boot(`quality=${name}`);
  assert.deepEqual([o.reqCols, o.reqRows, o.rays, o.shadowOpts.res, o.gfx.scatterDensity, o.gfx.lodScale], [c, r, rays, res, sc, lod], name);
  assert.equal(o.quality.source, 'param');
}

// precedence: URL knob > ?quality > saved > auto > default
assert.equal(boot('', { saved: { quality: 'low' }, auto: 'ultra' }).quality.name, 'low');
assert.equal(boot('', { auto: 'ultra' }).quality.name, 'ultra');
assert.equal(boot('quality=medium', { saved: { quality: 'low' } }).quality.name, 'medium');
o = boot('quality=low&grid=320x120&rays=4&scatter=0.25&lodScale=2&shadows=dda');
assert.deepEqual([o.reqCols, o.reqRows, o.rays, o.gfx.scatterDensity, o.gfx.lodScale, o.shadowOpts.sun], [320, 120, 4, 0.25, 2, 'dda']);
assert.equal(boot('quality=high&shadows=off').shadowOpts.sun, 'off');
assert.equal(boot('quality=high&shadowQuality=off').shadowOpts.sun, 'off');
assert.equal(boot('quality=low&shadowinst=10').shadowOpts.meshLod0M, 10);
assert.equal(boot('', { saved: { quality: 'high', shadowQuality: 'mid' } }).shadowOpts.res, 1536);
// dev grids / odd rays stay legal URL values (today's behaviour)
o = boot('grid=160x60&rays=3'); assert.deepEqual([o.reqCols, o.reqRows, o.rays], [160, 60, 3]);
// invalid values fall back
o = boot('quality=nope&rays=9&grid=abc&scatter=5'); assert.equal(o.quality.name, 'high'); assert.deepEqual([o.reqCols, o.rays, o.gfx.scatterDensity], [400, 2, 1]);
// legacy non-default saved grid survives while no quality is chosen
assert.equal(boot('', { saved: { grid: '320x120' } }).reqCols, 320);
assert.equal(boot('', { saved: { grid: '320x120', quality: 'low' } }).reqCols, 240);
// gpucompare forces its grid/rays; capture pages keep today's options unless ?quality=
o = boot('gpucompare=1', { captureLike: true, geometryCompare: true }); assert.deepEqual([o.reqCols, o.reqRows, o.rays], [160, 60, 1]);
o = boot('bench=1', { captureLike: true, saved: { quality: 'ultra', grid: '480x180' } });
assert.deepEqual([o.reqCols, o.reqRows, o.rays, o.quality, o.gfx], [240, undefined, 2, null, undefined]);
assert.equal(boot('bench=1&quality=low', { captureLike: true }).rays, 1);
// presets missing = today's boot options
o = boot('', { noPresets: true }); assert.deepEqual([o.reqCols, o.rays, o.quality, o.gfx, o.shadowOpts], [240, 2, null, undefined, { sun: 'map', instCastM: 32 }]);
o = boot('', { noPresets: true, saved: { grid: '400x150' } }); assert.equal(o.reqCols, 400);
o = boot('shadows=dda&rays=4', { noPresets: true }); assert.deepEqual([o.shadowOpts.sun, o.rays], ['dda', 4]);
// F3 line
assert.match(describeQuality(boot('quality=low'), 240, 90, 1), /^quality: low \(param\)  grid 240x90  rays 1  shadows low  scatter 0.5  lodScale 0.6$/);
console.log('gfxBoot.test.js ok');
