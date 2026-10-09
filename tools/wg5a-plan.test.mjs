#!/usr/bin/env node
// Fixture test for tools/wg5a-plan.mjs (S8-B1-19). Builds a tiny temp tree,
// runs planWg5a() against it directly (no spawn needed - it's a plain
// function), and checks the reachable/unreachable classification plus that
// no fixture file is modified by calling it. Run with:
//
//   node tools/wg5a-plan.test.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeOk } from '../engine/test/assert.js';
import { planWg5a } from './wg5a-plan.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0;
let fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg5a-plan-fixture-'));

// Delete-candidate: glsl/foo.frag.js, imported both by the (candidate)
// GpuCellPipeline.js AND by a kept WebGPU-path file -> STILL REACHABLE.
writeFile(tmp, 'engine/render/gpu/glsl/foo.frag.js', `export const FOO = 1;\n`);
writeFile(tmp, 'engine/render/gpu/GpuCellPipeline.js', `import { FOO } from './glsl/foo.frag.js';\nimport { GRID } from './gridTargets.js';\nexport const PIPE = FOO + GRID;\n`);
writeFile(tmp, 'engine/render/gpu/wgsl/bar.wgsl.js', `import { FOO } from '../glsl/foo.frag.js';\nexport const BAR = FOO;\n`);

// Delete-candidate: gridTargets.js, only imported by another candidate
// (GpuCellPipeline.js) -> clear to delete.
writeFile(tmp, 'engine/render/gpu/gridTargets.js', `export const GRID = 2;\n`);

// Delete-candidate: glUtil.js, no importers at all -> clear to delete.
writeFile(tmp, 'engine/render/gpu/glUtil.js', `export const UTIL = 3;\n`);

// Delete-candidate: spritesPass.js, imported directly by game/js/main.js ->
// STILL REACHABLE, tagged as an anchor-file importer.
writeFile(tmp, 'engine/render/gpu/spritesPass.js', `export const SPRITES = 4;\n`);
writeFile(tmp, 'game/js/main.js', `import { SPRITES } from '../../engine/render/gpu/spritesPass.js';\nexport const main = SPRITES;\n`);

const FIXTURE_CANDIDATES = [
  ['engine/render/gpu/glsl/foo.frag.js', 'delete', ''],
  ['engine/render/gpu/GpuCellPipeline.js', 'delete', ''],
  ['engine/render/gpu/gridTargets.js', 'delete', ''],
  ['engine/render/gpu/glUtil.js', 'delete', ''],
  ['engine/render/gpu/spritesPass.js', 'mixed', ''],
];

// Snapshot every fixture file's content + mtime before running the plan.
function snapshot(root) {
  const out = new Map();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.set(full, fs.readFileSync(full, 'utf8'));
    }
  }
  walk(root);
  return out;
}

const before = snapshot(tmp);
const results = planWg5a(tmp, FIXTURE_CANDIDATES);
const after = snapshot(tmp);

const byFile = new Map(results.map((r) => [r.file, r]));

ok('foo.frag.js should be STILL REACHABLE (imported by wgsl/bar.wgsl.js)', byFile.get('engine/render/gpu/glsl/foo.frag.js').reachable === true);
ok('foo.frag.js reachability should be tagged as coming from the WebGPU path', byFile.get('engine/render/gpu/glsl/foo.frag.js').webgpuImporters.includes('engine/render/gpu/wgsl/bar.wgsl.js'));

ok('GpuCellPipeline.js should be clear to delete (no importers outside the candidate set)', byFile.get('engine/render/gpu/GpuCellPipeline.js').reachable === false);

ok('gridTargets.js should be clear to delete (only importer, GpuCellPipeline.js, is itself a candidate)', byFile.get('engine/render/gpu/gridTargets.js').reachable === false);

ok('glUtil.js should be clear to delete (no importers at all)', byFile.get('engine/render/gpu/glUtil.js').reachable === false);

ok('spritesPass.js should be STILL REACHABLE (imported by game/js/main.js)', byFile.get('engine/render/gpu/spritesPass.js').reachable === true);
ok('spritesPass.js reachability should be tagged as coming from game/js/main.js', byFile.get('engine/render/gpu/spritesPass.js').anchorImporters.includes('game/js/main.js'));

// No file was modified or created by planWg5a().
ok('planWg5a() must not create or delete any fixture file', before.size === after.size);
let anyChanged = false;
for (const [file, content] of before) {
  if (after.get(file) !== content) anyChanged = true;
}
ok('planWg5a() must not modify the content of any fixture file', anyChanged === false);

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`${pass} passed, ${fail} failed`);
if (failures.length) {
  for (const m of failures) console.error(`  FAIL: ${m}`);
  process.exit(1);
}
