#!/usr/bin/env node
// MESH-PHYS-01: writes the collision proxy (`collider`) / walk-over flag (`collide: false`) into mesh json.
//   node tools/gen-mesh-colliders.mjs [--check] [files or dirs...]   (default: content/meshes/quaternius, the placed Quaternius set; pass other paths explicitly)
// Idempotent; keeps each file's committed format: stringifyContent for registered (manifest) meshes, the importer's compact stringifyMeshJSON for the rest. --check writes nothing, exits 1 if a file would change.
import fs from 'node:fs';
import path from 'node:path';
import { stringifyContent } from '../engine/index.js';
import { withCollision, stringifyMeshJSON } from './gltf-import.mjs';

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
    const exploded = /"pos": \[\r?\n/.test(before); // one number per line = canonical (registered) form
    const out = (exploded ? stringifyContent : stringifyMeshJSON)(withCollision(JSON.parse(before)));
    const j = JSON.parse(out);
    tris += j.collider ? j.collider.length / 9 : 0;
    if (out !== before) {
      changed++;
      if (!check) fs.writeFileSync(f, out, 'utf8');
    }
    console.log(`${path.basename(f)}: ${j.collide === false ? 'collide:false' : `proxy ${j.collider.length / 9} tris`}${out !== before ? ' (updated)' : ''}`);
  }
  console.log(`gen-mesh-colliders: ${files.length} meshes, ${changed} ${check ? 'would change' : 'written'}`);
  if (check && changed) process.exit(1);
}
