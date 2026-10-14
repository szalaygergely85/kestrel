// EDITOR-PATH-SMOKE: runs tools/verify-editor-path.mjs twice; exit 0, one line per module, identical output both times.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./verify-editor-path.mjs', import.meta.url));
const run = () => spawnSync(process.execPath, ['--no-warnings', script], { encoding: 'utf8' });
const a = run(), b = run();
assert.equal(a.status, 0, a.stdout + a.stderr);
const lines = a.stdout.trim().split('\n');
assert.equal(lines.length, 6, a.stdout);
for (const m of ['quest', 'archetypes', 'logic', 'foliage', 'grass']) assert.ok(lines.some((l) => l.startsWith(`OK   ${m}:`)), `${m} line`);
assert.equal(a.stdout, b.stdout, 'same output twice');
console.log('verify-editor-path: all ok');
