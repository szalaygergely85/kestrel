// MESH-BIN-01: Node-only test helper (named *.test.js so check-deps treats it as a test: it uses node:fs).
// Reads content/meshes/<id>.mesh.json in either form (meta + .mesh.bin, or the legacy all-JSON) and returns the FULL json object
// (arrays included) that `meshFromJSON` takes, so tests keep working on a converted tree.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { meshFromBin } from '../mesh/meshBin.js';
import { meshToJSON } from '../mesh/MeshData.js';

/** @param {string|URL} file path or file URL of a .mesh.json */
export function readMeshJSON(file) {
  const url = file instanceof URL ? file : pathToFileURL(resolve(file));
  const meta = JSON.parse(readFileSync(url, 'utf8'));
  if (typeof meta.bin !== 'string') return meta;
  const mesh = meshFromBin(meta, readFileSync(new URL(meta.bin, url)));
  const { kind, schema, id, nextId } = meta;
  return { kind, schema, id, nextId, ...JSON.parse(JSON.stringify(meshToJSON(mesh))) };
}

// Self-check when run directly.
if (process.argv[1] && process.argv[1].endsWith('meshFile.test.js')) {
  const j = readMeshJSON(new URL('../../content/meshes/ruins/Fences/Line.mesh.json', import.meta.url));
  if (!(j.pos.length > 0 && j.pos.length === j.triCount * 9)) { console.error('FAIL meshFile'); process.exitCode = 1; } else console.log('ok - readMeshJSON(Line)');
}
