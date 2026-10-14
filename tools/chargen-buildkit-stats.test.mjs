// CHARGEN-22c-FIX: `node tools/chargen-build-kit.mjs --check` prints per-level quad stats (AC "build-kit stats per level").
import { spawnSync } from 'node:child_process';
import assert from 'node:assert';
const r = spawnSync(process.execPath, ['tools/chargen-build-kit.mjs', '--check'], { encoding: 'utf8', cwd: new URL('..', import.meta.url) });
assert.strictEqual(r.status, 0, r.stderr);
const m = /per level: (.*)/.exec(r.stdout);
assert.ok(m, 'no "per level:" line');
const parts = m[1].split(' | ');
assert.ok(parts.length >= 1 && parts.every((p) => /^body \d+\/head \d+: \d+ quads$/.test(p)), 'bad stats: ' + m[1]);
console.log('chargen build-kit stats ok: ' + parts.join(' | '));
