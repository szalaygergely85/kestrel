// RF17-19: pure suite selection for `run-tests.mjs --changed`. No git, no fs reads except via the injected readFile.
// A suite is selected if it IS a changed file, sits in the same directory as a changed file, or statically imports one.
// All paths are posix, relative to the repo root.
import path from 'node:path';

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

/** Resolved (root-relative, posix) targets of the relative imports in `source` found in `file`. */
export function relativeImports(file, source) {
  const out = [];
  const dir = path.posix.dirname(file);
  for (const m of source.matchAll(IMPORT_RE)) out.push(path.posix.normalize(path.posix.join(dir, m[1])));
  return out;
}

/**
 * @param {string[]} suites   root-relative posix suite paths
 * @param {string[]} changed  root-relative posix changed file paths
 * @param {(f:string)=>string} readFile  returns a suite's source ('' if unreadable)
 * @returns {string[]} the selected suites, in input order
 */
export function selectSuites(suites, changed, readFile) {
  const set = new Set(changed);
  // tools/ is one flat folder of ~200 unrelated scripts: the same-directory rule would pick all of them, so it skips tools/ itself.
  const dirs = new Set(changed.map((c) => path.posix.dirname(c)).filter((d) => d !== 'tools'));
  return suites.filter((s) => {
    if (set.has(s) || dirs.has(path.posix.dirname(s))) return true;
    for (const t of relativeImports(s, readFile(s))) {
      if (set.has(t)) return true;
      // extensionless / directory imports
      if (['.js', '.mjs', '/index.js'].some((e) => set.has(t + e))) return true;
    }
    return false;
  });
}
