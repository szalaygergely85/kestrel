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
//   6. success message as above.

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

const findings = [];
let filesScanned = 0;

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
}

// US-024 Phase A forwarding shims (docs/backlog.md US-024, "Shims are legal
// (game -> engine)"): kept only so the physics/entities code that Phase C
// (next programmer) still owns - not yet moved into engine/ - keeps working
// unchanged. Exempt from rule 3's "engine/index.js only" requirement; delete
// from this list (and the repo) when Phase C removes their last reader.
const RULE3_SHIM_ALLOWLIST = new Set([
  'game/js/world/Level.js',
  'game/js/world/levels/test_room.js',
].map((p) => p.split('/').join(path.sep)));

// tools/bench-cast.mjs is testing tooling for the sector caster's internal
// shader-parity/probe options (opts.shader, opts.skyFallback) that are
// deliberately NOT part of the public FrameBuffers API (castSectors always
// runs with skyFallback:false) - it needs engine/render/sectorCaster.js and
// engine/world/Level.js directly, same rationale as the game/ shims above.
const RULE3_TOOL_ALLOWLIST = new Set([
  'tools/bench-cast.mjs',
].map((p) => p.split('/').join(path.sep)));

function checkConsumerFile(file, src) {
  filesScanned++;
  const relPath = path.relative(ROOT, file);
  if (RULE3_SHIM_ALLOWLIST.has(relPath) || RULE3_TOOL_ALLOWLIST.has(relPath)) return;
  const stripped = stripComments(src);
  for (const { spec, line } of findImports(stripped)) {
    if (isBareSpecifier(spec)) continue; // not this checker's concern for game/tools
    const resolved = path.resolve(path.dirname(file), spec);
    const isInsideEngine = resolved.startsWith(ENGINE_DIR + path.sep) || resolved === ENGINE_DIR;
    if (isInsideEngine) {
      const normalized = resolved.replace(/\\/g, '/');
      const indexPath = path.join(ENGINE_DIR, 'index.js').replace(/\\/g, '/');
      if (normalized !== indexPath) {
        findings.push(`${rel(file)}:${line}: deep import "${spec}" - game/tools must import exactly engine/index.js`);
      }
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

if (findings.length) {
  for (const f of findings) console.error(f);
  console.error(`\ncheck-deps FAILED (${findings.length} finding(s), ${filesScanned} files scanned)`);
  process.exit(1);
} else {
  console.log(`check-deps OK (${filesScanned} files)`);
  process.exit(0);
}
