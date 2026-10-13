import assert from 'node:assert/strict';
import { GLOW_LEVELS } from '../../engine/index.js';
import { parseGlow } from './glowOpt.js';
// knob: Low/Medium off, High/Ultra on, ?emissive= override, every gpucompare mode off except `emissive`
const q = (s, l) => parseGlow(new URLSearchParams(s), l);
assert.equal(q('', 'low'), null); assert.equal(q('', 'medium'), null); assert.equal(q('', 'high'), GLOW_LEVELS.high); assert.equal(q('', 'ultra').radius, 2);
assert.equal(q('emissive=off', 'ultra'), null); assert.equal(q('emissive=derived', 'high'), null); assert.equal(q('emissive=full', 'low'), GLOW_LEVELS.high);
assert.equal(q('gpucompare=1', 'high'), null); assert.equal(q('gpucompare=emissive', 'low'), GLOW_LEVELS.high);

console.log('glowOpt.test.js ok');
