// MESH-SIMP-01: re-import every content/meshes/quaternius/*.mesh.json that is above its triangle budget
// (tools/mesh-budgets.mjs) from design/meshes/quaternius/glTF/<name>.gltf, keeping the file's existing `mats` map.
// Usage: node tools/reimport-quaternius.mjs [--dry-run] [name ...]   (names without extension; default = all over budget).
// MESH-UVMAP-01: --uvmap re-imports with per-triangle palette keys from the colour texture (--uvmap auto, tools/uvmap.mjs); default names =
// the meshes placed in content/worlds/world_m1.world.json; every mesh is re-imported, within budget or not.
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
const uvmap = argv.includes('--uvmap');
const full = argv.includes('--full'); // MESH-FULL-01: never simplify; the budget is only reported (architecture 37.19)
const all = argv.includes('--all'); // every mesh in content/meshes/quaternius/, not just the placed ones
let only = argv.filter((a) => !a.startsWith('--'));
if (uvmap && !all && !only.length) { const w = fs.readFileSync('content/worlds/world_m1.world.json', 'utf8'); only = [...new Set([...w.matchAll(/quaternius\/([A-Za-z0-9_]+)/g)].map((m) => m[1]))].sort(); }
const names = fs.readdirSync(dir).filter((f) => f.endsWith('.mesh.json')).map((f) => f.replace('.mesh.json', '')).filter((n) => !only.length || only.includes(n));
const listed = new Set(JSON.parse(fs.readFileSync('content/manifest.json', 'utf8')).files); // manifest files must stay in stringifyContent form (content-canonical test)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reimport-'));
const rows = [];
for (const name of names) {
  const file = path.join(dir, `${name}.mesh.json`);
  const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
  const budget = budgetFor(name);
  if (!uvmap && !full && (!budget || cur.triCount <= budget)) { rows.push([name, cur.triCount, cur.triCount, budget, 'ok']); continue; }
  const t0 = Date.now();
  const matsPath = path.join(tmp, `${name}.mats.json`);
  fs.writeFileSync(matsPath, JSON.stringify(cur.mats || {}));
  const args = (m) => [path.join(src, `${name}.gltf`), cur.id, ...m, ...(budget && !full ? ['--simplify', String(budget)] : []), '--out', file, ...(dry ? ['--dry-run'] : [])];
  let r, mapped = uvmap;
  try { r = await runCli(args(uvmap ? ['--uvmap', 'auto'] : ['--mats', matsPath])); }
  catch (e) { // texture without a palette-map entry (leaves, grass, flowers): keep the file's existing `mats`
    if (!uvmap || !/palette-map has no entry/.test(e.message)) throw e;
    mapped = false; r = await runCli(args(['--mats', matsPath]));
  }
  if (!dry && listed.has(`meshes/quaternius/${name}.mesh.json`)) fs.writeFileSync(file, stringifyContent(JSON.parse(fs.readFileSync(file, 'utf8'))), 'utf8');
  rows.push([name, cur.triCount, r.report.triCount, budget, (dry ? 'dry' : 'reimported') + (full && budget && r.report.triCount > budget ? ' (over budget, kept)' : ''), ...(uvmap ? [mapped ? Object.entries(r.report.uvmap.tris).map(([k, n]) => `${k}=${n}`).join(' ') : '(mats kept)', `${Date.now() - t0}ms`] : [])]);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log("name	before	after	budget	status" + (uvmap ? "	keys	time" : ""));
for (const r of rows) console.log(r.join('\t'));
