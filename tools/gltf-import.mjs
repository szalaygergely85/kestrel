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
import { budgetFor } from './mesh-budgets.mjs';
import { readPng } from './png-read.mjs';
import { textureTable, classify } from './uvmap.mjs'; // MESH-UVMAP-01
import { writeMeshFiles } from './mesh-file.mjs';
import { bakeVertexAo, writeVertexAo } from './vertex-ao.mjs'; // ME-20a
import { loadGltf, meshToJSON, meshFromJSON, validateMesh, planMeshCollision, stringifyContent, maskToJSON, downsampleAlpha } from '../engine/index.js'; // engine/index.js: the public entry, never a deep import

const HELP = `gltf-import - glTF/.glb static mesh -> content/meshes/<id>.mesh.json (ME-13b)

Usage:
  node tools/gltf-import.mjs <in.glb|in.gltf> <id> [options]

Required:
  <in.glb|in.gltf>    path to a glTF 2.0 file (.glb container, or a plain
                      .gltf JSON - its external .bin, if any, is read from
                      the same directory, named by the JSON's buffers[i].uri)
  <id>                MeshData id, e.g. "ruins/BlockNormalMD"

Options:
  --json              write the legacy single all-JSON file (default: <id>.mesh.json meta + <id>.mesh.bin, docs/mesh-bin.md)
  --out <path>        write the .mesh.json here instead of
                      content/meshes/<id>.mesh.json
  --mats <path>       material-name -> palette-key JSON map
  --uv <planar|source>  UVs: world-metre planar (default) or the file's TEXCOORD_0
  --uvmap <tex.png|auto>  MESH-UVMAP-01: one palette material per triangle, from the colour texture sampled at the triangle's centroid UV
                      ('auto' = the material's baseColorTexture of a .gltf). Overrides --mats; planar UVs are kept; works with --simplify/--budget
                      (simplified per key range, keys are never merged)
  --palette-map <json>  texture -> palette keys table for --uvmap (default design/meshes/quaternius/palette-map.json)
  --simplify <tris>   reduce to about <tris> triangles (quadric edge collapse, ME-SIMPLIFY-01; planar UVs only)
  --budget            --simplify to the per-mesh triangle budget of tools/mesh-budgets.mjs (by id basename)
  --ao [rays]         ME-20a, OPT-IN (default off = meshes unchanged): bake per-vertex ambient occlusion (hemisphere ray test, default 32 rays,
                      deterministic) into aux[5..7] of each triangle (AO of its 3 vertices, 1 = open); nothing reads it before ME-20b
  --masks <dir>       ALPHA-01a (arch 37.17), OPT-IN until ALPHA-01c is wired (default: none = ignore alpha, import as before): alpha-cutout materials
                      (glTF alphaMode MASK) become masked ranges (opaque ranges first, uvMask = TEXCOORD_0); the 8-bit alpha masks are written
                      to <dir>/<pack>/<texture>.mask.json (e.g. content/masks; 'none' = off).
                      Auto-opaque rule: a MASK material with no texel under its cutoff inside its UV region is imported opaque with a WARN
  --mask-res <n>      mask resolution, power of two <= 1024 (default 256; box-average downsample of the texture alpha)
  --opaque <names>    comma list of material names forced opaque although alphaMode is MASK
  --dry-run           parse and report only; write nothing

Output: content/meshes/<id>.mesh.json (MeshData, meshToJSON shape) plus a
stdout report (triangle count, smoothing-group count, unmapped material
names, if any). Throws (exit 1) on anything loadGltf itself rejects -
skinning, animation, morph targets, non-triangle primitives, quantized
accessors (ME-13a: static meshes only) - naming the file.
`;

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a === '--mats') { args.mats = argv[++i]; if (!args.mats) throw new Error('--mats needs a path'); continue; }
    if (a === '--uv') { args.uv = argv[++i]; if (args.uv !== 'planar' && args.uv !== 'source') throw new Error('--uv must be planar or source'); continue; }
    if (a === '--uvmap') { args.uvmap = argv[++i]; if (!args.uvmap) throw new Error('--uvmap needs a png path or auto'); continue; }
    if (a === '--palette-map') { args.paletteMap = argv[++i]; if (!args.paletteMap) throw new Error('--palette-map needs a path'); continue; }
    if (a === '--out') { args.out = argv[++i]; continue; }
    if (a === '--simplify') { args.simplify = Number(argv[++i]); if (!(args.simplify >= 4)) throw new Error('--simplify needs a triangle target >= 4'); continue; }
    if (a === '--budget') { args.budget = true; continue; }
    if (a === '--ao') { args.ao = /^\d+$/.test(argv[i + 1] || '') ? Number(argv[++i]) : true; continue; } // ME-20a
    if (a === '--masks') { args.masks = argv[++i]; if (!args.masks) throw new Error('--masks needs a directory or none'); continue; }
    if (a === '--mask-res') { args.maskRes = Number(argv[++i]); if (![16, 32, 64, 128, 256, 512, 1024].includes(args.maskRes)) throw new Error('--mask-res must be a power of two from 16 to 1024'); continue; }
    if (a === '--opaque') { args.opaque = (args.opaque || []).concat(String(argv[++i] || '').split(',').filter(Boolean)); if (!args.opaque.length) throw new Error('--opaque needs material names'); continue; }
    if (a === '--dry-run') { args.dryRun = true; continue; }
    if (a === '--json') { args.json = true; continue; } // MESH-BIN-01: legacy single all-JSON file instead of meta + .mesh.bin
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

/**
 * MESH-PHYS-01: add `collide: false` (walk-over piece) or the `collider` proxy (prism, <= 28 tris) to a static mesh json.
 * Optional `colliderParts` (material keys, e.g. a tree's trunk keys) restricts the prism to those ranges. Idempotent; the render data is untouched.
 */
export function withCollision(json) {
  if (json.layout !== 'static') return json;
  const plan = planMeshCollision(json.id, json.pos, { parts: json.colliderParts, ranges: json.ranges });
  const next = { ...json };
  delete next.collide; delete next.collider; delete next.castShadow;
  if (!plan.castShadow) next.castShadow = false; // MESH-SHADOW-01: same rule as walk-over
  if (!plan.collide) next.collide = false; else next.collider = plan.collider;
  return next;
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
 * @param {{buffers?: Buffer[], mats?: Record<string,string>}} [opts]
 * @param {Set<string>|null} [materialKeys]
 * @returns {{mesh: Object, json: Object, report: {triCount:number, groupCount:number, unmapped:string[]}}}
 */
export function importGltfBytes(bytes, id, opts = {}, materialKeys = null) {
  const mesh = loadGltf(bytes, id, opts);
  if (opts.ao) writeVertexAo(mesh, bakeVertexAo(mesh, { rays: opts.ao === true ? undefined : opts.ao })); // ME-20a: opt-in, per-vertex AO in aux[5..7]
  const { errors } = validateMesh(mesh);
  if (errors.length) throw new Error(`gltf-import: generated mesh failed validateMesh:\n${errors.join('\n')}`);
  const groupCount = countSmoothGroups(mesh);
  const unmapped = materialKeys ? mesh.matKeys.filter((k) => !materialKeys.has(opts.mats?.[k] || k)) : [];
  const json = { kind: 'mesh', schema: 1, id: mesh.id, nextId: 1, ...meshToJSON(mesh) };
  const mats = opts.mats === undefined ? {} : opts.mats;
  if (!mats || typeof mats !== 'object' || Array.isArray(mats) || Object.values(mats).some((v) => typeof v !== 'string' || !v)) throw new Error('gltf-import: --mats must be an object mapping material names to palette keys');
  json.mats = { ...mats };
  mesh.mats = json.mats;
  for (const key of ['pos', 'uv', 'uvMask', 'aux', 'bbox']) {
    if (!json[key]) continue;
    json[key] = json[key].map((v) => Math.round(v * 1e5) / 1e5);
  }
  const rounded = validateMesh(meshFromJSON(json));
  if (rounded.errors.length) throw new Error(`gltf-import: rounded mesh failed validateMesh:\n${rounded.errors.join('\n')}`);
  return { mesh, json, report: { triCount: mesh.triCount, groupCount, unmapped, warnings: opts.warnings || [], ranges: mesh.ranges.map((r) => ({ part: r.part, count: r.count, ...(r.mask ? { mask: r.mask } : {}) })) } };
}

/** MESH-UVMAP-01: the colour texture a .gltf's first material points at (absolute path), or null. */
function baseColorPng(gltfPath, raw) {
  let j; try { j = JSON.parse(raw.toString('utf8')); } catch { return null; }
  const ref = (j.materials || []).map((m) => m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture).find(Boolean);
  const img = ref && j.images && j.textures && j.images[j.textures[ref.index].source];
  return img && img.uri ? path.join(path.dirname(gltfPath), decodeURIComponent(img.uri)) : null;
}

/**
 * ALPHA-01a: for a .gltf, the downsampled alpha plane of every alphaMode MASK material's baseColorTexture, keyed by material name
 * (the shape loadGltf's opts.textures wants), plus the material's cutoff. PNG files are read here, never in the engine.
 * @returns {Record<string,{tex:string,w:number,h:number,alpha:Uint8Array,cutoff:number}>}
 */
export function readMaskTextures(gltfPath, json, id, maskRes = 256, cache = new Map()) {
  const out = {};
  const pack = id.includes('/') ? id.split('/')[0] : '';
  for (const m of json.materials || []) {
    if (m.alphaMode !== 'MASK' || !m.name) continue;
    const ref = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture;
    const img = ref && json.textures && json.images && json.images[json.textures[ref.index].source];
    if (!img || !img.uri || img.uri.startsWith('data:')) throw new Error(`gltf-import: MASK material "${m.name}" has no external baseColorTexture file (use --opaque ${m.name} or omit --masks)`);
    const file = path.join(path.dirname(gltfPath), decodeURIComponent(img.uri));
    const base = path.basename(file).replace(/\.png$/i, '');
    const tex = pack ? `${pack}/${base}` : base;
    let t = cache.get(file + '@' + maskRes);
    if (!t) {
      const png = readPng(fs.readFileSync(file));
      const a = new Uint8Array(png.width * png.height);
      for (let i = 0; i < a.length; i++) a[i] = png.data[i * 4 + 3];
      const dw = Math.min(maskRes, png.width), dh = Math.min(maskRes, png.height);
      if ((dw & (dw - 1)) || (dh & (dh - 1))) throw new Error(`gltf-import: ${file}: mask size ${dw}x${dh} is not a power of two (texture is ${png.width}x${png.height})`);
      t = { tex, w: dw, h: dh, alpha: downsampleAlpha(a, png.width, png.height, dw, dh) };
      cache.set(file + '@' + maskRes, t);
    }
    out[m.name] = { ...t, cutoff: typeof m.alphaCutoff === 'number' ? Math.round(m.alphaCutoff * 1e5) / 1e5 : 0.5 };
  }
  return out;
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

  // ALPHA-01a: alpha-cutout materials (a .gltf with external textures; --masks none = import as before)
  let maskTextures = null;
  const masksOn = !!args.masks && args.masks !== 'none'; // ALPHA-01b ARCH CHANGES: opt-in
  if (!isGlb(raw) && masksOn) {
    const gj = JSON.parse(raw.toString('utf8'));
    if ((gj.materials || []).some((m) => m.alphaMode === 'MASK')) {
      maskTextures = readMaskTextures(inPath, gj, id, args.maskRes || 256);
      opts.alpha = true; opts.textures = maskTextures; opts.opaque = args.opaque || []; opts.warnings = [];
    }
  } else if (args.opaque || args.maskRes) throw new Error('gltf-import: --opaque / --mask-res need a .gltf with MASK materials and without --masks <dir>');
  if (args.uv) opts.uv = args.uv;
  if (args.budget && !args.simplify) args.simplify = budgetFor(id) || 0;
  if (args.simplify) {
    const full = loadGltf(raw, id, opts).triCount; // untouched count -> ratio
    if (args.simplify < full) opts.simplifyRatio = args.simplify / full;
  }
  if (args.mats) opts.mats = JSON.parse(fs.readFileSync(args.mats, 'utf8'));
  const materialKeys = await loadEngineMaterialKeys();
  let uvInfo = null;
  if (args.uvmap) {
    if (args.mats) throw new Error('gltf-import: --uvmap and --mats are exclusive');
    if (args.uv === 'source') throw new Error('gltf-import: --uvmap keeps planar UVs (drop --uv source)');
    const pngPath = args.uvmap === 'auto' ? baseColorPng(inPath, raw) : args.uvmap;
    if (!pngPath) throw new Error(`gltf-import: --uvmap auto: no baseColorTexture found in '${inPath}'`);
    const texName = path.basename(pngPath).replace(/.png$/i, '');
    const map = JSON.parse(fs.readFileSync(args.paletteMap || fileURLToPath(new URL('../design/meshes/quaternius/palette-map.json', import.meta.url)), 'utf8'));
    const tab = textureTable(map, texName);
    if (materialKeys) { const miss = tab.keys.filter((k) => !materialKeys.has(k)); if (miss.length) throw new Error(`gltf-import: palette-map keys missing in the palette: ${miss.join(', ')} (NEEDS PC-A: designer key)`); }
    const img = readPng(fs.readFileSync(pngPath));
    // pass 1: count the first-choice key per triangle; keys with < 3 triangles are speckle -> demoted to the next nearest key
    const first = new Array(tab.keys.length).fill(0);
    loadGltf(raw, id, { ...opts, simplifyRatio: 0, triMat: (a, b, c) => { first[classify(img, tab, a, b, c).order[0]]++; return 'x'; } });
    const dead = new Set(first.map((n, i) => (n < 3 && first.some((m) => m >= 3) ? i : -1)).filter((i) => i >= 0));
    const unmapped = new Map();
    opts.triMat = (a, b, c) => {
      const r = classify(img, tab, a, b, c);
      if (r.d > tab.maxDelta) { const k = r.rgb.slice(0, 3).map((x) => (x >> 4) << 4).join(','); unmapped.set(k, (unmapped.get(k) || 0) + 1); }
      return tab.keys[r.order.find((i) => !dead.has(i))];
    };
    opts.mats = Object.fromEntries(tab.keys.map((k) => [k, k]));
    uvInfo = { texName, unmapped, dead: [...dead].map((i) => tab.keys[i]) };
  }
  let imp = importGltfBytes(raw, id, opts, materialKeys);
  // grouped simplification rounds up per key (min 4 tris): tighten the ratio until the triangle target is met
  for (let it = 0; uvInfo && args.simplify && imp.report.triCount > args.simplify && it < 6; it++) {
    opts.simplifyRatio = (opts.simplifyRatio || 1) * (args.simplify / imp.report.triCount) * 0.98;
    uvInfo.unmapped.clear();
    imp = importGltfBytes(raw, id, opts, materialKeys);
  }
  if (args.ao) { // ME-20a: bake ONCE on the final (simplified) geometry, not per simplify retry
    if (uvInfo) uvInfo.unmapped.clear();
    imp = importGltfBytes(raw, id, { ...opts, ao: args.ao }, materialKeys);
  }
  const { json: meshJson, report } = imp;
  if (uvInfo) {
    const per = {};
    for (const r of meshJson.ranges) { /* ranges are per key */ const k = r.part.split(':')[1] || meshJson.matKeys[0]; per[k] = (per[k] || 0) + r.count; }
    report.uvmap = { texture: uvInfo.texName, tris: per, demoted: uvInfo.dead, unmapped: [...uvInfo.unmapped].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5) };
  }

  const outPath = args.out || path.join('content', 'meshes', `${id}.mesh.json`);
  const masksDir = masksOn ? args.masks : 'content/masks';
  const usedMasks = [...new Set(meshJson.ranges.filter((r) => r.mask).map((r) => r.mask.tex))].sort();
  const maskFiles = usedMasks.map((tex) => {
    const entry = Object.values(maskTextures || {}).find((t) => t.tex === tex);
    return { file: path.join(masksDir, `${tex}.mask.json`), text: stringifyContent(maskToJSON(tex, entry.w, entry.h, entry.cutoff, entry.alpha)) };
  });
  if (!args.dryRun) {
    for (const mf of maskFiles) { fs.mkdirSync(path.dirname(mf.file), { recursive: true }); fs.writeFileSync(mf.file, mf.text, 'utf8'); }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    // MESH-BIN-01: <id>.mesh.json = meta + <id>.mesh.bin (docs/mesh-bin.md); `--json` or an --out not named *.mesh.json keeps the old all-JSON file
    if (!args.json && outPath.endsWith('.mesh.json')) writeMeshFiles(outPath, withCollision(meshJson));
    else fs.writeFileSync(outPath, stringifyMeshJSON(withCollision(meshJson)), 'utf8');
  }
  report.maskFiles = maskFiles.map((m) => m.file);
  return { help: false, wrote: args.dryRun ? null : outPath, report };
}

function printReport(label, report) {
  console.log(`gltf-import: ${label}: triCount=${report.triCount} groups=${report.groupCount}`);
  if (report.uvmap) {
    const u = report.uvmap;
    console.log(`gltf-import: ${label}: uvmap ${u.texture}: ${Object.entries(u.tris).map(([k, n]) => `${k}=${n}`).join(' ')}${u.demoted.length ? ` (speckle demoted: ${u.demoted.join(',')})` : ''}`);
    if (u.unmapped.length) console.log(`gltf-import: ${label}: uvmap unmapped colours (rgb/16 bucket: tris): ${u.unmapped.map(([k, n]) => `${k}:${n}`).join(' ')}`);
  }
  if (report.ranges && report.ranges.some((r) => r.mask) || (report.warnings && report.warnings.length)) {
    console.log(`gltf-import: ${label}: ${report.ranges.length} range(s): ${report.ranges.map((r) => `${r.part} ${r.count} tris ${r.mask ? `masked ${r.mask.tex}@${r.mask.cutoff}` : 'opaque'}`).join(' | ')}`);
  }
  for (const w of report.warnings || []) console.log(`gltf-import: ${label}: WARN ${w}`);
  if (report.maskFiles && report.maskFiles.length) console.log(`gltf-import: ${label}: mask file(s): ${report.maskFiles.join(', ')}`);
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
