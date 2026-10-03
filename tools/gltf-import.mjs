#!/usr/bin/env node
// ME-13b (docs/backlog.md "ME-13" row, docs/architecture.md 27.3/27.4):
// glTF/.glb static-mesh importer CLI, mirroring tools/vox-import.mjs's
// conventions (argv parsing, error-reporting style, runCli/main split so
// tests can drive it without process.exit).
//
//   node tools/gltf-import.mjs <in.glb|in.gltf> <id> [--out content/meshes/<id>.mesh.json]
//
// Reads the input file as bytes and calls loadGltf(buffer, id, opts) from
// engine/mesh/gltf.js (via engine/index.js - the stable public entry, no
// deep import). For a plain `.gltf` with an external `.bin` referenced by
// `buffers[i].uri`, this tool reads that file itself and passes its bytes
// via `opts.buffers[i]` - loadGltf's own header comment is explicit that
// external-buffer file I/O is the CALLER's job, never engine/mesh/gltf.js's
// (engine/mesh/* never touches the filesystem).
//
// Writes MeshData with floats rounded to 1e-5 and numeric arrays packed on
// one line, preserving the engine's meshToJSON shape and stable key order.
// The rounded file is validated through meshFromJSON before it is written.
//
// Prints a report: triangle count, smoothing-group count, and any material
// names on the mesh that have NO entry in our engine material map (checked
// the same way engine/render/MaterialTable.js's `hasKey` does: present in
// design/palette.js's `materials` table, or design/detail-pass.js's
// `materials`/`remap` tables). Reported as a warning list, never thrown -
// name -> engine-material resolution is this tool's job (ME-13a's
// docstring), not gltf.js's, and a *.mats.json sidecar is the natural next
// step once its exact shape is nailed down (not done here - see the
// handback note).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadGltf, meshToJSON, meshFromJSON, validateMesh } from '../engine/index.js'; // engine/index.js: the public entry, never a deep import

const HELP = `gltf-import - glTF/.glb static mesh -> content/meshes/<id>.mesh.json (ME-13b)

Usage:
  node tools/gltf-import.mjs <in.glb|in.gltf> <id> [options]

Required:
  <in.glb|in.gltf>    path to a glTF 2.0 file (.glb container, or a plain
                      .gltf JSON - its external .bin, if any, is read from
                      the same directory, named by the JSON's buffers[i].uri)
  <id>                MeshData id, e.g. "ruins/BlockNormalMD"

Options:
  --out <path>        write the .mesh.json here instead of
                      content/meshes/<id>.mesh.json
  --dry-run           parse and report only; write nothing

Output: content/meshes/<id>.mesh.json (MeshData, meshToJSON shape) plus a
stdout report (triangle count, smoothing-group count, unmapped material
names, if any). Throws (exit 1) on anything loadGltf itself rejects -
skinning, animation, morph targets, non-triangle primitives, quantized
accessors (ME-13a: static meshes only) - naming the file.
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a === '--out') { args.out = argv[++i]; continue; }
    if (a === '--dry-run') { args.dryRun = true; continue; }
    args._.push(a);
  }
  return args;
}

/** Resolves every `buffers[i].uri` that is a plain external file (not a
 * `data:` URI, not glTF-embedded) by reading it next to `gltfPath`. Only
 * meaningful for a plain `.gltf` (a `.glb` is self-contained) - loadGltf
 * ignores `opts.buffers` entries it doesn't need. Never throws on a missing
 * buffer itself: loadGltf produces the clearer "pass opts.buffers[i]" error
 * if a referenced file truly doesn't resolve, so this just best-effort
 * reads what it can find and lets loadGltf validate the rest. */
function readExternalBuffers(gltfPath, json) {
  const buffers = [];
  const list = (json && json.buffers) || [];
  const dir = path.dirname(gltfPath);
  for (let i = 0; i < list.length; i++) {
    const uri = list[i].uri;
    if (uri === undefined || uri.startsWith('data:')) continue; // embedded/data-uri: loadGltf handles it itself
    const decoded = decodeURIComponent(uri);
    const full = path.isAbsolute(decoded) ? decoded : path.join(dir, decoded);
    if (fs.existsSync(full)) buffers[i] = fs.readFileSync(full);
  }
  return buffers;
}

/** True if `buf` starts with the GLB magic ('glTF', little-endian). */
function isGlb(buf) {
  return buf.length >= 4 && buf.readUInt32LE(0) === 0x46546c67;
}

/** Counts distinct smoothing groups from `mesh.flat[0]` (planeId base,
 * full object + group identity per gltf.js's `meshPlaneIdBase`) - cheaper than
 * re-deriving groups from geometry, and exactly what the importer already
 * computed. */
export function countSmoothGroups(mesh) {
  const groups = new Set();
  const FLAT_STRIDE = 2;
  for (let v = 0; v < mesh.flat.length / FLAT_STRIDE; v++) {
    groups.add(mesh.flat[v * FLAT_STRIDE]);
  }
  return groups.size;
}

/** Loads design/palette.js + design/detail-pass.js the same "classic
 * script" way tools/validate-content.mjs does (side effect: populates
 * `globalThis.ASSETS`), then returns the set of material keys our engine
 * actually knows about - the same union engine/render/MaterialTable.js's
 * `hasKey` checks (`P.materials[key]` or `DP.materials[key]`/`DP.remap[key]`).
 * Best-effort: if design/ isn't loadable for some reason, returns null and
 * the caller skips the unmapped-material check after a warning (don't throw). */
export async function loadEngineMaterialKeys(load = (url) => import(url.href)) {
  try {
    const root = new URL('../', import.meta.url);
    globalThis.ASSETS = globalThis.ASSETS || {};
    await load(new URL('design/palette.js', root));
    await load(new URL('design/detail-pass.js', root));
    const P = globalThis.ASSETS.palette;
    const DP = globalThis.ASSETS.detailPass;
    const keys = new Set();
    if (P && P.materials) for (const k of Object.keys(P.materials)) keys.add(k);
    if (DP && DP.materials) for (const k of Object.keys(DP.materials)) keys.add(k);
    if (DP && DP.remap) for (const k of Object.keys(DP.remap)) keys.add(k);
    return keys;
  } catch (e) {
    console.warn(`gltf-import: WARNING engine material tables unavailable; unmapped-material check skipped (${e.message})`);
    return null;
  }
}

/** Pack numeric arrays while leaving metadata and material strings readable. */
export function stringifyMeshJSON(json) {
  // Match a complete JSON string first so numeric-looking material names stay untouched.
  return JSON.stringify(json, null, 2).replace(
    /"(?:[^"\\]|\\.)*"|\[[\s\d.,eE+\-]*\]/g,
    (token) => token[0] === '[' ? token.replace(/\s+/g, '') : token,
  ) + '\n';
}

/**
 * Runs the importer end-to-end on already-read bytes (split out from the
 * CLI's file-reading so tests can drive it with an in-memory fixture,
 * matching vox-import.mjs's runCli/core-function split).
 * @param {Buffer|Uint8Array} bytes
 * @param {string} id
 * @param {{buffers?: Buffer[]}} [opts]
 * @param {Set<string>|null} [materialKeys]
 * @returns {{mesh: Object, json: Object, report: {triCount:number, groupCount:number, unmapped:string[]}}}
 */
export function importGltfBytes(bytes, id, opts = {}, materialKeys = null) {
  const mesh = loadGltf(bytes, id, opts);
  const { errors } = validateMesh(mesh);
  if (errors.length) throw new Error(`gltf-import: generated mesh failed validateMesh:\n${errors.join('\n')}`);
  const groupCount = countSmoothGroups(mesh);
  const unmapped = materialKeys ? mesh.matKeys.filter((k) => !materialKeys.has(k)) : [];
  const json = meshToJSON(mesh);
  for (const key of ['pos', 'uv', 'aux', 'bbox']) {
    json[key] = json[key].map((v) => Math.round(v * 1e5) / 1e5);
  }
  const rounded = validateMesh(meshFromJSON(json));
  if (rounded.errors.length) throw new Error(`gltf-import: rounded mesh failed validateMesh:\n${rounded.errors.join('\n')}`);
  return { mesh, json, report: { triCount: mesh.triCount, groupCount, unmapped } };
}

/** Runs the CLI end-to-end (throws on error; caller prints/exits). */
export async function runCli(argv) {
  const args = parseArgs(argv);
  if (args.help || args._.length < 2) {
    return { help: true, text: HELP };
  }
  const [inPath, id] = args._;
  const raw = fs.readFileSync(inPath);

  let opts = {};
  if (!isGlb(raw)) {
    // Plain .gltf JSON: read any external .bin(s) ourselves (loadGltf never
    // does file I/O) before handing the bytes + opts.buffers to loadGltf.
    let json;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      throw new Error(`gltf-import: '${inPath}' is not a GLB and not valid JSON (${e.message})`);
    }
    opts.buffers = readExternalBuffers(inPath, json);
  }

  const materialKeys = await loadEngineMaterialKeys();
  const { json: meshJson, report } = importGltfBytes(raw, id, opts, materialKeys);

  const outPath = args.out || path.join('content', 'meshes', `${id}.mesh.json`);
  if (!args.dryRun) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, stringifyMeshJSON(meshJson), 'utf8');
  }
  return { help: false, wrote: args.dryRun ? null : outPath, report };
}

function printReport(label, report) {
  console.log(`gltf-import: ${label}: triCount=${report.triCount} groups=${report.groupCount}`);
  if (report.unmapped.length) {
    console.log(`gltf-import: ${label}: WARNING unmapped material name(s) (no engine materials/detailPass entry): ${report.unmapped.join(', ')}`);
  }
}

async function main() {
  try {
    const result = await runCli(process.argv.slice(2));
    if (result.help) {
      console.log(result.text);
      return;
    }
    printReport(result.wrote || '(dry-run)', result.report);
    if (result.wrote) console.log(`gltf-import: wrote ${result.wrote}`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();
