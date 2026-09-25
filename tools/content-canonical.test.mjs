#!/usr/bin/env node
// tools/content-canonical.test.mjs (US-027c, follow-up of US-027b /
// US-026a-content, row 30h). Canonical-form guard: every file listed in
// content/manifest.json must equal stringifyContent(JSON.parse(text)) byte
// for byte, so a hand edit can never drift the on-disk key order/formatting
// away from what stringifyContent (US-027a, docs/architecture.md 21.6)
// would produce. `\r\n` is normalised to `\n` on both sides before
// comparing so the check is robust to a Windows checkout (git autocrlf).
//
// Plain Node ESM, no framework - matches tools/content-no-dual-source.test.mjs.
//
//   node tools/content-canonical.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifyContent } from '../engine/index.js'; // engine/index.js: the public entry, never a deep import

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

function lf(text) {
  return text.replace(/\r\n/g, '\n');
}

// --- fails on a shuffled-key fixture (constructed in-memory) ----------------
// Same check the real guard runs below (raw file text vs
// stringifyContent(JSON.parse(text))), but on an in-memory "file" whose
// keys are deliberately hand-written out of canonical order - simulating
// exactly the drift a hand edit of content/*.json can introduce, without
// touching any repo file.
{
  const shuffledFileText = [
    '{',
    '  "nextId": 1,',
    '  "kind": "level",',
    '  "id": "shuffle_fixture",',
    '  "schema": 1,',
    '  "title": "Shuffle Fixture",',
    '  "name": "shuffle_fixture",',
    '  "version": 1,',
    '  "cellSize": 1,',
    '  "size": {"h": 1, "w": 1},',
    '  "rows": [',
    '    "#"',
    '  ],',
    '  "legend": {"#": {"material": "stone", "kind": "wall"}},',
    '  "layers": [],',
    '  "start": {"facingDeg": 0, "x": 0.5, "y": 0.5},',
    '  "lights": [],',
    '  "props": [],',
    '  "interactables": [],',
    '  "triggers": [],',
    '  "markers": {},',
    '  "route": [],',
    '  "routeNotes": {}',
    '}',
    '',
  ].join('\n');
  const canonical = stringifyContent(JSON.parse(shuffledFileText));
  ok(
    'guard fails on a shuffled-key fixture (raw text with keys out of canonical order != stringifyContent output)',
    lf(shuffledFileText) !== lf(canonical)
  );
}

// --- passes on the actual repo content files --------------------------------
const manifestPath = path.join(CONTENT_DIR, 'manifest.json');
const manifestText = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText);

// The manifest describes itself too (US-027a convention: it is also
// canonical-form content), so check it alongside the files it lists.
const filesToCheck = ['manifest.json', ...manifest.files];

for (const rel of filesToCheck) {
  const full = path.join(CONTENT_DIR, rel);
  const raw = fs.readFileSync(full, 'utf8');
  const parsed = JSON.parse(raw);
  const canonical = stringifyContent(parsed);
  ok(`${rel} is in canonical form (stringifyContent byte for byte)`, lf(raw) === lf(canonical));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
