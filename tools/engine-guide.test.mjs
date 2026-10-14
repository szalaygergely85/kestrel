// ENGINE-GUIDE-01: the sample and the guide's code blocks use only stable engine names.
// Checks: (1) hello-world imports only from engine/index.js, only `stable` names (engine/api-1.0.json);
// (2) every name imported from engine/index.js in a ```js block of the guide is stable and exported;
// (3) the sample stays under 150 lines.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../engine/index.js';

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '../docs/engine-guide');
const manifest = JSON.parse(fs.readFileSync(path.join(here, '../../engine/api-1.0.json'), 'utf8'));
const tier = new Map(manifest.names.map((n) => [n.name, n.tier]));
const fails = [];

function importsOf(src, label) {
  const out = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    if (!/(^|\/)engine\/index\.js$/.test(m[2])) fails.push(`${label}: imports from "${m[2]}" (only engine/index.js allowed)`);
    else out.push(...names);
  }
  for (const x of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]*engine\/[^'"]+)['"]/g)) {
    if (!/engine\/index\.js$/.test(x[1])) fails.push(`${label}: deep import "${x[1]}"`);
  }
  return out;
}
function check(names, label) {
  if (!names.length) fails.push(`${label}: no engine imports found`);
  for (const n of names) {
    if (tier.get(n) !== 'stable') fails.push(`${label}: "${n}" is ${tier.get(n) || 'not in the manifest'}, not stable`);
    if (E[n] === undefined) fails.push(`${label}: "${n}" is not exported by engine/index.js`);
  }
}

const sample = fs.readFileSync(path.join(here, 'samples/hello-world/main.js'), 'utf8');
check(importsOf(sample, 'hello-world/main.js'), 'hello-world/main.js');
if (sample.split('\n').length >= 150) fails.push('hello-world/main.js must stay under 150 lines');

for (const f of fs.readdirSync(here).filter((x) => x.endsWith('.md'))) {
  const md = fs.readFileSync(path.join(here, f), 'utf8');
  const blocks = [...md.matchAll(/```js\n([\s\S]*?)```/g)].map((b) => b[1]);
  const names = blocks.flatMap((b) => importsOf(b, f));
  if (names.length) check(names, f);
}

console.log(`guide.test.js: ${fails.length} problems`);
if (fails.length) { for (const f of fails) console.log('  ' + f); process.exit(1); }
