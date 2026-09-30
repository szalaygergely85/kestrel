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
import { makeOk } from '../engine/test/assert.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(__dirname, 'check-deps.mjs');

let pass = 0;
let fail = 0;
const failures = [];

const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

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
// Rule 8 (US-050): a *.test.js/*.test.mjs file may import engine/test/assert.js
// (including inside tools/editor/**) - a non-test file may NOT.
writeFile(tmp, 'game/js/quest/good8.test.js', `import { makeOk } from '../../../engine/test/assert.js';\nexport const ok8 = makeOk;\n`);
writeFile(tmp, 'tools/editor/good8.test.mjs', `import { makeOk } from '../../engine/test/assert.js';\nexport const ok8b = makeOk;\n`);
writeFile(tmp, 'game/js/quest/bad8.js', `import { makeOk } from '../../../engine/test/assert.js';\nexport const ok8c = makeOk;\n`);
// Rule 9 (ME-03b): engine/render/gpu/** touching gl./WebGL2RenderingContext/
// navigator.gpu outside device/* is a WARNING (own "WARN ..." line, not a
// FAIL-exit finding); device/* itself and *.test.js are exempt.
writeFile(tmp, 'engine/render/gpu/bad9.js', `export function f(gl) { return gl.createTexture(); }\n`);
writeFile(tmp, 'engine/render/gpu/device/good9.js', `export function f(gl) { return gl.createTexture(); }\n`);
writeFile(tmp, 'engine/render/gpu/bad9.test.js', `export function f(gl) { return gl.createTexture(); }\n`);
// Rule 13 (CO-1b): coordinate math outside transform.js WARNs; allow-listed file does not.
writeFile(tmp, 'engine/entities/bad13.js', `export const f = (a, dx, dy) => Math.atan2(dx, -dy) + a * Math.PI / 180 + a.origin.x + 1;\n`);
writeFile(tmp, 'engine/render/sectorCaster.js', `export const g = (s) => 1 + s.origin.x;\n`);
writeFile(tmp, 'engine/world/marked13.js', `export const g = (s) => 1 + s.origin.x; // coord-ok\nexport const h = (s) => 1 + s.origin.y;\n`);
// Rule 14 (RE-05): engine/nav/** is a leaf module.
writeFile(tmp, 'engine/nav/bad14a.js', `import { Terrain } from '../world/Terrain.js';\nexport const a1 = Terrain;\n`);
writeFile(tmp, 'engine/nav/good14a.js', `import { IndexHeap } from './heap.js';\nimport { DEG2RAD } from '../core/transform.js';\nexport const a2 = [IndexHeap, DEG2RAD];\n`);
writeFile(tmp, 'engine/nav/heap.js', `export class IndexHeap {}\n`);
writeFile(tmp, 'engine/core/transform.js', `export const DEG2RAD = 1;\n`);
writeFile(tmp, 'engine/nav/good14b.test.js', `import { Terrain } from '../world/Terrain.js';\nimport { makeOk } from '../test/assert.js';\nexport const a3 = [Terrain, makeOk];\n`);
writeFile(tmp, 'engine/nav/bad14b.test.js', `import { drawSprites } from '../render/sprites.js';\nexport const a4 = drawSprites;\n`);
writeFile(tmp, 'engine/world/Terrain.js', `export class Terrain {}\n`);
writeFile(tmp, 'engine/render/bad14c.js', `import { NavGrid } from '../nav/NavGrid.js';\nexport const a5 = NavGrid;\n`);
writeFile(tmp, 'engine/mesh/bad14d.js', `import { NavGrid } from '../nav/NavGrid.js';\nexport const a6 = NavGrid;\n`);
writeFile(tmp, 'engine/ui/bad14e.js', `import { NavGrid } from '../nav/NavGrid.js';\nexport const a7 = NavGrid;\n`);
writeFile(tmp, 'engine/world/bad14f.js', `import { NavGrid } from '../nav/NavGrid.js';\nexport const a8 = NavGrid;\n`);
writeFile(tmp, 'engine/render/good14.js', `export const a9 = 1;\n`);
writeFile(tmp, 'engine/nav/NavGrid.js', `export class NavGrid {}\n`);

// Rule 15 (RE-14): deterministic-sim leaves WARN on Math.random/Date.now/
// performance.now/trig - engine/nav/**, engine/core/{commands,rng,hash,
// replay}.js, engine/world/Visibility.js, game/js/rts/sim/**.
writeFile(tmp, 'engine/nav/bad15.js', `export function f(x) { return Math.random() + Math.sin(x); }\n`);
writeFile(tmp, 'engine/nav/good15.js', `export function f(x, y) { return Math.sqrt(x * x + y * y); }\n`);
writeFile(tmp, 'engine/nav/bad15.test.js', `export function f() { return Math.random(); }\n`); // test file: exempt
writeFile(tmp, 'engine/core/rng.js', `export function f() { return Date.now(); }\n`);
writeFile(tmp, 'engine/core/hash.js', `export function f(a) { return Math.pow(a, 2); }\n`);
writeFile(tmp, 'engine/core/commands.js', `export function f() { return performance.now(); }\n`);
writeFile(tmp, 'engine/core/replay.js', `export function f(x) { return Math.atan2(x, -x); }\n`);
writeFile(tmp, 'engine/core/good15.js', `export function f() { return Date.now(); }\n`); // NOT in scope: wrong filename
writeFile(tmp, 'engine/world/Visibility.js', `export function f() { return Math.hypot(1, 2); }\n`);
writeFile(tmp, 'game/js/rts/sim/bad15.js', `export function f() { return Math.random(); }\n`);
writeFile(tmp, 'game/js/rts/ui/good15.js', `export function f() { return Math.random(); }\n`); // ui/, not sim/: NOT in scope

// Control: a fully clean engine file and a clean game file (importing index.js only).
writeFile(tmp, 'engine/index.js', `export const OK = 1;\n`);
writeFile(tmp, 'engine/dev.js', `export const DEV_OK = 1;\n`);
writeFile(tmp, 'engine/test/assert.js', `export function makeOk() {}\n`);
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
ok('rule 8: engine/test/assert.js import from a game .test.js NOT flagged', !/good8\.test\.js/.test(output), output);
ok('rule 8: engine/test/assert.js import from a tools/editor .test.mjs NOT flagged', !/good8\.test\.mjs/.test(output), output);
ok('rule 8: engine/test/assert.js import from a non-test file flagged', /bad8\.js.*deep import/.test(output), output);
ok('rule 9: gpu file touching gl. outside device/* WARNs (not a FAIL finding)', /WARN.*bad9\.js.*gl\.\*/.test(output), output);
ok('rule 9: gpu/device/* file touching gl. NOT flagged', !/good9\.js/.test(output), output);
ok('rule 9: gpu *.test.js touching gl. NOT flagged', !/bad9\.test\.js/.test(output), output);
ok('rule 13: coordinate math WARNs (atan2, PI/180, origin)', /WARN.*bad13\.js.*atan2/.test(output) && /WARN.*bad13\.js.*Math\.PI/.test(output) && /WARN.*bad13\.js.*origin/.test(output), output);
ok('rule 13: allow-listed sectorCaster.js NOT flagged', !/sectorCaster\.js.*origin/.test(output), output);
ok('rule 13: // coord-ok line skipped, unmarked line still WARNs', /WARN.*marked13\.js:2:.*origin/.test(output) && !/marked13\.js:1:/.test(output), output);
ok('rule 13: warning only, no FAIL finding for it', !/bad13\.js:\d+: (?!coordinate)/.test(output.replace(/WARN [^\n]*/g,'')), output);
ok('rule 14: nav non-test importing world/ flagged', /bad14a\.js.*non-test.*may only import engine\/nav.*engine\/core/.test(output), output);
ok('rule 14: nav non-test importing nav+core NOT flagged', !/good14a\.js/.test(output), output);
ok('rule 14: nav test importing world+assert NOT flagged', !/good14b\.test\.js/.test(output), output);
ok('rule 14: nav test importing render/ flagged', /bad14b\.test\.js.*may only import engine\/nav.*engine\/world.*engine\/test/.test(output), output);
ok('rule 14: render importing nav/ flagged', /bad14c\.js.*must not import engine\/nav/.test(output), output);
ok('rule 14: mesh importing nav/ flagged', /bad14d\.js.*must not import engine\/nav/.test(output), output);
ok('rule 14: ui importing nav/ flagged', /bad14e\.js.*must not import engine\/nav/.test(output), output);
ok('rule 14: world importing nav/ flagged', /bad14f\.js.*must not import engine\/nav/.test(output), output);
ok('rule 14: unrelated render file NOT flagged', !/[^d]good14\.js/.test(output), output);
ok('control good.js NOT flagged', !/[^_]good\.js:/.test(output), output);
ok('rule 15: nav Math.random+Math.sin WARNs', /WARN.*bad15\.js:1:.*Math\.random/.test(output) && /WARN.*bad15\.js:1:.*Math\.sin/.test(output), output);
ok('rule 15: nav Math.sqrt NOT flagged', !/good15\.js/.test(output), output);
ok('rule 15: nav *.test.js exempt (no WARN)', !/bad15\.test\.js/.test(output), output);
ok('rule 15: engine/core/rng.js Date.now WARNs', /WARN.*core\/rng\.js:1:.*Date\.now/.test(output), output);
ok('rule 15: engine/core/hash.js Math.pow WARNs', /WARN.*core\/hash\.js:1:.*Math\.pow/.test(output), output);
ok('rule 15: engine/core/commands.js performance.now WARNs', /WARN.*core\/commands\.js:1:.*performance\.now/.test(output), output);
ok('rule 15: engine/core/replay.js Math.atan2 WARNs', /WARN.*core\/replay\.js:1:.*Math\.atan2/.test(output), output);
ok('rule 15: engine/core file NOT in the four-name allowlist NOT flagged', !/core\/good15\.js/.test(output), output);
ok('rule 15: engine/world/Visibility.js Math.hypot WARNs', /WARN.*world\/Visibility\.js:1:.*Math\.hypot/.test(output), output);
ok('rule 15: game/js/rts/sim/** Math.random WARNs', /WARN.*rts\/sim\/bad15\.js:1:.*Math\.random/.test(output), output);
ok('rule 15: game/js/rts/ui/** (not sim/) NOT flagged', !/rts\/ui\/good15\.js/.test(output), output);

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
