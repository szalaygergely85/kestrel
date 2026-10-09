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
// Rule 18 (ED-WG-01c): tools/editor must not import GL-only modules.
writeFile(tmp, 'tools/editor/bad18.js', `import { GpuCellPipeline } from '../../engine/render/gpu/GpuCellPipeline.js';
import s from '../../engine/render/gpu/glsl/cast.js';
export const g = [GpuCellPipeline, s];
`);
writeFile(tmp, 'tools/editor/good18.js', `import { createRenderer } from '../../engine/index.js';
export const r = createRenderer;
`);
writeFile(tmp, 'tools/other18.js', `import { GpuCellPipeline } from '../../engine/render/gpu/GpuCellPipeline.js';
export const g = GpuCellPipeline;
`);
// Rule 17 (WG-1b2): WebGPU globals only under engine/render/gpu/device/.
writeFile(tmp, 'engine/render/gpu/device/good17.js', `export const a = navigator.gpu; export const b = GPUBufferUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUShaderStage.FRAGMENT | GPUMapMode.READ;
`);
writeFile(tmp, 'engine/render/gpu/bad17a.js', `export const a = navigator.gpu;
`);
writeFile(tmp, 'engine/render/bad17b.js', `export const b = GPUBufferUsage.COPY_DST;
export const c = GPUMapMode.READ;
`);
writeFile(tmp, 'engine/render/gpu/comment17.js', `// uses navigator.gpu and GPUTextureUsage only in a comment
export const x = 1;
`);
writeFile(tmp, 'game/js/bad17c.js', `export const d = GPUShaderStage.VERTEX;
`);
writeFile(tmp, 'game/js/bad17d.test.js', `export const e = navigator.gpu;
`);

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

// Rule 16 (US-053a): engine/fx/** is a leaf module; physics/nav may not import it; particles.js joins rule 15.
writeFile(tmp, 'engine/fx/heap16.js', `export const f1 = 1;
`);
writeFile(tmp, 'engine/fx/good16a.js', `import { f1 } from './heap16.js';
import { DEG2RAD } from '../core/transform.js';
export const f2 = [f1, DEG2RAD];
`);
writeFile(tmp, 'engine/fx/bad16a.js', `import { Terrain } from '../world/Terrain.js';
export const f3 = Terrain;
`);
writeFile(tmp, 'engine/fx/bad16b.js', `import { drawSprites } from '../render/sprites.js';
export const f4 = drawSprites;
`);
writeFile(tmp, 'engine/fx/good16b.test.js', `import { makeOk } from '../test/assert.js';
import { f1 } from './heap16.js';
export const f5 = [makeOk, f1];
`);
writeFile(tmp, 'engine/fx/bad16c.test.js', `import { Terrain } from '../world/Terrain.js';
export const f6 = Terrain;
`);
writeFile(tmp, 'engine/world/good16c.js', `import { f1 } from '../fx/heap16.js';
export const f7 = f1;
`);
writeFile(tmp, 'engine/render/good16d.js', `import { f1 } from '../fx/heap16.js';
export const f8 = f1;
`);
writeFile(tmp, 'engine/physics/bad16d.js', `import { f1 } from '../fx/heap16.js';
export const f9 = f1;
`);
writeFile(tmp, 'engine/nav/bad16e.js', `import { f1 } from '../fx/heap16.js';
export const f10 = f1;
`);
writeFile(tmp, 'engine/fx/particles.js', `export function f() { return Math.random() + Math.sin(1); }
`);
writeFile(tmp, 'engine/fx/emitterDef.js', `export function f() { return Math.tan(1); }
`); // load-time compile: NOT in rule 15

// Rule 19 (WILD-03): engine/fauna/** is a leaf (fauna, nav, core, entities/clipPlayer+gait; tests + engine/test).
writeFile(tmp, 'engine/fauna/good19a.js', `import { IndexHeap } from '../nav/heap.js';
import { createRng } from '../core/rng.js';
import { clipPlay } from '../entities/clipPlayer.js';
import { pickGait } from '../entities/gait.js';
import { g } from './sibling19.js';
export const q1 = [IndexHeap, createRng, clipPlay, pickGait, g];
`);
writeFile(tmp, 'engine/fauna/sibling19.js', `export const g = 1;
`);
writeFile(tmp, 'engine/entities/clipPlayer.js', `export function clipPlay() {}
`);
writeFile(tmp, 'engine/entities/gait.js', `export function pickGait() {}
`);
writeFile(tmp, 'engine/entities/Entity.js', `export class Entity {}
`);
writeFile(tmp, 'engine/core/rng.js', `export function createRng() {}
`);
writeFile(tmp, 'engine/fauna/bad19a.js', `import { Terrain } from '../world/Terrain.js';
export const q2 = Terrain;
`);
writeFile(tmp, 'engine/fauna/bad19b.js', `import { Entity } from '../entities/Entity.js';
export const q3 = Entity;
`);
writeFile(tmp, 'engine/fauna/good19b.test.js', `import { makeOk } from '../test/assert.js';
import { g } from './sibling19.js';
export const q4 = [makeOk, g];
`);
writeFile(tmp, 'engine/fauna/bad19c.test.js', `import { drawSprites } from '../render/sprites.js';
export const q5 = drawSprites;
`);
writeFile(tmp, 'engine/render/bad19d.js', `import { g } from '../fauna/sibling19.js';
export const q6 = g;
`);
writeFile(tmp, 'engine/world/bad19e.js', `import { g } from '../fauna/sibling19.js';
export const q7 = g;
`);

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
writeFile(tmp, 'game/js/quest/sim/bad15.js', `export function f() { return Math.random(); }\n`); // US-079a beast sim (29.1)
writeFile(tmp, 'game/js/quest/beastView.js', `export function f() { return Math.random(); }\n`); // quest/, not quest/sim/: NOT in scope

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
ok('rule 19: fauna importing nav+core+clipPlayer+gait+fauna NOT flagged', !/good19a\.js/.test(output), output);
ok('rule 19: fauna importing world/ flagged', /fauna\/bad19a\.js.*engine\/fauna.*rule 19/.test(output), output);
ok('rule 19: fauna importing other entities files flagged', /fauna\/bad19b\.js.*rule 19/.test(output), output);
ok('rule 19: fauna test importing fauna+test NOT flagged', !/good19b\.test\.js/.test(output), output);
ok('rule 19: fauna test importing render/ flagged', /bad19c\.test\.js.*rule 19/.test(output), output);
ok('rule 19: render importing fauna/ flagged', /render\/bad19d\.js.*must not import engine\/fauna/.test(output), output);
ok('rule 19: world importing fauna/ flagged', /world\/bad19e\.js.*must not import engine\/fauna/.test(output), output);
ok('rule 16: fx non-test importing world/ flagged', /fx\/bad16a\.js.*non-test.*may only import engine\/fx.*engine\/core/.test(output), output);
ok('rule 16: fx non-test importing render/ flagged', /fx\/bad16b\.js.*non-test/.test(output), output);
ok('rule 16: fx importing fx+core NOT flagged', !/good16a\.js/.test(output), output);
ok('rule 16: fx test importing fx+test NOT flagged', !/good16b\.test\.js/.test(output), output);
ok('rule 16: fx test importing world/ flagged', /bad16c\.test\.js.*engine\/fx.*engine\/core.*engine\/test/.test(output), output);
ok('rule 16: world/render importing fx/ NOT flagged', !/good16[cd]\.js/.test(output), output);
ok('rule 16: physics importing fx/ flagged', /physics\/bad16d\.js.*must not import engine\/fx/.test(output), output);
ok('rule 16: nav importing fx/ flagged', /nav\/bad16e\.js.*must not import engine\/fx/.test(output), output);
ok('rule 15: engine/fx/particles.js WARNs', /WARN.*fx\/particles\.js:1:.*Math\.random/.test(output) && /WARN.*fx\/particles\.js:1:.*Math\.sin/.test(output), output);
ok('rule 15: engine/fx/emitterDef.js Math.tan NOT flagged', !/emitterDef\.js/.test(output), output);
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
ok('rule 15: game/js/quest/sim/** Math.random WARNs', /WARN.*quest\/sim\/bad15\.js:1:.*Math\.random/.test(output), output);
ok('rule 15: game/js/quest/** (not sim/) NOT flagged', !/quest\/beastView\.js/.test(output), output);

ok('rule 17: device/ file using all five NOT flagged', !/good17\.js/.test(output), output);
ok('rule 17: engine/render/gpu non-device navigator.gpu flagged', /gpu\/bad17a\.js:1:.*navigator\.gpu/.test(output), output);
ok('rule 17: engine/render GPUBufferUsage flagged', /bad17b\.js:1:.*GPUBufferUsage/.test(output), output);
ok('rule 17: engine/render GPUMapMode flagged (line 2)', /bad17b\.js:2:.*GPUMapMode/.test(output), output);
ok('rule 17: comment mention NOT flagged', !/comment17\.js/.test(output), output);
ok('rule 17: game/ GPUShaderStage flagged', /game\/js\/bad17c\.js:1:.*GPUShaderStage/.test(output), output);
ok('rule 17: game/ test file navigator.gpu flagged', /bad17d\.test\.js:1:.*navigator\.gpu/.test(output), output);

ok('rule 18: editor GpuCellPipeline import flagged', /bad18\.js:1:.*GL-only/.test(output), output);
ok('rule 18: editor glsl/ import flagged', /bad18\.js:2:.*GL-only/.test(output), output);
ok('rule 18: clean editor file NOT flagged', !/good18\.js/.test(output), output);
ok('rule 18 (WG-5b): engine-wide, non-editor tool flagged too', /other18\.js:1:.*GL-only/.test(output), output);

// Installing a tool's dependencies must not change the project's findings or scan count.
const installed = fs.mkdtempSync(path.join(os.tmpdir(), 'check-deps-installed-'));
try {
  writeFile(installed, 'engine/index.js', 'export const ready = true;\n');
  writeFile(installed, 'tools/desktop/owned.mjs', 'export const ready = true;\n');
  const clean = execFileSync(process.execPath, [CHECKER], { cwd:installed, encoding:'utf8' });
  for (const dir of ['engine/node_modules/pkg', 'game/js/node_modules/pkg',
    'tools/desktop/node_modules/@vendor/pkg', 'design/node_modules/pkg']) {
    writeFile(installed, `${dir}/third-party.js`, "import fs from 'node:fs'; export const foreign = navigator.gpu;\n");
  }
  const withDependencies = execFileSync(process.execPath, [CHECKER], { cwd:installed, encoding:'utf8' });
  ok('nested/scoped node_modules ignored with identical scan count and findings', withDependencies === clean, withDependencies);
  writeFile(installed, 'tools/desktop/node_modules_extra/owned.mjs', 'export const ready = true;\n');
  const sibling = execFileSync(process.execPath, [CHECKER], { cwd:installed, encoding:'utf8' });
  ok('similarly named project directories still scanned', sibling !== clean && /check-deps OK/.test(sibling), sibling);
} finally {
  const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(installed));
  if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(installed).startsWith('check-deps-installed-')) throw new Error('unsafe installed fixture cleanup');
  fs.rmSync(installed, { recursive:true, force:true });
}

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
