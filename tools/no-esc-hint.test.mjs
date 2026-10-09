#!/usr/bin/env node
// NO-ESC-01 guard (owner rule, design/style-guide.md section 0 rule 5): the UI never PRINTS an Esc
// close/back/leave hint. Esc may still work; it is just not written. Scans (1) every printable
// uiStyle field (text / hint / keys / parts) in ASSETS and (2) the string literals of the
// game/js UI text modules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../design/palette.js';
import '../design/models/title.js';
import '../design/models/menu_ui.js';
import '../design/models/notes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESC = /\besc(ape)?\b/i;
const bad = [];

// (1) uiStyle: printable keys only (rule/note fields legitimately describe Esc behaviour).
const PRINT_KEYS = new Set(['text', 'hint', 'hints', 'keys', 'footer', 'label']);
function walk(node, trail, printable) {
  if (typeof node === 'string') { if (printable && ESC.test(node)) bad.push(`ASSETS.uiStyle.${trail}: "${node}"`); return; }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) walk(v, trail + '.' + k, printable || PRINT_KEYS.has(k));
}
const ui = globalThis.ASSETS && globalThis.ASSETS.uiStyle;
if (!ui) { console.error('no ASSETS.uiStyle loaded'); process.exit(1); }
walk(ui, '', false);

// (2) game/js UI text modules: any non-comment line with an Esc inside a string literal.
const files = [];
(function collect(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) collect(p);
    else if (/\.js$/.test(e.name) && !/\.(test|preview)\.js$/.test(e.name)) files.push(p);
  }
})(path.join(ROOT, 'game/js/ui'));
files.push(path.join(ROOT, 'game/js/quest/noteRead.js'), path.join(ROOT, 'game/js/quest/dialogueView.js'));
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');                         // drop trailing comments
    if (/^\s*\*/.test(code)) return;
    for (const m of code.matchAll(/(['"`])((?:\.|(?!\1).)*)\1/g)) {
      if (/^(Escape)$/.test(m[2])) continue;                           // key code constant
      if (ESC.test(m[2])) bad.push(`${path.relative(ROOT, f)}:${i + 1}: ${m[0]}`);
    }
  });
}

if (bad.length) { console.error('Esc hint printed in the UI:\n  ' + bad.join('\n  ')); process.exit(1); }
console.log(`no-esc-hint: uiStyle printable fields + ${files.length} UI modules free of Esc hints PASS`);
