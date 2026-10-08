// MESH-BIN-01: read/write content/meshes/<id>.mesh.json in both forms (docs/mesh-bin.md).
//   binary form : <id>.mesh.json = small meta (`"bin": "<id>.mesh.bin"`, ranges, mats, bbox, flags) + <id>.mesh.bin (streams)
//   legacy form : <id>.mesh.json holds every array (still loadable)
// `readMeshJSON` always returns the FULL json object (arrays included, importer rounding) that meshFromJSON / withCollision take;
// `renderMeshFiles` turns a full json into the exact bytes of both files (pure: gen-mesh-colliders --check compares them).
import fs from 'node:fs';
import path from 'node:path';
import { meshFromBin, meshFromJSON, meshToJSON, encodeMeshBin, meshBinMeta, stringifyContent } from '../engine/index.js';

const ROUND = ['pos', 'uv', 'uvMask', 'aux', 'bbox']; // the importer stores these at 1e-5 m; float32 -> 5 decimals is exact again

/** @param {string} file path of a .mesh.json @returns {Object} full json */
export function readMeshJSON(file) {
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof meta.bin !== 'string') return meta;
  const mesh = meshFromBin(meta, fs.readFileSync(path.join(path.dirname(file), meta.bin)));
  const full = { kind: meta.kind, schema: meta.schema, id: meta.id, nextId: meta.nextId, ...JSON.parse(JSON.stringify(meshToJSON(mesh))) };
  if (meta.colliderParts) full.colliderParts = meta.colliderParts; // importer hint for withCollision, kept in the meta
  for (const k of ROUND) if (full[k]) full[k] = full[k].map((v) => Math.round(v * 1e5) / 1e5);
  return full;
}

/** @returns {{metaText:string, bin:Uint8Array, binName:string}} */
export function renderMeshFiles(file, full) {
  const binName = path.basename(file).replace(/\.mesh\.json$/, '.mesh.bin');
  const mesh = meshFromJSON(full);
  const meta = { kind: 'mesh', schema: full.schema ?? 1, id: full.id, nextId: full.nextId ?? 1, ...meshBinMeta(mesh, binName), ...(full.colliderParts ? { colliderParts: full.colliderParts } : {}) };
  return { metaText: stringifyContent(meta), bin: encodeMeshBin(mesh), binName };
}

/** Writes the meta + bin pair next to `file`. */
export function writeMeshFiles(file, full) {
  const { metaText, bin, binName } = renderMeshFiles(file, full);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, metaText, 'utf8');
  fs.writeFileSync(path.join(path.dirname(file), binName), bin);
  return { metaBytes: Buffer.byteLength(metaText), binBytes: bin.length };
}
