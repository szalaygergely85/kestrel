#!/usr/bin/env node
// MESH-PHYS-01: writes the collision proxy (`collider`) / walk-over flag (`collide: false`) into mesh json.
//   node tools/gen-mesh-colliders.mjs [--check] [files or dirs...]   (default: content/meshes/quaternius, the placed Quaternius set; pass other paths explicitly)
// MESH-BIN-01: binary meshes (meta + .mesh.bin) are rewritten as the same pair (meta text and bin bytes compared by --check). Idempotent; legacy all-JSON files keep their committed format: stringifyContent for registered (manifest) meshes, the importer's compact stringifyMeshJSON for the rest. --check writes nothing, exits 1 if a file would change.
import fs from 'node:fs';
import path from 'node:path';
import { stringifyContent } from '../engine/index.js';
import { withCollision, stringifyMeshJSON } from './gltf-import.mjs';
import { readMeshJSON, renderMeshFiles } from './mesh-file.mjs';

function walk(p, out) {
  if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p).sort()) walk(path.join(p, f), out);
  else if (p.endsWith('.mesh.json')) out.push(p);
  return out;
}

const args = process.argv.slice(2);
if (process.argv[1] && process.argv[1].endsWith('gen-mesh-colliders.mjs')) {
  const check = args.includes('--check');
  const roots = args.filter((a) => !a.startsWith('--'));
  const files = [];
  for (const r of roots.length ? roots : ['content/meshes/quaternius']) walk(r, files);
  let changed = 0, tris = 0;
  for (const f of files) {
    const before = fs.readFileSync(f, 'utf8');
    const binary = typeof JSON.parse(before).bin === 'string';
    let out, j, binChanged = false;
    if (binary) {
      j = withCollision(readMeshJSON(f));
      const r = renderMeshFiles(f, j);
      out = r.metaText;
      const binFile = path.join(path.dirname(f), r.binName);
      binChanged = !fs.existsSync(binFile) || Buffer.compare(fs.readFileSync(binFile), r.bin) !== 0;
      if (!check && (binChanged || out !== before)) fs.writeFileSync(binFile, r.bin);
    } else {
      const exploded = /"pos": \[\r?\n/.test(before); // one number per line = canonical (registered) form
      out = (exploded ? stringifyContent : stringifyMeshJSON)(withCollision(JSON.parse(before)));
      j = JSON.parse(out);
    }
    tris += j.collider ? j.collider.length / 9 : 0;
    const changedHere = out !== before || binChanged;
    if (changedHere) {
      changed++;
      if (!check) fs.writeFileSync(f, out, 'utf8');
    }
    console.log(`${path.basename(f)}: ${j.collide === false ? 'collide:false' : `proxy ${j.collider.length / 9} tris`}${changedHere ? ' (updated)' : ''}`);
  }
  console.log(`gen-mesh-colliders: ${files.length} meshes, ${changed} ${check ? 'would change' : 'written'}`);
  if (check && changed) process.exit(1);
}
