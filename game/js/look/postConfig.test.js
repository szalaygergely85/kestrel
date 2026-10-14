import assert from 'node:assert/strict';
import { GLOW_LEVELS, createPostState, composePost } from '../../../engine/index.js';
import { createRequire } from 'node:module';
const look = createRequire(import.meta.url)('../../../design/look/post.js');
import { resolvePost } from './postConfig.js';
const r = (s, l, sc) => resolvePost(look, new URLSearchParams(s), l, sc);
// preset table (outdoor): bloom / grade / vignette / mist
const want = { low: [0, 0, 1, 0], medium: [0, 1, 1, 0], high: [1, 1, 1, 0], ultra: [1, 1, 1, 0] };
for (const [l, w] of Object.entries(want)) {
  const c = r('', l);
  assert.deepEqual([!!c.bloom, !!c.grade, !!c.vignette, !!c.mist].map(Number), w, l);
}
assert.equal(r('', 'high').bloom, GLOW_LEVELS.high); assert.equal(r('', 'ultra').bloom.radius, GLOW_LEVELS.ultra.radius);
for (const l of ['low', 'medium', 'high', 'ultra']) assert.ok(r('', l, 'interior').mist, 'interior mist ' + l);
assert.equal(r('', 'extreme').bloom, GLOW_LEVELS.ultra);
// parameters never differ between presets
assert.equal(r('', 'medium').vignette, r('', 'ultra').vignette);
// ?post=0 = today's frames; gpucompare forces null; ?emissive= still works
assert.equal(r('post=0', 'ultra'), null); assert.equal(r('gpucompare=1', 'high'), null);
assert.ok(r('gpucompare=emissive', 'low').bloom); assert.equal(r('emissive=off', 'ultra').bloom, null);
assert.equal(r('emissive=full', 'low').bloom, GLOW_LEVELS.high);
// composePost accepts every resolved config; post null -> identity state
const st = createPostState();
for (const l of ['low', 'medium', 'high', 'ultra']) for (const sc of ['outdoor', 'interior']) composePost(null, r('', l, sc), st);
composePost(null, null, st); assert.ok(st.gradeId && !st.gradeOn && st.vig[3] === 0 && st.mist[3] === 0);
console.log('postConfig.test.js ok');
