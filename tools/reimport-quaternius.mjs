// MESH-SIMP-01: re-import every content/meshes/quaternius/*.mesh.json that is above its triangle budget
// (tools/mesh-budgets.mjs) from design/meshes/quaternius/glTF/<name>.gltf, keeping the file's existing `mats` map.
// Usage: node tools/reimport-quaternius.mjs [--dry-run] [name ...]   (names without extension; default = all over budget).
// Meshes listed in content/manifest.json are written in canonical stringifyContent form, the others in the importer's packed form.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stringifyContent } from '../engine/index.js'; // engine/index.js: the public entry
import { runCli } from './gltf-import.mjs';
import { budgetFor } from './mesh-budgets.mjs';

const dir = 'content/meshes/quaternius';
const src = 'design/meshes/quaternius/glTF';
const argv = process.argv.slice(2);
const dry = argv.includes('--dry-run');
const only = argv.filter((a) => !a.startsWith('--'));
const names = fs.readdirSync(dir).filter((f) => f.endsWith('.mesh.json')).map((f) => f.replace('.mesh.json', '')).filter((n) => !only.length || only.includes(n));
const listed = new Set(JSON.parse(fs.readFileSync('content/manifest.json', 'utf8')).files); // manifest files must stay in stringifyContent form (content-canonical test)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reimport-'));
const rows = [];
for (const name of names) {
  const file = path.join(dir, `${name}.mesh.json`);
  const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
  const budget = budgetFor(name);
  if (!budget || cur.triCount <= budget) { rows.push([name, cur.triCount, cur.triCount, budget, 'ok']); continue; }
  const matsPath = path.join(tmp, `${name}.mats.json`);
  fs.writeFileSync(matsPath, JSON.stringify(cur.mats || {}));
  const r = await runCli([path.join(src, `${name}.gltf`), cur.id, '--mats', matsPath, '--simplify', String(budget), '--out', file, ...(dry ? ['--dry-run'] : [])]);
  if (!dry && listed.has(`meshes/quaternius/${name}.mesh.json`)) fs.writeFileSync(file, stringifyContent(JSON.parse(fs.readFileSync(file, 'utf8'))), 'utf8');
  rows.push([name, cur.triCount, r.report.triCount, budget, dry ? 'dry' : 'reimported']);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('name\tbefore\tafter\tbudget\tstatus');
for (const r of rows) console.log(r.join('\t'));
