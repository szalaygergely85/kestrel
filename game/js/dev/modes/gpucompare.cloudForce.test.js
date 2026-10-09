// S8-B2-12a NEEDS B1 item (3): gpucompare.js must force cloud strength 0 in every mode, so a page loaded with
// `?clouds=1&gpucompare=1` never shows clouds in the parity reference. gpucompare.js pulls in DOM/engine modules
// that don't run under plain Node, so this checks the *static source contract* instead: every `lights.update(0,
// world)` call site (the per-pose render hook every mode shares) is immediately followed by a `setCloudShadow(lights,
// { strength: 0 })` call - see main.js's own NEEDS B1 item (2)/(3) wiring for the counterpart.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, 'gpucompare.js'), 'utf8');

assert.match(src, /import\s*\{[^}]*\bsetCloudShadow\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/\.\.\/\.\.\/engine\/index\.js['"]/,
  'setCloudShadow must be imported from engine/index.js');

const updateCalls = src.match(/if \(lights\) lights\.update\(0, world\);/g) || [];
assert.ok(updateCalls.length >= 2, `expected at least 2 "lights.update(0, world)" call sites, found ${updateCalls.length}`);

// Every "if (lights) lights.update(0, world);" must be immediately followed (same or next line) by the force-0 call.
const pattern = /if \(lights\) lights\.update\(0, world\);\s*\n\s*if \(lights\) setCloudShadow\(lights, \{ strength: 0 \}\);/g;
const forcedCalls = src.match(pattern) || [];
assert.strictEqual(forcedCalls.length, updateCalls.length,
  `every "lights.update(0, world)" site must be followed by "setCloudShadow(lights, { strength: 0 })" ` +
  `(found ${updateCalls.length} update sites, ${forcedCalls.length} paired force-0 calls)`);

console.log('PASS gpucompare.cloudForce.test.js');
