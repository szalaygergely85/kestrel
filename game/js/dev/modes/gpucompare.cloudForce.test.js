// S8-B2-12a NEEDS B1 item (3): gpucompare.js must force cloud strength 0 in every mode, so a page loaded with
// `?clouds=1&gpucompare=1` never shows clouds in the parity reference. gpucompare.js pulls in DOM/engine modules
// that don't run under plain Node, so this checks the *static source contract* instead: every `lights.update(0,
// world)` call site (the per-pose render hook every mode shares) is immediately followed by a `setCloudShadow(lights,
// { strength: 0 })` call - see main.js's own NEEDS B1 item (2)/(3) wiring for the counterpart.
// S8-B2-20 NEEDS B1 item (3): same contract for horizon AO - `lights.ao = null` right after
// the cloud force-0 call, at every one of those same sites.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, 'gpucompare.js'), 'utf8');

assert.ok(!/setCloudShadow/.test(src), "setCloudShadow is gone (S8-B2-12c)");
assert.ok(!/setHorizonAo/.test(src), 'setHorizonAo is gone (S8-B2-20b)');

const updateCalls = src.match(/if \(lights\) lights\.update\(0, world\);/g) || [];
assert.ok(updateCalls.length >= 2, `expected at least 2 "lights.update(0, world)" call sites, found ${updateCalls.length}`);

// Every "if (lights) lights.update(0, world);" must be immediately followed (same or next line) by the force-0 call.
const pattern = /if \(lights\) lights\.update\(0, world\);\s*\n\s*if \(lights\) lights\.cloud = null;/g;
const forcedCalls = src.match(pattern) || [];
assert.strictEqual(forcedCalls.length, updateCalls.length,
  `every "lights.update(0, world)" site must be followed by "lights.cloud = null" ` +
  `(found ${updateCalls.length} update sites, ${forcedCalls.length} paired force-0 calls)`);

// S8-B2-20: the ao force-0 call must immediately follow the cloud force-0 call at every site.
const aoPattern = /if \(lights\) lights\.cloud = null;[^\n]*\n\s*if \(lights\) lights\.ao = null;/g;
const aoForcedCalls = src.match(aoPattern) || [];
assert.strictEqual(aoForcedCalls.length, updateCalls.length,
  `every "lights.cloud = null" site must be followed by "lights.ao = null" ` +
  `(found ${updateCalls.length} update sites, ${aoForcedCalls.length} paired ao force-0 calls)`);

console.log('PASS gpucompare.cloudForce.test.js');
