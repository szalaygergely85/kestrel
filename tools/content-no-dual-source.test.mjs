#!/usr/bin/env node
// tools/content-no-dual-source.test.mjs (US-027b, D-023 item 4 "no dual
// source of truth"). Grep-based guard: fails if it finds a direct-
// assignment pattern like `ASSETS.levels.tower =` or
// `ASSETS.worlds.world_m1 =` (or the `A.worlds.world_m1 =` / `root.ASSETS...`
// spelling design/*.js used) anywhere in the repo outside `content/` JSON -
// proving the old JS level/world definitions are truly GONE, not just
// unreferenced. Plain Node ESM, no framework.
//
//   node tools/content-no-dual-source.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'content']);
const EXTS = new Set(['.js', '.mjs', '.html']);

// The three flipped defs (docs/architecture.md 21.9) - a direct assignment
// to any of these anywhere outside content/ means a dual source of truth
// crept back in. Matches "ASSETS.levels.tower =", "A.levels.tower =",
// "ASSETS.worlds.world_m1 =", "A.worlds.world_m1 =" (design/*.js's own
// `var A = root.ASSETS` alias) - any identifier, then `.levels.tower`/
// `.levels.test_room`/`.worlds.world_m1`, then `=` (not `==`/`===`).
const PATTERNS = [
  [/\b[\w.]*\.levels\.tower\s*=(?!=)/, 'ASSETS.levels.tower ='],
  [/\b[\w.]*\.levels\.test_room\s*=(?!=)/, 'ASSETS.levels.test_room ='],
  [/\b[\w.]*\.worlds\.world_m1\s*=(?!=)/, 'ASSETS.worlds.world_m1 ='],
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const SELF = fileURLToPath(import.meta.url);

// design/preview/content-shim.js (US-027b) is the one legitimate exception:
// it assigns `ASSETS.levels.tower = stripEnvelope(fetchJsonSync(...))`, but
// the RIGHT-HAND SIDE is a runtime fetch of content/levels/tower.level.json
// - a reshape of the same JSON content, not a second hardcoded definition.
// It exists only because design/preview/*.html pages are plain classic
// scripts with no async step (see that file's own header comment).
const ALLOWLIST = new Set([
  path.join(ROOT, 'design', 'preview', 'content-shim.js'),
]);

const findings = [];
for (const file of walk(ROOT)) {
  if (path.resolve(file) === path.resolve(SELF)) continue; // this file's own pattern strings/comments
  if (ALLOWLIST.has(path.resolve(file))) continue;
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const [re, label] of PATTERNS) {
      if (re.test(lines[i])) {
        findings.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}: found "${label}" outside content/ - dual source of truth`);
      }
    }
  }
}

if (findings.length) {
  for (const f of findings) console.error(f);
  console.error(`\nFAIL: ${findings.length} dual-source finding(s)`);
  process.exit(1);
} else {
  console.log(`ALL PASS: no dual-source assignment found for tower/test_room/world_m1 outside content/`);
  process.exit(0);
}
