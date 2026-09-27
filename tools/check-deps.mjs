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
//   4. design/**/*.js: any import/export statement is a finding.
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

function walk(dir, exts = ['.js', '.mjs']) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
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

// tools/bench-cast.mjs is testing tooling for the sector caster's internal
// shader-parity/probe options (opts.shader, opts.skyFallback) that are
// deliberately NOT part of the public FrameBuffers API (castSectors always
// runs with skyFallback:false) - it needs engine/render/sectorCaster.js and
// engine/world/Level.js directly (a tool-only exception to rule 3).
// tools/compare-detail-export.mjs (US-028) is the same kind of tool-only
// exception: it needs the G-buffer/detail-shade/edge-pass internals
// directly to reproduce the exact render pipeline the designer's export
// JSON was captured from (a correctness oracle, not a game/main.js consumer).
// tools/bench-voxel.mjs (US-039): engine/voxel/** gets no engine/index.js
// exports until US-041 (architect tech notes item 1 - "tests import the
// files directly"), so this bench needs the same kind of tool-only
// exception in the meantime.
const RULE3_TOOL_ALLOWLIST = new Set([
  'tools/bench-cast.mjs',
  'tools/compare-detail-export.mjs',
  'tools/bench-voxel.mjs',
].map((p) => p.split('/').join(path.sep)));

const EDITOR_DIR = path.join(ROOT, 'tools', 'editor');

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
    // Rule 6: tools/editor/** is a second client of engine/index.js only -
    // it must never depend on game/ (architecture.md 24.2).
    if (isEditorFile && (resolved.startsWith(GAME_DIR + path.sep) || resolved === GAME_DIR)) {
      findings.push(`${rel(file)}:${line}: import "${spec}" resolves into game/ - tools/editor/** must not depend on game/`);
    }
  }
}

function checkDesignFile(file, src) {
  filesScanned++;
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

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

for (const file of walk(path.join(ROOT, 'engine'))) {
  if (file.endsWith('.test.js')) continue; // test fixtures aren't engine API surface
  checkEngineFile(file, fs.readFileSync(file, 'utf8'));
}
for (const file of walk(path.join(ROOT, 'game'))) {
  checkConsumerFile(file, fs.readFileSync(file, 'utf8'));
}
for (const file of walk(path.join(ROOT, 'tools'))) {
  if (path.resolve(file) === path.resolve(__filename)) continue;
  checkConsumerFile(file, fs.readFileSync(file, 'utf8'));
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
