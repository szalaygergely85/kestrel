// S8-B2-02: per-mesh budget report for content/meshes (tris, ranges, bytes, collider kind, open-edge %).
//   node tools/validate-mesh.mjs [dir-or-file ...] [--max-tris 20000] [--max-ranges 8] [--max-bytes 1048576] [--json] [--strict]
// Report-only (MESH-FULL-01): over-budget rows are printed as warnings and the exit code is 0; --strict exits 1 when any mesh
// is over a global cap. The per-id triangle budget from mesh-budgets.mjs (budgetFor) is shown as a column + warning only.
// Read-only; works on the meta+bin and the legacy all-JSON form.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readMeshJSON } from './mesh-file.mjs';
import { budgetFor } from './mesh-budgets.mjs';

export const DEFAULT_BUDGET = Object.freeze({ maxTris: 20000, maxRanges: 8, maxBytes: 1024 * 1024 });

/** Share of unique edges (positions welded at 1e-5 m) used by exactly one triangle, in percent. 0 for a closed surface. */
export function openEdgePercent(pos, triCount) {
  const ids = new Map(), vid = new Int32Array(triCount * 3);
  for (let v = 0; v < triCount * 3; v++) {
    const k = `${Math.round(pos[v * 3] * 1e5)},${Math.round(pos[v * 3 + 1] * 1e5)},${Math.round(pos[v * 3 + 2] * 1e5)}`;
    let id = ids.get(k);
    if (id === undefined) ids.set(k, id = ids.size);
    vid[v] = id;
  }
  const edges = new Map();
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = vid[t * 3 + e], b = vid[t * 3 + (e + 1) % 3];
      if (a === b) continue;
      const k = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  let open = 0;
  for (const n of edges.values()) if (n === 1) open++;
  return edges.size ? (100 * open) / edges.size : 0;
}

/** Collider kind from the meta: 'none' (collide:false), 'proxy' (colliderB64 / colliderParts) or 'render' (collides on the render triangles). */
export function colliderKind(meta) {
  if (meta.collide === false) return 'none';
  if (meta.colliderB64 || meta.colliderParts) return 'proxy';
  return 'render';
}

/** @param {string} file a .mesh.json path @param {Partial<typeof DEFAULT_BUDGET>} [budget] */
export function analyzeMeshFile(file, budget = {}) {
  const b = { ...DEFAULT_BUDGET, ...budget };
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  let bytes = fs.statSync(file).size;
  if (typeof meta.bin === 'string') bytes += fs.statSync(path.join(path.dirname(file), meta.bin)).size;
  const full = typeof meta.bin === 'string' ? readMeshJSON(file) : meta;
  const tris = full.triCount ?? full.pos.length / 9;
  const row = { file: file.split(path.sep).join('/'), id: full.id, tris, ranges: (full.ranges || []).length, bytes, collider: colliderKind(meta), openEdgePct: Math.round(openEdgePercent(full.pos, tris) * 10) / 10, idBudget: budgetFor(full.id), over: [], warn: [] };
  if (row.idBudget != null && tris > row.idBudget) row.warn.push(`tris ${tris} > id budget ${row.idBudget}`);
  if (tris > b.maxTris) row.over.push(`tris ${tris} > ${b.maxTris}`);
  if (row.ranges > b.maxRanges) row.over.push(`ranges ${row.ranges} > ${b.maxRanges}`);
  if (bytes > b.maxBytes) row.over.push(`bytes ${bytes} > ${b.maxBytes}`);
  return row;
}

export function findMeshFiles(targets) {
  const out = [];
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const n of fs.readdirSync(p).sort()) walk(path.join(p, n));
    else if (p.endsWith('.mesh.json')) out.push(p);
  };
  for (const t of targets) walk(t);
  return out;
}

export function formatTable(rows) {
  const head = ['id', 'tris', 'idBudget', 'ranges', 'bytes', 'collider', 'open%', 'status'];
  const lines = [head, ...rows.map((r) => [r.id, r.tris, r.idBudget ?? '-', r.ranges, r.bytes, r.collider, r.openEdgePct, r.over.length ? 'OVER: ' + r.over.join('; ') : r.warn.length ? 'warn: ' + r.warn.join('; ') : 'ok'])].map((l) => l.map(String));
  const w = head.map((_, i) => Math.max(...lines.map((l) => l[i].length)));
  return lines.map((l) => l.map((c, i) => (i === 0 || i >= 5 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ').trimEnd()).join('\n');
}

export function runCli(argv) {
  const budget = {}, targets = [];
  let json = false, strict = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-tris') budget.maxTris = Number(argv[++i]);
    else if (a === '--max-ranges') budget.maxRanges = Number(argv[++i]);
    else if (a === '--max-bytes') budget.maxBytes = Number(argv[++i]);
    else if (a === '--json') json = true;
    else if (a === '--strict') strict = true;
    else if (a.startsWith('--')) throw new Error(`validate-mesh: unknown flag ${a}`);
    else targets.push(a);
  }
  for (const [k, v] of Object.entries(budget)) if (!(v > 0)) throw new Error(`validate-mesh: --${k} needs a positive number`);
  const rows = findMeshFiles(targets.length ? targets : [fileURLToPath(new URL('../content/meshes', import.meta.url))]).map((f) => analyzeMeshFile(f, budget));
  const over = rows.filter((r) => r.over.length);
  if (json) console.log(JSON.stringify({ meshes: rows, over: over.length }, null, 2));
  else console.log(formatTable(rows) + `\n${rows.length} meshes, ${over.length} over budget.`);
  return strict && over.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = runCli(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 2; }
}
