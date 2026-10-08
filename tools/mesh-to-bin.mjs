#!/usr/bin/env node
// MESH-BIN-01: one-shot converter. Rewrites every legacy all-JSON content/meshes/**/*.mesh.json as meta + .mesh.bin
// (docs/mesh-bin.md) after proving the decoded MeshData is byte-identical to the JSON path.
//   node tools/mesh-to-bin.mjs [--dry] [files or dirs...]     (default: content/meshes)
import fs from 'node:fs';
import path from 'node:path';
import { meshFromJSON, meshFromBin } from '../engine/index.js';
import { readMeshJSON, renderMeshFiles, writeMeshFiles } from './mesh-file.mjs';

function walk(p, out) {
  if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p).sort()) walk(path.join(p, f), out);
  else if (p.endsWith('.mesh.json')) out.push(p);
  return out;
}

/** Byte-level equality of two MeshData (typed arrays by bytes, the rest by JSON). Returns '' or the first difference. */
export function meshDiff(a, b) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k], y = b[k];
    if (ArrayBuffer.isView(x) || ArrayBuffer.isView(y)) {
      if (!ArrayBuffer.isView(x) || !ArrayBuffer.isView(y) || x.constructor !== y.constructor || x.length !== y.length
        || Buffer.compare(Buffer.from(x.buffer, x.byteOffset, x.byteLength), Buffer.from(y.buffer, y.byteOffset, y.byteLength))) return k;
    } else if (JSON.stringify(x, k === 'mats' ? Object.keys(x || {}).sort() : undefined) !== JSON.stringify(y, k === 'mats' ? Object.keys(x || {}).sort() : undefined)) return k; // mats: key order is not semantic (canonical writer sorts)
  }
  return '';
}

if (process.argv[1] && process.argv[1].endsWith('mesh-to-bin.mjs')) {
  const dry = process.argv.includes('--dry');
  const roots = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const files = [];
  for (const r of roots.length ? roots : ['content/meshes']) walk(r, files);
  let before = 0, after = 0, n = 0;
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    if (typeof JSON.parse(text).bin === 'string') { after += text.length + fs.statSync(f.replace(/\.json$/, '.bin')).size; before += text.length + fs.statSync(f.replace(/\.json$/, '.bin')).size; continue; }
    const full = JSON.parse(text);
    const { metaText, bin, binName } = renderMeshFiles(f, full);
    const back = meshFromBin(JSON.parse(metaText), bin);
    const d = meshDiff(meshFromJSON(full), back);
    if (d) { console.error(`mesh-to-bin: ${f}: decoded mesh differs in "${d}"`); process.exit(1); }
    before += Buffer.byteLength(text); after += Buffer.byteLength(metaText) + bin.length; n++;
    if (!dry) writeMeshFiles(f, full);
    console.log(`${path.relative('content/meshes', f)}: ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB -> ${((Buffer.byteLength(metaText) + bin.length) / 1024).toFixed(1)} KB`);
  }
  console.log(`mesh-to-bin: ${n} converted${dry ? ' (dry)' : ''}, ${(before / 1048576).toFixed(2)} MB -> ${(after / 1048576).toFixed(2)} MB`);
}
