#!/usr/bin/env node
// Fixture test for tools/check-deps.mjs (US-024, +US-047 rule 7): builds a
// temp tree with one deliberate violation of each rule (docs/architecture.md
// section 3, 5 and 24.2) plus clean control files, runs the checker's logic
// against it (by spawning the real script via child_process against a temp
// ROOT), and checks each expected finding appears. Run with:
//
//   node tools/check-deps.test.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(__dirname, 'check-deps.mjs');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  }
}

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-deps-fixture-'));

// Rule 1: engine file with a bare specifier + one that resolves outside engine/.
writeFile(tmp, 'engine/render/bad1.js', `import fs from 'node:fs';\nimport { x } from '../../game/js/helper.js';\nexport const y = 1;\n`);
// Rule 2: engine file reading a forbidden global.
writeFile(tmp, 'engine/core/bad2.js', `export function f() { return window.ASSETS.palette; }\n`);
// Rule 3: game file deep-importing engine/.
writeFile(tmp, 'game/js/bad3.js', `import { Level } from '../../engine/world/Level.js';\nexport const z = Level;\n`);
// Rule 4: design file with an import/export statement.
writeFile(tmp, 'design/bad4.js', `export const a = 1;\n`);
// Rule 5: JSDoc import(...) inside a comment must NOT be flagged (control, engine/).
writeFile(tmp, 'engine/render/good_jsdoc.js', `/** @param {import('./RenderTarget.js').RenderTarget} rt */\nexport function f(rt) { return rt; }\n`);
// Rule 6: tools/editor/** file importing something from game/.
writeFile(tmp, 'tools/editor/bad6.js', `import { helper } from '../../game/js/helper.js';\nexport const q = helper;\n`);
// Rule 7 (US-047): engine/dev.js import from an ALLOWED path (game/js/dev/**,
// game/js/main.js, tools/** outside tools/editor/**) must NOT be flagged.
writeFile(tmp, 'game/js/dev/good7a.js', `import { DEV_OK } from '../../../engine/dev.js';\nexport const r = DEV_OK;\n`);
writeFile(tmp, 'game/js/main.js', `import { DEV_OK } from '../../engine/dev.js';\nexport const s = DEV_OK;\n`);
writeFile(tmp, 'tools/bench-good7.mjs', `import { DEV_OK } from '../engine/dev.js';\nexport const t = DEV_OK;\n`);
// Rule 7 (US-047): engine/dev.js import from a DISALLOWED path (game/js/quest/**,
// game/js/ui/**, tools/editor/**) must be a finding.
writeFile(tmp, 'game/js/quest/bad7.js', `import { DEV_OK } from '../../../engine/dev.js';\nexport const u = DEV_OK;\n`);
writeFile(tmp, 'game/js/ui/bad7b.js', `import { DEV_OK } from '../../../engine/dev.js';\nexport const v = DEV_OK;\n`);
writeFile(tmp, 'tools/editor/bad7c.js', `import { DEV_OK } from '../../engine/dev.js';\nexport const x = DEV_OK;\n`);
// Control: a fully clean engine file and a clean game file (importing index.js only).
writeFile(tmp, 'engine/index.js', `export const OK = 1;\n`);
writeFile(tmp, 'engine/dev.js', `export const DEV_OK = 1;\n`);
writeFile(tmp, 'game/js/good.js', `import { OK } from '../../engine/index.js';\nexport const w = OK;\n`);
writeFile(tmp, 'tools/editor/good.js', `import { OK } from '../../engine/index.js';\nexport const p = OK;\n`);

let output = '';
let exitCode = 0;
try {
  output = execFileSync(process.execPath, [CHECKER], { cwd: tmp, encoding: 'utf8' });
} catch (err) {
  exitCode = err.status;
  output = (err.stdout || '') + (err.stderr || '');
}

ok('exits non-zero when violations exist', exitCode !== 0, `exitCode=${exitCode}`);
ok('rule 1: bare specifier flagged', /bad1\.js.*bare specifier "node:fs"/.test(output), output);
ok('rule 1: outside-engine import flagged', /bad1\.js.*resolves outside engine\//.test(output), output);
ok('rule 2: forbidden global flagged', /bad2\.js.*window\.ASSETS/.test(output), output);
ok('rule 3: deep import flagged', /bad3\.js.*deep import/.test(output), output);
ok('rule 4: design import\/export flagged', /bad4\.js.*design\/ must stay classic scripts/.test(output), output);
ok('rule 5: JSDoc import(...) NOT flagged', !/good_jsdoc\.js/.test(output), output);
ok('rule 6: editor importing game/ flagged', /bad6\.js.*must not depend on game\//.test(output), output);
ok('rule 7: dev.js import from game/js/dev/** NOT flagged', !/good7a\.js/.test(output), output);
ok('rule 7: dev.js import from game/js/main.js NOT flagged', !/main\.js:.*engine\/dev\.js/.test(output), output);
ok('rule 7: dev.js import from tools/** (outside editor) NOT flagged', !/bench-good7\.mjs/.test(output), output);
ok('rule 7: dev.js import from game/js/quest/** flagged', /bad7\.js.*engine\/dev\.js.*only game\/js\/dev/.test(output), output);
ok('rule 7: dev.js import from game/js/ui/** flagged', /bad7b\.js.*engine\/dev\.js.*only game\/js\/dev/.test(output), output);
ok('rule 7: dev.js import from tools/editor/** flagged', /bad7c\.js.*engine\/dev\.js.*only game\/js\/dev/.test(output), output);
ok('control good.js NOT flagged', !/[^_]good\.js:/.test(output), output);

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
