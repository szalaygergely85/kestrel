import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { parseArgs, STILLS, stillTimes, stillName, pageUrl, contactSheetHtml, captureAll } from './capture-combat.mjs';

const d = parseArgs(['--port', '9500']);
assert.deepEqual([d.backend, d.grids, d.out], ['webgpu', ['240x90', '400x150'], 'docs/test-reports/combat-capture']);
const o = parseArgs(['--port', '9510', '--backend', 'webgl2', '--grids', '240x90', '--out', 'x']);
assert.deepEqual([o.port, o.backend, o.grids, o.out], [9510, 'webgl2', ['240x90'], 'x']);
assert.throws(() => parseArgs([])); assert.throws(() => parseArgs(['--port', '9500', '--grids', 'abc']));
assert.throws(() => parseArgs(['--port', '9500', '--backend', 'gl'])); assert.throws(() => parseArgs(['--port', '9500', '--x']));
assert.deepEqual(stillTimes(), [0, 500, 1500, 2500]);
assert.equal(stillName('240x90', 'idle-8m'), 'combat-240x90-idle-8m.png');
assert.equal(pageUrl(9500, '240x90', 'webgpu'), 'http://127.0.0.1:9500/game/index.html?bench=combat&grid=240x90&backend=webgpu');
const out = mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
try {
  const calls = [];
  const files = await captureAll({ out, grids: d.grids, backend: 'webgpu' }, async (g, s) => { calls.push([g, s.slug]); return Buffer.from('png'); });
  assert.equal(calls.length, 8);
  assert.equal(files.length, 9);
  assert.deepEqual(readdirSync(out).sort(), [...files].sort());
  const html = readFileSync(path.join(out, 'index.html'), 'utf8');
  for (const g of d.grids) for (const s of STILLS) assert.ok(html.includes(`src="${stillName(g, s.slug)}"`), g + s.slug);
  assert.equal((html.match(/<img /g) || []).length, 8);
  assert.equal(contactSheetHtml(['240x90'], 'webgpu').match(/<img /g).length, 4);
} finally { rmSync(out, { recursive: true, force: true }); }
console.log('capture-combat tests PASS');
