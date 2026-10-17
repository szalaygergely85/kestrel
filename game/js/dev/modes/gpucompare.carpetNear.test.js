// OB-121b: the gpucompare `carpetNear` row is listed once, pitch -35, carpet ON with the underlay, and sits next to carpetMeadow.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('./gpucompare.js', import.meta.url), 'utf8');
assert.strictEqual((src.match(/name: 'world_m1: carpetNear /g) || []).length, 1, 'one carpetNear row');
const i = src.indexOf("name: 'world_m1: carpetNear ");
const row = src.slice(i, i + 1300);
assert.ok(/pitchDeg: -35 \}/.test(row) && /carpet: true/.test(row) && /underlay: 0\.6/.test(row), 'pitch -35, carpet on, underlay 0.6');
assert.ok(/meshOnly: true/.test(row) && !/Math\.random|Date\.now|performance\.now/.test(row), 'mesh only, deterministic');
assert.ok(src.indexOf("name: 'world_m1: carpetMeadow ") < i, 'listed after carpetMeadow (the baseline row order of existing rows is unchanged)');
console.log('PASS gpucompare.carpetNear.test.js');
