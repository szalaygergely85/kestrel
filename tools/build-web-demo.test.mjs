// Node test: web-demo file selection (US-112).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { shouldShipWeb, selectFiles, crc32, stripOptionalScripts } from './build-web-demo.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(shouldShipWeb('game/index.html'));
assert.ok(shouldShipWeb('game/js/main.js'));
assert.ok(!shouldShipWeb('game/world-test.html'), 'dev page');
assert.ok(!shouldShipWeb('game/js/main.test.js'), 'tests');
assert.ok(!shouldShipWeb('tools/editor/index.html'), 'editor');
assert.ok(!shouldShipWeb('docs/backlog.md'));
assert.ok(!shouldShipWeb('content/local/placements.json'), 'overlay');
assert.ok(!shouldShipWeb('design/local/x.png'));
assert.ok(!shouldShipWeb('design/preview/a.html'));
assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repo, maxBuffer: 1 << 28 }).toString().split('\0').filter(Boolean);
const sel = new Set(selectFiles(tracked));
assert.ok(sel.has('game/index.html'));
assert.ok([...sel].every(f => tracked.includes(f)), 'only tracked files');
assert.ok(![...sel].some(f => /\.test\.|^tools\/|^docs\/(?!licence-inventory\.json$)/.test(f)), 'no tests/tools/docs');
// every <script src> of index.html and every static relative import reachable from main.js is in the selection
const html = stripOptionalScripts(fs.readFileSync(path.join(repo, 'game/index.html'), 'utf8'), sel);
assert.ok(!/<script[^>]*design[/]local/.test(html), 'optional local script stripped');
const missing = [];
for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
  const rel = path.posix.normalize(path.posix.join('game', m[1]));
  if (!sel.has(rel)) missing.push(rel);
}
const seen = new Set(), stack = ['game/js/main.js'];
const re = /(?:^|\n)\s*(?:import|export)\b[^'"\n;]*?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g;
while (stack.length) {
  const f = stack.pop(); if (seen.has(f)) continue; seen.add(f);
  if (!sel.has(f)) { missing.push(f); continue; }
  const src = fs.readFileSync(path.join(repo, f), 'utf8');
  for (const m of src.matchAll(re)) stack.push(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1] || m[2])));
}
assert.deepEqual(missing, [], 'unresolved imports: ' + missing.join(', '));
console.log(`build-web-demo ok (${sel.size} files, ${seen.size} modules reachable from main.js)`);
