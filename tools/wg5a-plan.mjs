#!/usr/bin/env node
// S8-B1-19: WG-5a deletion plan (report-only, NEVER deletes or edits anything).
//
//   node tools/wg5a-plan.mjs [--out <file.md>]
//
// Lists the GLSL/WebGL2 render-path files and exports that the WG-5a backlog
// step (docs/backlog.md:261, D-044 docs/decisions.md:977-979) would remove -
// see docs/janitor/dead-code-and-flaky-2026-10-08.md section 4 for the source
// list this script's CANDIDATES below is drawn from. For each candidate file
// it walks the static import graph over engine/, game/ and tools/ (the same
// kind of import-specifier walk tools/check-deps.mjs does - check-deps.mjs
// doesn't export its walker, so this is a small standalone one, same regex
// approach) and finds every importer still outside the candidate set itself.
// A candidate with such an importer is flagged "STILL REACHABLE" - in
// particular when that importer sits under the WebGPU path
// (engine/render/gpu/wg/, wgsl/, device/) or is game/js/main.js, since those
// are exactly the two places WG-5a must not break (docs/sprints/
// sprint-8-queue.md:152-157).
//
// This script performs no filesystem writes other than an explicit --out
// markdown report. It never deletes or edits source files.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------
// WG-5a candidate list (from the janitor report, section 4). `status`:
//   'delete' - whole file goes.
//   'mixed'  - only the GL half goes; file is still a candidate for the
//              purposes of "who else imports this file", since the plan
//              needs to know if non-GL importers exist.
//   'edit'   - not a delete candidate at all; listed for context only
//              (excluded from file-count/reachable totals).
// ---------------------------------------------------------------------------
export const CANDIDATES = [
  // 4a. engine/render/gpu/glsl/ (20 files, delete as a folder)
  ['engine/render/gpu/glsl/ddaConstants.js', 'delete', 'dda only'],
  ['engine/render/gpu/glsl/cell.vert.js', 'delete', ''],
  ['engine/render/gpu/glsl/water.vert.js', 'delete', ''],
  ['engine/render/gpu/glsl/shadow.frag.js', 'delete', ''],
  ['engine/render/gpu/glsl/water.frag.js', 'delete', ''],
  ['engine/render/gpu/glsl/debug.frag.js', 'delete', ''],
  ['engine/render/gpu/glsl/deriv.frag.js', 'delete', ''],
  ['engine/render/gpu/glsl/resolve.frag.js', 'delete', 'exports MAX_SUB - move before deleting'],
  ['engine/render/gpu/glsl/terrain.vert.js', 'delete', ''],
  ['engine/render/gpu/glsl/edge.frag.js', 'delete', ''],
  ['engine/render/gpu/glsl/mesh.frag.js', 'delete', 'exports meshFragSrc - move before deleting'],
  ['engine/render/gpu/glsl/mesh.vert.js', 'delete', ''],
  ['engine/render/gpu/glsl/waterComposite.frag.js', 'delete', ''],
  ['engine/render/gpu/glsl/sprites.frag.js', 'delete', 'exports spritesFragSrc - move before deleting'],
  ['engine/render/gpu/glsl/common.js', 'delete', 'exports SKY_LUT_N/GLSL_VERSION/PRECISION/CELL_RAY_PITCHED - move before deleting'],
  ['engine/render/gpu/glsl/voxel.frag.js', 'delete', ''],
  ['engine/render/gpu/glsl/light.frag.js', 'delete', ''],
  ['engine/render/gpu/glsl/dda.frag.js', 'delete', 'dda (ME-19c)'],
  ['engine/render/gpu/glsl/terrain.frag.js', 'delete', 'dda + terrain'],
  ['engine/render/gpu/glsl/shade.frag.js', 'delete', 'exports MAX_SUB - move before deleting'],
  // 4b. GL-only classes and modules
  ['engine/render/gpu/GpuCellPipeline.js', 'delete', 'public: engine/index.js:120 (GpuCellPipeline, PASS_NAMES) - API change'],
  ['engine/render/RenderTargetGL.js', 'delete', 'imported by engine/render/RenderTarget.js:26 (edit, not delete)'],
  ['engine/render/gpu/device/GpuDeviceGL2.js', 'delete', 'imported by device/createGpuDevice.js:8'],
  ['engine/render/gpu/gridTargets.js', 'delete', ''],
  ['engine/render/gpu/glUtil.js', 'delete', 'isSoftwareRenderer is public (engine/index.js:121) - move out first'],
  ['engine/render/gpu/overlayPass.js', 'mixed', 'GL overlay; public engine/index.js:223 (GpuOverlayPass); WebGPU twin wg/passOverlay.js'],
  ['engine/render/gpu/spritesPass.js', 'mixed', 'GL sprites; public engine/index.js:56 (GpuSpritePass); WebGPU twin wg/passSprites.js'],
  ['engine/render/gpu/GpuTimer.js', 'mixed', 'GL GpuPassTimer/GpuTimer go; WebGPU twin device/WebGpuTimer.js'],
  // WG-5a-4: the single GL barrel + GL-only test siblings (all deleted together)
  ['engine/render/gl/index.js', 'delete', 'WebGL2 barrel; engine/index.js re-exports are marked // WG-5: remove'],
  ['engine/ui/crosshair.gl.test.js', 'delete', ''],
  ['engine/render/water.gl.test.js', 'delete', ''],
  ['engine/render/waterComposite.gl.test.js', 'delete', ''],
  ['engine/render/waterFlow.gl.test.js', 'delete', ''],
  ['engine/render/gpu/wg/WgCellPipeline.gl.test.js', 'delete', ''],
  // tests
  ['engine/render/gpu/device/GpuDeviceGL2.test.js', 'delete', ''],
  ['engine/render/gpu/gridTargets.test.js', 'delete', ''],
  ['engine/render/gpu/GpuTimer.test.js', 'mixed', 'keep the WebGPU cases'],
  ['engine/render/gpu/glsl.test.js', 'delete', 'after the constants move'],
  ['engine/render/gpu/sunShadowLookup.glsl.test.js', 'delete', ''],
  ['engine/render/gpu/sprites.test.js', 'mixed', 'imports spritesFragSrc and spritesPass - split'],
  ['engine/render/gpu/TerrainTextures.features.test.js', 'delete', 'imports EDGE_FRAG_SRC from glsl/ - re-point or delete'],
  // context only, not a delete candidate (WG-5b edits it instead)
  ['game/js/ui/webgl2Gate.js', 'edit', '"WebGL2 required" screen, replaced by "WebGPU required" (D-044) in WG-5b'],
];

const WEBGPU_DIRS = [
  'engine/render/gpu/wg/',
  'engine/render/gpu/wgsl/',
  'engine/render/gpu/device/',
];
const ANCHOR_FILES = ['game/js/main.js'];

// ---------------------------------------------------------------------------
// Small import-graph walker (same spirit as tools/check-deps.mjs's own
// walk()/findImports(), re-derived here since check-deps.mjs doesn't export
// them as a module - it's a standalone script).
// ---------------------------------------------------------------------------
export function walk(dir, exts = ['.js', '.mjs']) {
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

export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
    .replace(/\/\/.*$/gm, '');
}

export function findImportSpecs(stripped) {
  const specs = [];
  const patterns = [
    /import\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
    /export\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(stripped))) specs.push(m[1]);
  }
  return specs;
}

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null; // bare specifier
  let resolved = path.resolve(path.dirname(fromFile), spec);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  for (const ext of ['.js', '.mjs']) {
    if (fs.existsSync(resolved + ext)) return resolved + ext;
  }
  return null; // doesn't resolve to a file on disk (not this script's concern)
}

// Builds { importers: Map<absFile, Set<absFile>> } - reverse edges: for a
// given imported file, the set of files that import it - over engine/,
// game/, tools/ under `root`.
export function buildReverseImportGraph(root) {
  const files = [
    ...walk(path.join(root, 'engine')),
    ...walk(path.join(root, 'game')),
    ...walk(path.join(root, 'tools')),
  ];
  const importers = new Map();
  for (const file of files) {
    if (path.resolve(file) === path.resolve(__filename)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const specs = findImportSpecs(stripComments(src));
    for (const spec of specs) {
      const resolved = resolveSpec(file, spec);
      if (!resolved) continue;
      if (!importers.has(resolved)) importers.set(resolved, new Set());
      importers.get(resolved).add(file);
    }
  }
  return importers;
}

function relPosix(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function isUnderAny(relPath, dirs) {
  return dirs.some((d) => relPath.startsWith(d));
}

// Core planning function: given a repo root and the candidate list, returns
// one result row per candidate (reads files; writes nothing).
export function planWg5a(root, candidates = CANDIDATES) {
  const reverseGraph = buildReverseImportGraph(root);
  const candidateRelSet = new Set(candidates.map(([rel]) => rel));
  return candidates.map(([relPath, status, note]) => {
    const absPath = path.join(root, ...relPath.split('/'));
    const exists = fs.existsSync(absPath);
    const importerSet = reverseGraph.get(absPath) || new Set();
    const outsideImporters = [...importerSet]
      .map((f) => relPosix(root, f))
      .filter((r) => !candidateRelSet.has(r))
      .sort();
    const webgpuImporters = outsideImporters.filter((r) => isUnderAny(r, WEBGPU_DIRS));
    const anchorImporters = outsideImporters.filter((r) => ANCHOR_FILES.includes(r));
    return {
      file: relPath,
      status,
      note,
      exists,
      importerCount: outsideImporters.length,
      importers: outsideImporters,
      webgpuImporters,
      anchorImporters,
      reachable: outsideImporters.length > 0,
    };
  });
}

export function formatReport(results) {
  const lines = [];
  const deleteRows = results.filter((r) => r.status !== 'edit');
  const reachable = deleteRows.filter((r) => r.reachable);
  lines.push(`WG-5a deletion plan - ${deleteRows.length} delete candidate file(s), ${reachable.length} still reachable from kept code`);
  lines.push('');
  for (const r of results) {
    const flag = r.status === 'edit' ? '(context only, not deleted)' : r.reachable ? 'STILL REACHABLE' : 'clear to delete';
    lines.push(`- [${r.status}] ${r.file} - ${flag}${r.exists ? '' : ' (file not found)'}`);
    if (r.note) lines.push(`    note: ${r.note}`);
    if (r.importerCount) {
      lines.push(`    importers (${r.importerCount}): ${r.importers.join(', ')}`);
      if (r.webgpuImporters.length) lines.push(`    -> WebGPU path: ${r.webgpuImporters.join(', ')}`);
      if (r.anchorImporters.length) lines.push(`    -> game/js/main.js imports this`);
    }
  }
  return lines.join('\n');
}

export function formatMarkdown(results) {
  const deleteRows = results.filter((r) => r.status !== 'edit');
  const reachable = deleteRows.filter((r) => r.reachable);
  const lines = [];
  lines.push('# WG-5a deletion plan');
  lines.push('');
  lines.push(`Generated by \`tools/wg5a-plan.mjs\` (read-only; never deletes or edits anything).`);
  lines.push('');
  lines.push(`${deleteRows.length} delete-candidate file(s); **${reachable.length} still reachable** from code outside the candidate set.`);
  lines.push('');
  lines.push('| Status | File | Reachable? | Importers outside candidate set |');
  lines.push('|---|---|---|---|');
  for (const r of results) {
    const reach = r.status === 'edit' ? 'n/a (context only)' : r.reachable ? '**STILL REACHABLE**' : 'clear';
    const imp = r.importerCount ? r.importers.map((i) => '`' + i + '`').join('<br>') : '-';
    lines.push(`| ${r.status} | \`${r.file}\` | ${reach} | ${imp} |`);
  }
  lines.push('');
  if (reachable.length) {
    lines.push('## Still-reachable detail');
    lines.push('');
    for (const r of reachable) {
      lines.push(`### \`${r.file}\``);
      if (r.note) lines.push(`- ${r.note}`);
      lines.push(`- importers: ${r.importers.map((i) => '`' + i + '`').join(', ')}`);
      if (r.webgpuImporters.length) lines.push(`- **WebGPU path**: ${r.webgpuImporters.map((i) => '`' + i + '`').join(', ')}`);
      if (r.anchorImporters.length) lines.push(`- **game/js/main.js** imports this directly`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI entry point.
// ---------------------------------------------------------------------------
function main() {
  const root = process.cwd();
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

  const results = planWg5a(root, CANDIDATES);
  console.log(formatReport(results));

  if (outFile) {
    fs.writeFileSync(outFile, formatMarkdown(results) + '\n', 'utf8');
    console.log(`\nWrote ${outFile}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
