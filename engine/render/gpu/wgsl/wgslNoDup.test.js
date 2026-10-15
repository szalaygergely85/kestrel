// Merge-bug guard: no duplicate struct member, top-level name or same-scope local in any assembled WGSL module.
import assert from 'node:assert/strict';
import { WGSL_MODULES } from './index.js';

function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
}
const dups = (arr) => arr.filter((x, i) => arr.indexOf(x) !== i);

/** returns a list of problem strings for one assembled module */
export function findWgslDups(name, code) {
  const s = strip(code), bad = [];
  // struct members
  for (const m of s.matchAll(/\bstruct\s+(\w+)\s*\{([^}]*)\}/g)) {
    const names = [...m[2].matchAll(/(?:@\w+(?:\([^)]*\))?\s*)*(\w+)\s*:/g)].map((x) => x[1]);
    for (const d of new Set(dups(names))) bad.push(`${name}: struct ${m[1]} repeats member '${d}'`);
  }
  // top-level declarations (brace depth 0)
  const top = [], fns = [];
  let depth = 0, i = 0;
  const re = /[{}]|\b(fn|struct|const|override|var|alias)\b(?:<[^>]*>)?\s+(\w+)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[0] === '{') depth++; else if (m[0] === '}') depth--;
    else if (depth === 0) { top.push(m[2]); if (m[1] === 'fn') fns.push(m[2]); }
  }
  for (const d of new Set(dups(fns))) bad.push(`${name}: fn '${d}' defined twice`);
  for (const d of new Set(dups(top))) if (!fns.includes(d)) bad.push(`${name}: top-level '${d}' declared twice`);
  // locals per brace scope (let/var/const), function params join the function's scope
  const scopes = [];
  const re2 = /[{}]|\bfn\s+\w+\s*\(([^)]*)\)|(?<!for\s*\(\s*)\b(?:let|var(?:<[^>]*>)?|const)\s+(\w+)/g; // for-loop vars are scoped to the loop
  let pending = null;
  while ((m = re2.exec(s))) {
    if (m[0] === '{') { scopes.push(new Set(pending || [])); pending = null; }
    else if (m[0] === '}') scopes.pop();
    else if (m[0].startsWith('fn')) pending = [...m[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1]);
    else if (scopes.length) {
      const sc = scopes[scopes.length - 1];
      if (sc.has(m[2])) bad.push(`${name}: '${m[2]}' declared twice in one scope`);
      sc.add(m[2]);
    }
  }
  return bad;
}

// self-test of the detector
assert.ok(findWgslDups('t', 'struct A { x: u32, mat: u32, // c\n mat: u32, };').length === 1, 'detects dup struct member');
assert.ok(findWgslDups('t', 'fn f() {}\nfn f() {}').length === 1, 'detects dup fn');
assert.ok(findWgslDups('t', 'fn f() { let a = 1; { let a = 2; } let a = 3; }').length === 1, 'detects dup local, allows shadowing in a nested scope');

const all = [];
for (const mod of WGSL_MODULES) all.push(...findWgslDups(mod.name, mod.code));
assert.deepEqual(all, [], 'WGSL duplicates:\n' + all.join('\n'));
console.log(`wgslNoDup ok (${WGSL_MODULES.length} modules)`);
