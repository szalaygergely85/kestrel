#!/usr/bin/env node
// US-024 dependency checker (docs/architecture.md section 3). No
// dependencies, no build step.
//
//   node tools/check-deps.mjs
//
// Prints `file:line: message` per finding and exits 1 if any are found,
// otherwise prints `check-deps OK (N files)` and exits 0.
//
// Rules:
//   1. engine/**/*.js: every import/export-from/dynamic-import specifier
//      must resolve inside engine/ (no bare specifiers - no libraries, no
//      Node built-ins).
//   2. engine/**/*.js: window.ASSETS / globalThis.ASSETS / ASSETS. /
//      document.getElementById / location.search / URLSearchParams are
//      findings (outside comments).
//   3. game/**/*.js and tools/**/*.js: an import that resolves inside
//      engine/ must be exactly engine/index.js (deep imports are findings).
//   4. design/**/*.js: any import/export statement is a finding (except design/preview/lib/**: preview-only ES-module helpers).
//   5. JSDoc `import('...')` inside comments is ignored (comments are
//      stripped before rule 1/2/3 scan).
//   6. tools/editor/**/*.js: an import that resolves inside game/ is a
//      finding (architecture.md 24.2 - the editor is a second client of
//      engine/index.js only, it must never depend on the game/ product).
//   7. game/**/*.js and tools/**/*.js: an import that resolves to exactly
//      engine/dev.js (US-047, docs/architecture.md section 5) is allowed
//      only from game/js/dev/**, game/js/main.js, or tools/** OUTSIDE
//      tools/editor/** - everywhere else (game/js/quest/**, game/js/ui/**,
//      tools/editor/**) it is a finding: those get only the stable
//      engine/index.js surface.
//   8. game/**/*.test.js|*.test.mjs and tools/**/*.test.js|*.test.mjs may
//      import exactly engine/test/assert.js (US-050 shared test kit), in
//      addition to engine/index.js - this is the one deep-import exception
//      that also applies inside tools/editor/**'s own tests.
//   9. (ME-03b, architecture.md 27.2/27.11) engine/render/gpu/**/*.js
//      (excluding engine/render/gpu/device/*.js and *.test.js) referencing
//      `gl.`, `WebGL2RenderingContext` or `navigator.gpu` (outside comments)
//      is a WARNING, not a finding: printed on its own "WARN ..." line
//      (never a bare "FAIL" prefix - tools/run-tests.mjs greps for that) and
//      never affects the exit code. Backend-only code (D-029 item 9) is
//      meant to converge on engine/render/gpu/device/* over time; this rule
//      flips to a real (exit-code) finding only in ME-19, once the old
//      per-pass GL call sites are gone.
//   11. (ME-09, docs/architecture.md 27.15.7) engine/physics/**/*.js may not
//       import engine/mesh/**/*.js at runtime (engine/mesh's own convention,
//       ME-01/ME-07, restricting *its own* imports, has no automated check
//       yet - this rule instead guards the physics side of that boundary:
//       bvh.js takes MeshData-shaped plain data as a parameter, never a live
//       import of the mesh module, so rigid.js/player consumers never end up
//       transitively depending on engine/mesh internals through physics).
//   16. (US-053a, architecture.md 32.0) engine/fx/** leaf: non-test imports only
//       engine/fx/** + engine/core/**; tests may add engine/test/**; physics/nav
//       may never import engine/fx/**. engine/fx/particles.js joins rule 15.
//   13. (CO-1b) coordinate-math WARN rule, see COORD_ALLOW below.
//   14. (RE-05, docs/architecture.md 28.2) engine/nav/**/*.js (non-test) may
//       import only engine/nav/** and engine/core/** - never render/mesh/ui/
//       world; engine/nav/**/*.test.js may additionally import
//       engine/world/** (real terrain fixtures) and engine/test/** (the
//       shared assert kit, same as rule 8). Conversely,
//       engine/render/**, engine/mesh/**, engine/ui/** and engine/world/**
//       (any file, including their tests) may never import engine/nav/** -
//       nav is a leaf module, World is passed into buildFromWorld duck-typed.
//   15. (RE-14, docs/architecture.md 28.5, WARN only) non-test files under
//       engine/nav/**, engine/core/{commands,rng,hash,replay}.js,
//       engine/world/Visibility.js, engine/world/wind.js (US-138, 32.0 item
//       2) and game/js/rts/sim/** should not use Math.random, Date.now,
//       performance.now or Math.sin|cos|tan|atan2|exp|pow|hypot (comments
//       stripped first) - deterministic-sim leaves.
//   17. (WG-1b2, architecture.md 38.2) `navigator.gpu`, GPUBufferUsage, GPUTextureUsage, GPUShaderStage, GPUMapMode
//       (outside comments) are findings anywhere in engine/** or game/** except engine/render/gpu/device/**.
//   18. (ED-WG-01c, architecture.md 38.21) tools/editor/**/*.js (tests included) may not import GL-only modules:
//       GpuCellPipeline, GpuDeviceGL2/WebGL2, GpuSpritePass, overlayPass, glsl/**, RenderTargetGL, editorRenderer.
//   19. (CHARGEN-06, architecture.md 38.29 item 6) tools/export/**/*.js (non-test) are browser-safe exporters: they may
//       import only engine/index.js and tools/export/** - no bare specifiers, no node: built-ins, no fs/zlib, nothing else
//       under tools/ or game/ or design/. Their *.test.* files are exempt (rule 3/8 still apply).
//   20. (CHARGEN-06, architecture.md 38.29 item 7) a specifier containing `vendor/three` is a finding anywhere except
//       under tools/chargen/** (three.js is vendored for the chargen app only).
//   12. success message as above.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Project root = current working directory (this script is meant to be run
// as `node tools/check-deps.mjs` from the repo root - see CLAUDE.md). Using
// cwd rather than a path relative to this file also lets
// tools/check-deps.test.mjs point it at a temp fixture tree.
const ROOT = process.cwd();
const ENGINE_DIR = path.join(ROOT, 'engine');
const GAME_DIR = path.join(ROOT, 'game');

const findings = [];
const warnings = [];
let filesScanned = 0;

const GPU_DIR = path.join(ROOT, 'engine', 'render', 'gpu');
const GPU_DEVICE_DIR = path.join(GPU_DIR, 'device');
const PHYSICS_DIR = path.join(ROOT, 'engine', 'physics');
const MESH_DIR = path.join(ROOT, 'engine', 'mesh');
const NAV_DIR = path.join(ROOT, 'engine', 'nav');
const FX_DIR = path.join(ROOT, 'engine', 'fx');
const RENDER_DIR = path.join(ROOT, 'engine', 'render');
const UI_DIR = path.join(ROOT, 'engine', 'ui');
const WORLD_DIR = path.join(ROOT, 'engine', 'world');
const CORE_DIR = path.join(ROOT, 'engine', 'core');
const TEST_DIR = path.join(ROOT, 'engine', 'test');

function walk(dir, exts = ['.js', '.mjs']) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walk(full, exts));
    } else if (exts.includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

// Strips /* */ and // comments so rule 5 (JSDoc import(...) ignored) and the
// forbidden-pattern scan (rule 2) never look inside comments. Deliberately
// simple (no string-literal awareness) - good enough for this codebase's
// style (no comment markers embedded in string literals containing `//`
// followed by code-shaped text); errs on the side of stripping a little too
// much rather than under-stripping and false-negative-ing a real violation.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
    .replace(/\/\/.*$/gm, '');
}

// Finds import/export-from/dynamic-import specifiers with their 1-based line
// number, from the ORIGINAL (uncommented) source so line numbers match the
// real file, using the STRIPPED source to decide what to look at.
function findImports(stripped) {
  const specs = [];
  const patterns = [
    /import\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
    /export\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(stripped))) {
      const idx = m.index;
      const line = stripped.slice(0, idx).split('\n').length;
      specs.push({ spec: m[1], line });
    }
  }
  return specs;
}

function isBareSpecifier(spec) {
  return !spec.startsWith('.') && !spec.startsWith('/');
}

function checkEngineFile(file, src) {
  filesScanned++;
  const stripped = stripComments(src);

  // Rule 1: import resolution.
  for (const { spec, line } of findImports(stripped)) {
    if (isBareSpecifier(spec)) {
      findings.push(`${rel(file)}:${line}: bare specifier "${spec}" not allowed in engine/ (no libraries, no Node built-ins)`);
      continue;
    }
    const resolved = path.resolve(path.dirname(file), spec);
    if (!resolved.startsWith(ENGINE_DIR + path.sep) && resolved !== ENGINE_DIR) {
      findings.push(`${rel(file)}:${line}: import "${spec}" resolves outside engine/`);
    }
    // Rule 11 (ME-09): engine/physics/** must not import engine/mesh/**.
    const isPhysicsFile = file.startsWith(PHYSICS_DIR + path.sep) || file === PHYSICS_DIR;
    const resolvesIntoMesh = resolved.startsWith(MESH_DIR + path.sep) || resolved === MESH_DIR;
    if (isPhysicsFile && resolvesIntoMesh) {
      findings.push(`${rel(file)}:${line}: import "${spec}" resolves into engine/mesh/ - engine/physics/** must take MeshData-shaped plain data as a parameter, never import engine/mesh at runtime (ME-09)`);
    }
  }

  // Rule 2: forbidden global reads.
  const forbidden = [
    [/\bwindow\.ASSETS\b/g, 'window.ASSETS'],
    [/\bglobalThis\.ASSETS\b/g, 'globalThis.ASSETS'],
    [/\bASSETS\./g, 'ASSETS.'],
    [/\bdocument\.getElementById\b/g, 'document.getElementById'],
    [/\blocation\.search\b/g, 'location.search'],
    [/\bURLSearchParams\b/g, 'URLSearchParams'],
  ];
  for (const [re, label] of forbidden) {
    let m;
    while ((m = re.exec(stripped))) {
      const line = stripped.slice(0, m.index).split('\n').length;
      findings.push(`${rel(file)}:${line}: forbidden pattern "${label}" in engine/ (engine takes canvas/assets/options as arguments)`);
    }
  }

  // Rule 9 (ME-03b, WARN only): engine/render/gpu/** outside device/* should
  // not touch the GL/WebGPU surface directly - see the header comment.
  const isGpuFile = file.startsWith(GPU_DIR + path.sep) || file === GPU_DIR;
  const isDeviceFile = file.startsWith(GPU_DEVICE_DIR + path.sep) || file === GPU_DEVICE_DIR;
  if (isGpuFile && !isDeviceFile) {
    const gpuPatterns = [
      [/\bgl\.\w+/g, 'gl.*'],
      [/\bWebGL2RenderingContext\b/g, 'WebGL2RenderingContext'],
      [/\bnavigator\.gpu\b/g, 'navigator.gpu'],
    ];
    for (const [re, label] of gpuPatterns) {
      let m;
      while ((m = re.exec(stripped))) {
        const line = stripped.slice(0, m.index).split('\n').length;
        warnings.push(`${rel(file)}:${line}: "${label}" outside engine/render/gpu/device/* (D-029 item 9, ME-19 will make this a FAIL)`);
      }
    }
  }
}

// ME-19b: the retained shadow CPU benchmark and detail export comparison
// are tool-only exceptions for mesh/shadow pass internals (rule 3).
const RULE3_TOOL_ALLOWLIST = new Set([
  'tools/bench-shadow.mjs',
  'tools/compare-detail-export.mjs',
  'tools/mesh-tri-budget.mjs', // MESH-QA-01: runs the runtime's own compactGroup/frustum/projection (not in engine/index.js)
  'tools/mesh-place-budget.mjs', // MESH-PLACE-01: same frustum helpers as mesh-tri-budget (not in engine/index.js)
].map((p) => p.split('/').join(path.sep)));

const EDITOR_DIR = path.join(ROOT, 'tools', 'editor');
const GL_ONLY_RE = /(GpuCellPipeline|GpuDeviceGL2|GpuDeviceWebGL2|GpuSpritePass|overlayPass|RenderTargetGL|editorRenderer)(\.js)?$|\/glsl\//;

// Rule 7 (US-047): who may import engine/dev.js. game/js/dev/** and
// game/js/main.js (dev-mode code paths) and tools/** (bench/capture/parity
// tooling) - but NOT tools/editor/** (a stable-API-only client, same as
// engine/index.js's rule 3/6), and NOT anywhere else in game/ (quest/ui code
// gets only the stable engine/index.js surface).
function isDevJsAllowed(file) {
  const relPath = rel(file); // POSIX-style, relative to ROOT
  if (relPath === 'game/js/main.js') return true;
  if (relPath.startsWith('game/js/dev/')) return true;
  if (relPath.startsWith('tools/') && !relPath.startsWith('tools/editor/')) return true;
  return false;
}

function checkConsumerFile(file, src) {
  filesScanned++;
  const relPath = path.relative(ROOT, file);
  const isEditorFile = file.startsWith(EDITOR_DIR + path.sep) || file === EDITOR_DIR;
  if (RULE3_TOOL_ALLOWLIST.has(relPath)) return;
  const stripped = stripComments(src);
  for (const { spec, line } of findImports(stripped)) {
    if (isBareSpecifier(spec)) continue; // not this checker's concern for game/tools
    const resolved = path.resolve(path.dirname(file), spec);
    const isInsideEngine = resolved.startsWith(ENGINE_DIR + path.sep) || resolved === ENGINE_DIR;
    if (isInsideEngine) {
      const normalized = resolved.replace(/\\/g, '/');
      const indexPath = path.join(ENGINE_DIR, 'index.js').replace(/\\/g, '/');
      const devPath = path.join(ENGINE_DIR, 'dev.js').replace(/\\/g, '/');
      const testAssertPath = path.join(ENGINE_DIR, 'test', 'assert.js').replace(/\\/g, '/');
      if (normalized === indexPath) {
        // OK: the stable surface, open to every game/tools consumer.
      } else if (normalized === testAssertPath && /\.test\.(js|mjs)$/.test(relPath)) {
        // Rule 8 (US-050): the shared test-assertion kit, open to every
        // *.test.js/*.test.mjs file (including tools/editor/**'s tests) -
        // it is test-only tooling, not part of engine's stable API surface.
      } else if (normalized === devPath) {
        // Rule 7: engine/dev.js is dev-only.
        if (!isDevJsAllowed(file)) {
          findings.push(`${rel(file)}:${line}: import "${spec}" resolves to engine/dev.js - only game/js/dev/**, game/js/main.js and tools/** (not tools/editor/**) may import it`);
        }
      } else {
        findings.push(`${rel(file)}:${line}: deep import "${spec}" - game/tools must import exactly engine/index.js (or engine/dev.js where allowed)`);
      }
    }
    // Rule 18 (ED-WG-01c, WG-5b: now engine-wide): the WebGL2 classes/modules are deleted; nothing may import them again.
    if (!/.test.mjs$/.test(file) && GL_ONLY_RE.test(spec.split('\\').join('/'))) {
      findings.push(`${rel(file)}:${line}: import "${spec}" is a GL-only module - WebGL2 was removed (WG-5b, rule 18, architecture.md 38.21)`);
    }
    // Rule 6: tools/editor/** is a second client of engine/index.js only -
    // it must never depend on game/ (architecture.md 24.2).
    if (isEditorFile && (resolved.startsWith(GAME_DIR + path.sep) || resolved === GAME_DIR)) {
      findings.push(`${rel(file)}:${line}: import "${spec}" resolves into game/ - tools/editor/** must not depend on game/`);
    }
  }
}

function checkDesignFile(file, src) {
  filesScanned++;
  // Exception (PC-A 2026-10-06): design/preview/lib/** are preview-only ES-module helpers (e.g. the CPU voxel marcher
  // ME-19b removed from the engine). Only design/preview/*.html loads them, and those pages import engine/ modules
  // directly already; nothing in engine/, game/ or the content pipeline may import them.
  if (rel(file).startsWith('design/preview/lib/')) return;
  const stripped = stripComments(src);
  const patterns = [
    /^\s*import\b/gm,
    /^\s*export\b/gm,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(stripped))) {
      const line = stripped.slice(0, m.index).split('\n').length;
      findings.push(`${rel(file)}:${line}: "${m[0].trim()}" - design/ must stay classic scripts (no import/export)`);
    }
  }
}

// Rule 13 (CO-1b, docs/coordinates.md sections 3/9, WARN only): coordinate
// math that engine/core/transform.js owns must not be re-spelled elsewhere:
// `atan2(.. -..)` (yawFromDelta), `* Math.PI / 180` (DEG2RAD/dirFromAzEl) and
// `+/- <x>.origin.x|y|z` (localToWorld / World.gridLocal). Allow-list = files
// that legitimately inline the math (hot-loop casters/shaders, the frame
// owner World.js, lighting's per-light cell math, dev harnesses, tests).
// Allowed entries are exact rel paths or prefixes ending in '/'.
const COORD_ALLOW = [
  'engine/core/transform.js',
  'engine/render/sectorCaster.js',        // hot loop (camera sin/cos, DDA setup)
  'engine/render/terrainCaster.js',       // hot loop
  'engine/render/sprites.js',             // hot loop
  'engine/render/detailShade.js',         // hot loop
  'game/js/dev/',                         // page harnesses / parity modes
];
const COORD_PATTERNS = [
  [/\batan2\(.*-/g, 'atan2(.., -..) -> yawFromDelta'],
  [/\* Math\.PI \/ 180/g, '* Math.PI / 180 -> DEG2RAD / dirFromAzEl'],
  [/[+-] *[\w.]*origin\.[xyz]\b|\borigin\.[xyz] *[+-]/g, '+/- origin.x|y|z -> localToWorld / gridLocal'],
];
function checkCoordMath(file, src) {
  const r = rel(file);
  if (COORD_ALLOW.some((a) => (a.endsWith('/') ? r.startsWith(a) : r === a))) return;
  const stripped = stripComments(src);
  const origLines = src.split('\n');
  for (const [re, label] of COORD_PATTERNS) {
    let m;
    while ((m = re.exec(stripped))) {
      const line = stripped.slice(0, m.index).split('\n').length;
      if ((origLines[line - 1] || '').includes('coord-ok')) continue; // audited exception (CO-2)
      warnings.push(`${r}:${line}: coordinate math "${label}" outside engine/core/transform.js (docs/coordinates.md 3/9)`);
    }
  }
}

// Rule 14 (RE-05, docs/architecture.md 28.2): engine/nav/** is a leaf module.
// Runs over EVERY engine file including *.test.js (unlike the main
// checkEngineFile loop below, which skips tests) because the rule's "tests
// may additionally import engine/world/**" clause needs test files checked
// too, just against a slightly wider allow-list.
function inDir(resolved, dir) {
  return resolved.startsWith(dir + path.sep) || resolved === dir;
}
function checkNavLeafRule(file, src) {
  const isTest = /\.test\.(js|mjs)$/.test(file);
  const isNavFile = inDir(file, NAV_DIR);
  const isForbiddenConsumer = inDir(file, RENDER_DIR) || inDir(file, MESH_DIR) || inDir(file, UI_DIR) || inDir(file, WORLD_DIR);
  if (!isNavFile && !isForbiddenConsumer) return;
  const stripped = stripComments(src);
  for (const { spec, line } of findImports(stripped)) {
    if (isBareSpecifier(spec)) continue; // rule 1 already flags this
    const resolved = path.resolve(path.dirname(file), spec);
    if (isNavFile) {
      const allowed = inDir(resolved, NAV_DIR) || inDir(resolved, CORE_DIR)
        || (isTest && (inDir(resolved, WORLD_DIR) || inDir(resolved, TEST_DIR)));
      if (!allowed) {
        const scope = isTest ? 'engine/nav/**/*.test.js may only import engine/nav/**, engine/core/**, engine/world/** and engine/test/**' : 'engine/nav/** (non-test) may only import engine/nav/** and engine/core/**';
        findings.push(`${rel(file)}:${line}: import "${spec}" - ${scope} (rule 14, docs/architecture.md 28.2)`);
      }
    }
    if (isForbiddenConsumer && inDir(resolved, NAV_DIR)) {
      findings.push(`${rel(file)}:${line}: import "${spec}" resolves into engine/nav/ - render/mesh/ui/world must not import engine/nav/** (rule 14, docs/architecture.md 28.2)`);
    }
  }
}

// Rule 16 (US-053a, docs/architecture.md 32.0 item 2): engine/fx/** is a leaf
// like nav. Non-test fx files may import only engine/fx/** and engine/core/**;
// fx tests may also import engine/test/**. Importing INTO fx is allowed from
// render/world/ui/mesh/core/game (one-way), but not from physics (27.10
// stand-alone) or nav (leaf).
function checkFxLeafRule(file, src) {
  const isTest = /\.test\.(js|mjs)$/.test(file);
  const isFxFile = inDir(file, FX_DIR);
  const isForbiddenConsumer = inDir(file, PHYSICS_DIR) || inDir(file, NAV_DIR);
  if (!isFxFile && !isForbiddenConsumer) return;
  const stripped = stripComments(src);
  for (const { spec, line } of findImports(stripped)) {
    if (isBareSpecifier(spec)) continue; // rule 1 already flags this
    const resolved = path.resolve(path.dirname(file), spec);
    if (isFxFile) {
      const allowed = inDir(resolved, FX_DIR) || inDir(resolved, CORE_DIR) || (isTest && inDir(resolved, TEST_DIR));
      if (!allowed) {
        const scope = isTest ? 'engine/fx/**/*.test.js may only import engine/fx/**, engine/core/** and engine/test/**' : 'engine/fx/** (non-test) may only import engine/fx/** and engine/core/**';
        findings.push(`${rel(file)}:${line}: import "${spec}" - ${scope} (rule 16, docs/architecture.md 32.0)`);
      }
    }
    if (isForbiddenConsumer && inDir(resolved, FX_DIR)) {
      findings.push(`${rel(file)}:${line}: import "${spec}" resolves into engine/fx/ - physics/nav must not import engine/fx/** (rule 16, docs/architecture.md 32.0)`);
    }
  }
}

// Rule 15 (RE-14, docs/architecture.md 28.5, WARN only - the number is
// reserved even if RE-05's rule 14 lands separately, which it already has).
// Scope: non-test files under engine/nav/**, engine/core/{commands,rng,hash,
// replay}.js, engine/world/Visibility.js and game/js/rts/sim/** (RTS sim
// code convention: sim/ for sim logic, ui/ for presentation). These are the
// deterministic-sim leaves (28.2/28.5's float and RNG rules) - with comments
// stripped, using a non-deterministic time/random/trig source in one of them
// is very likely a determinism bug, but WARN (not FAIL) because a handful of
// legitimate non-sim helpers can live alongside sim code in the same file
// during early development.
const CORE_DETERMINISM_FILES = new Set(
  ['commands.js', 'rng.js', 'hash.js', 'replay.js'].map((f) => path.join(CORE_DIR, f)),
);
const VISIBILITY_FILE = path.join(WORLD_DIR, 'Visibility.js');
// US-138 (docs/architecture.md 32.0 item 2): rule 15 scope grows by this one
// exact file (not a folder) - the wind field's gust math must stay
// trig-free/wall-clock-free, same reasoning as Visibility.js.
const WIND_FILE = path.join(WORLD_DIR, 'wind.js');
// US-143a (docs/architecture.md 35.2, 35.12 "Do not"): the wave field + clock
// joins rule 15 too - no trig, no exp, no Math.random, no wall clock anywhere
// in waves.js's clock/query code (the load-time per-region compile is exempt
// in spirit, same as wind.js's forwardOf-at-create convention, but the rule
// here is file-scoped like every other rule 15 entry).
const WAVES_FILE = path.join(WORLD_DIR, 'waves.js');
// US-053a (32.0 item 2): the particle sim joins rule 15 (exact file; emitterDef.js is load-time and stays out).
const PARTICLES_FILE = path.join(FX_DIR, 'particles.js');
// US-133 (32.0 item 2): the fire spread grid joins rule 15 too.
const FIRE_FILE = path.join(WORLD_DIR, 'fireGrid.js');
// CLOTH-1a1 (architecture.md 33.2): the cloth sim core joins rule 15 (no trig,
// Math.random, exp/pow/hypot, wall clock).
const CLOTH_FILE = path.join(ROOT, 'engine', 'physics', 'cloth.js');
const RTS_SIM_DIR = path.join(GAME_DIR, 'js', 'rts', 'sim');
// US-079a (architecture.md 29.1): the beast brain's sim/ leaves (beastSim.js,
// beastNav.js, sight.js, beastConfig.js) are deterministic-sim code same as
// game/js/rts/sim/** - widened here per PC-B QUEUE 7 item 5.
const QUEST_SIM_DIR = path.join(GAME_DIR, 'js', 'quest', 'sim');
function inDeterminismScope(file) {
  if (/\.test\.(js|mjs)$/.test(file)) return false;
  if (inDir(file, NAV_DIR)) return true;
  if (CORE_DETERMINISM_FILES.has(file)) return true;
  if (file === VISIBILITY_FILE) return true;
  if (file === WIND_FILE) return true;
  if (file === WAVES_FILE) return true;
  if (file === PARTICLES_FILE) return true;
  if (file === FIRE_FILE) return true;
  if (file === CLOTH_FILE) return true;
  if (inDir(file, RTS_SIM_DIR)) return true;
  if (inDir(file, QUEST_SIM_DIR)) return true;
  return false;
}
const DETERMINISM_PATTERNS = [
  [/\bMath\.random\s*\(/g, 'Math.random'],
  [/\bDate\.now\s*\(/g, 'Date.now'],
  [/\bperformance\.now\s*\(/g, 'performance.now'],
  [/\bMath\.(sin|cos|tan|atan2|exp|pow|hypot)\s*\(/g, 'Math.$1'],
];
function checkDeterminismWarnRule(file, src) {
  if (!inDeterminismScope(file)) return;
  const stripped = stripComments(src);
  for (const [re, label] of DETERMINISM_PATTERNS) {
    let m;
    while ((m = re.exec(stripped))) {
      const line = stripped.slice(0, m.index).split('\n').length;
      const shown = label.includes('$1') ? label.replace('$1', m[1]) : label;
      warnings.push(`${rel(file)}:${line}: "${shown}" in deterministic sim code (rule 15, docs/architecture.md 28.5)`);
    }
  }
}

// Rule 17 (WG-1b2, architecture.md 38.2): WebGPU globals live only under engine/render/gpu/device/.
// Runs over every engine/ and game/ file (tests included); comments are stripped first.
const WEBGPU_GLOBALS = [
  [/\bnavigator\.gpu\b/g, 'navigator.gpu'],
  [/\bGPUBufferUsage\b/g, 'GPUBufferUsage'],
  [/\bGPUTextureUsage\b/g, 'GPUTextureUsage'],
  [/\bGPUShaderStage\b/g, 'GPUShaderStage'],
  [/\bGPUMapMode\b/g, 'GPUMapMode'],
];
function checkWebGpuGlobals(file, src) {
  if (inDir(path.resolve(file), GPU_DEVICE_DIR)) return;
  const stripped = stripComments(src);
  for (const [re, label] of WEBGPU_GLOBALS) {
    let m;
    while ((m = re.exec(stripped))) {
      const line = stripped.slice(0, m.index).split('\n').length;
      findings.push(`${rel(file)}:${line}: "${label}" outside engine/render/gpu/device/ (architecture.md 38.2: WebGPU globals only under device/; game/ probes through probeWebGpu())`);
    }
  }
}

// Rules 19 + 20 (CHARGEN-06).
const EXPORT_DIR = path.join(ROOT, 'tools', 'export');
const CHARGEN_APP_DIR = path.join(ROOT, 'tools', 'chargen');
function checkExportRules(file, src) {
  const isExport = inDir(file, EXPORT_DIR) && !/\.test\.m?js$/.test(file);
  const stripped = stripComments(src);
  for (const { spec, line } of findImports(stripped)) {
    if (/vendor[\/]three/.test(spec) && !inDir(file, CHARGEN_APP_DIR)) {
      findings.push(`${rel(file)}:${line}: import "${spec}" - vendor/three may only be imported under tools/chargen/** (rule 20, architecture.md 38.29 item 7)`);
    }
    if (!isExport) continue;
    if (isBareSpecifier(spec)) {
      findings.push(`${rel(file)}:${line}: bare/built-in specifier "${spec}" - tools/export/** must be browser-safe (rule 19, architecture.md 38.29 item 6)`);
      continue;
    }
    const resolved = path.resolve(path.dirname(file), spec);
    const okEngine = resolved === path.join(ENGINE_DIR, 'index.js');
    if (!okEngine && !inDir(resolved, EXPORT_DIR)) {
      findings.push(`${rel(file)}:${line}: import "${spec}" - tools/export/** may import only engine/index.js and tools/export/** (rule 19, architecture.md 38.29 item 6)`);
    }
  }
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

for (const file of walk(path.join(ROOT, 'engine'))) {
  if (file.endsWith('.test.js')) continue; // test fixtures aren't engine API surface
  const src = fs.readFileSync(file, 'utf8');
  checkEngineFile(file, src);
  checkCoordMath(file, src);
  checkDeterminismWarnRule(file, src);
}
for (const file of [...walk(path.join(ROOT, 'engine')), ...walk(path.join(ROOT, 'game'))]) {
  checkWebGpuGlobals(file, fs.readFileSync(file, 'utf8')); // rule 17 (tests included)
}
for (const file of walk(path.join(ROOT, 'engine'))) {
  // Rule 14 runs over every file, including *.test.js (see its own comment).
  const fsrc = fs.readFileSync(file, 'utf8');
  checkNavLeafRule(file, fsrc);
  checkFxLeafRule(file, fsrc);
}
for (const file of walk(path.join(ROOT, 'game'))) {
  const src = fs.readFileSync(file, 'utf8');
  checkConsumerFile(file, src);
  if (!/\.test\.m?js$/.test(file)) checkCoordMath(file, src);
  checkDeterminismWarnRule(file, src);
}
for (const file of walk(path.join(ROOT, 'tools'))) {
  if (path.resolve(file) === path.resolve(__filename)) continue;
  checkConsumerFile(file, fs.readFileSync(file, 'utf8'));
}
for (const file of [...walk(path.join(ROOT, 'engine')), ...walk(GAME_DIR), ...walk(path.join(ROOT, 'tools'))]) {
  if (path.resolve(file) === path.resolve(__filename)) continue;
  checkExportRules(file, fs.readFileSync(file, 'utf8')); // rules 19 + 20
}
for (const file of walk(path.join(ROOT, 'design'))) {
  checkDesignFile(file, fs.readFileSync(file, 'utf8'));
}

for (const w of warnings) console.warn(`WARN ${w}`);

if (findings.length) {
  for (const f of findings) console.error(f);
  console.error(`\ncheck-deps FAILED (${findings.length} finding(s), ${filesScanned} files scanned)`);
  process.exit(1);
} else {
  console.log(`check-deps OK (${filesScanned} files)${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
  process.exit(0);
}
