// WGSL-LINT-SWEEP: every exported *_WGSL string under this folder gets the repo's WGSL lint rules
// (raw %, forbidden builtins, keyword identifiers, balanced braces, TODO/FIXME). Modules are found by
// scanning the directory, so a new *.wgsl.js cannot be forgotten. node engine/render/gpu/wgsl/wgsl.lintall.test.js
import assert from 'node:assert';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
// Known exceptions: { 'EXPORT_NAME': { rule, why } } - shaders that legitimately break a rule (none found yet).
const KNOWN_EXCEPTIONS = {
  // IMP_CARD_WGSL: the impostor card fragment is the only frag_depth user (index.test.js R6c); added if it trips below.
  IMP_CARD_WGSL: { rule: 'frag_depth', why: 'card fragment writes texel-shifted depth (index.test.js R6c)' },
};

const noComments = (c) => c.split(String.fromCharCode(10)).map((l) => { const i = l.indexOf("//"); return i < 0 ? l : l.slice(0, i); }).join(" ");
const RULES = [
  ['raw %', (c) => /[^%]%[^%]/.test(c.replace(/%%/g, ''))],
  ['forbidden builtin', (c, n) => /\bround\s*\(|dpdx|dpdy|fwidth/.test(c)],
  ['frag_depth', (c) => /frag_depth/.test(c)],
  ['keyword identifier', (c) => /\b(fn|let|var)\s+(fn|var|let|const|struct|type|enum|override|loop|switch)\b/.test(c)],
  ['TODO/FIXME', (c) => /\b(TODO|FIXME)\b/.test(c)],
  ['unbalanced braces', (c) => { let d = 0; for (const ch of noComments(c)) { if (ch === '{') d++; else if (ch === '}' && --d < 0) return true; } return d !== 0; }],
  ['unbalanced parens', (c) => { let d = 0; for (const ch of noComments(c)) { if (ch === '(') d++; else if (ch === ')' && --d < 0) return true; } return d !== 0; }],
];

const t0 = Date.now();
const files = readdirSync(dir).filter((f) => /\.wgsl\.js$/.test(f)).sort();
assert.ok(files.length >= 10, 'directory scan found modules');
let linted = 0;
const failures = [];
const used = new Set();
for (const f of files) {
  const mod = await import(pathToFileURL(join(dir, f)).href);
  const names = Object.keys(mod).filter((k) => /_WGSL$/.test(k) && typeof mod[k] === 'string');
  if (!names.length && Object.keys(mod).some((k) => /_WGSL$/.test(k))) failures.push(f + ': *_WGSL export is not a string');
  for (const n of names) {
    const code = mod[n];
    if (!code.length) { failures.push(`${f}:${n}: empty`); continue; }
    linted++;
    for (const [rule, bad] of RULES) {
      if (!bad(code, n)) continue;
      const ex = KNOWN_EXCEPTIONS[n];
      if (ex && ex.rule === rule) { used.add(n); continue; }
      failures.push(`${f}:${n}: ${rule}`);
    }
  }
}
assert.deepStrictEqual(failures, [], 'WGSL lint failures:\n  ' + failures.join('\n  '));
for (const n of Object.keys(KNOWN_EXCEPTIONS)) assert.ok(used.has(n), `stale known exception ${n} (no longer trips its rule - remove it)`);
assert.ok(linted >= 30, 'linted ' + linted + ' strings');
assert.ok(Date.now() - t0 < 3000, 'under 3 s');
console.log(`wgsl.lintall: ${linted} WGSL strings in ${files.length} modules linted, ${used.size} known exceptions, ${Date.now() - t0} ms`);
