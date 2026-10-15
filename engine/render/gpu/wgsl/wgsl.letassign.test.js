// CLOUD-FLUFF-01b: the night-sky bug (assignment to a `let`) compiled fine in Node and only failed in the WebGPU shader compiler.
// This lint scans every *_WGSL string AND the composed shade shaders for `NAME =`/`NAME op=`/`NAME.f =`/`NAME[i] =` where NAME is a
// `let` (or function parameter) of the enclosing fn and never a `var` there. node engine/render/gpu/wgsl/wgsl.letassign.test.js
import assert from 'node:assert';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const strip = (c) => c.split('\n').map((l) => { const i = l.indexOf('//'); return i < 0 ? l : l.slice(0, i); }).join('\n');

/** @returns {string[]} problems found in one WGSL source text */
export function letAssignProblems(code, label = '') {
  const out = [];
  const parts = strip(code).split(/(?=^\s*fn\s)/m); // one chunk per function (text before the first fn is ignored by the filter)
  for (const fnText of parts) {
    if (!/^\s*fn\s/.test(fnText)) continue;
    const name = (/^\s*fn\s+(\w+)/.exec(fnText) || [])[1];
    const sig = fnText.slice(0, fnText.indexOf('{') + 1);
    const lets = new Set(), vars = new Set();
    for (const m of fnText.matchAll(/\blet\s+(\w+)/g)) lets.add(m[1]);
    for (const m of sig.matchAll(/(\w+)\s*:/g)) lets.add(m[1]); // parameters are immutable
    for (const m of fnText.matchAll(/\bvar(?:<\w+>)?\s+(\w+)/g)) vars.add(m[1]);
    for (const n of lets) {
      if (vars.has(n)) continue;
      const B = String.fromCharCode(92); // backslash
      const re = new RegExp(`(^|[;{}${B}s])(?<!${B}blet${B}s+)` + n + `(${B}.[xyzwrgba]+|${B}[[^${B}]]*${B}])?${B}s*([-+*/%&|^]|<<|>>)?=(?!=)`, 'g');
      let m; while ((m = re.exec(fnText))) out.push(`${label} fn ${name}: assignment to immutable '${n}' (${m[0].trim()})`);
    }
  }
  return out;
}

// self-check: the lint must catch the night-sky bug shape and accept var/shadow-free code
assert.ok(letAssignProblems('fn a() { let x = 1.0; x = 2.0; }').length === 1, 'catches let assignment');
assert.ok(letAssignProblems('fn a() { let v = vec3f(0.0); v.x += 1.0; }').length === 1, 'catches compound member assignment');
assert.ok(letAssignProblems('fn a(p: f32) { p = 2.0; }').length === 1, 'catches parameter assignment');
assert.ok(letAssignProblems('fn a() { var x = 1.0; x = 2.0; let y = x == 1.0; }').length === 0, 'var ok, == ok');

const problems = [];
let n = 0;
for (const f of readdirSync(dir).filter((x) => /\.wgsl\.js$/.test(x)).sort()) {
  const mod = await import(pathToFileURL(join(dir, f)).href);
  for (const k of Object.keys(mod)) if (/_WGSL$/.test(k) && typeof mod[k] === 'string') { n++; problems.push(...letAssignProblems(mod[k], `${f}:${k}`)); }
}
for (const f of ['../../skyNight.js', '../../skyCloud.js', '../../skyGlow.js', '../../groundLook.js', '../../underwater.js']) {
  const mod = await import(pathToFileURL(join(dir, f)).href);
  for (const k of Object.keys(mod)) if (/_WGSL$/.test(k) && typeof mod[k] === 'string') { n++; problems.push(...letAssignProblems(mod[k], `${f}:${k}`)); }
}
assert.deepStrictEqual(problems, [], 'assignment to let:\n  ' + problems.join('\n  '));
assert.ok(n >= 30, 'scanned ' + n);
console.log(`wgsl.letassign: ${n} WGSL strings scanned, no assignment to let/parameter`);
