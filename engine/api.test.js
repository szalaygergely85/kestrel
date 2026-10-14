// ENG-API-01a: engine/index.js exports == engine/api-1.0.json (docs/architecture.md 38.74).
// Replaces index.exports.test.js (its RTS-layer names are all in the manifest, so "defined" is covered).
// Update the manifest with: node tools/gen-api-manifest.mjs --write
import * as E from './index.js';
import { readManifest, currentExports, canonical, AREAS, TIERS, MANIFEST } from '../tools/gen-api-manifest.mjs';
import fs from 'node:fs';

const fails = [];
const m = readManifest();
const listed = m.names.map((n) => n.name);
const exported = Object.keys(E).filter((n) => n !== 'default');
const lset = new Set(listed); const eset = new Set(exported);
const extra = exported.filter((n) => !lset.has(n));
const gone = listed.filter((n) => !eset.has(n));
if (extra.length) fails.push('exported but not in engine/api-1.0.json (run tools/gen-api-manifest.mjs --write): ' + extra.join(', '));
if (gone.length) fails.push('in manifest but not exported by index.js: ' + gone.join(', '));
if (lset.size !== listed.length) fails.push('duplicate names in manifest');
if (E.default !== undefined) fails.push('index.js must not have a default export');
for (const n of m.names) {
  if (!AREAS.includes(n.area)) fails.push(`${n.name}: bad area ${n.area}`);
  if (!TIERS.includes(n.tier)) fails.push(`${n.name}: bad tier ${n.tier}`);
  if (eset.has(n.name) && E[n.name] === undefined) fails.push(`${n.name}: exported but undefined`);
}
for (const n of m.names) {
  if (n.tier === 'deprecated' && !(n.replacedBy && lset.has(n.replacedBy))) fails.push(`${n.name}: deprecated needs a replacedBy that exists in the manifest`);
  if (n.replacedBy && n.tier !== 'deprecated') fails.push(`${n.name}: replacedBy only on deprecated names`);
}
// canonical form: sorted, and a re-write of the same data is byte-identical (idempotent --write)
if (canonical(m.names) !== fs.readFileSync(MANIFEST, 'utf8')) fails.push('manifest is not canonical (run --write)');
const cur = await currentExports();
for (const c of cur) { const n = m.names.find((x) => x.name === c.name); if (n && n.area !== c.area) fails.push(`${c.name}: area ${n.area} != index.js group ${c.area}`); }

console.log(`api.test.js: ${exported.length} exported, ${listed.length} in manifest, ${fails.length} problems`);
if (fails.length) { for (const f of fails) console.log('  ' + f); process.exit(1); }
