#!/usr/bin/env node
// OWN-REQ-005c (docs/backlog.md row 25z): `.vox` exporter - the reverse of
// tools/vox-import.mjs (OWN-REQ-005a/005b). Writes every VoxelModelDef
// currently in ASSETS.voxelModels (design/models/voxel_props.js,
// voxel_tower.js, voxel_world.js) out to a MagicaVoxel `.vox` file, so the
// owner can open/edit them in MagicaVoxel.
//
//   node tools/vox-export.mjs [--out <dir>] [--only name1,name2,...]
//
// Byte format is the exact mirror of what tools/vox-import.mjs's own
// parser (`parseVox`) and builder (`buildVoxelModel`) expect - see that
// file's header comment and its "---- scene graph (OWN-REQ-005b) ----"
// section for the chunk layouts and the world-space transform formula this
// is built against. Two output shapes, matching vox-import's own two
// supported paths exactly (no third shape invented):
//
//   'single' - one SIZE/XYZI model, no scene graph (v150). Used when a
//     model has exactly one part, OR when two or more of its parts have
//     OVERLAPPING declared boxes (see KNOWN LIMITATION below) - reimporting
//     these into vox-import always uses its single-`body`-part path
//     (`buildSinglePartModel`, used automatically whenever a file has no
//     scene graph at all).
//   'multi' - one SIZE/XYZI model PER PART plus a v200 scene graph
//     (`nTRN`/`nGRP`/`nSHP`/`LAYR`), one named LAYR per part (name = the
//     part's own name), so vox-import's multi-part reader
//     (`buildMultiPartModel`) reconstructs one part per named layer, in
//     the same order, with the same name. Used when a model has 2+ parts
//     whose declared boxes are pairwise non-overlapping (checked from the
//     model's own `parts[*].box` - see `chooseExportMode`).
//
// KNOWN LIMITATION (real content, found while building this tool's own
// round-trip test - not guessed at): a few hand-authored models
// deliberately have OVERLAPPING part boxes by design (VoxelModel.js's
// "first part wins" ownership rule allows this) - `lantern` (`glint`
// stored in a sealed cavity fully inside `lamp`'s box) and `relay`
// (`crystalDead`/`crystalLit` both inside `mount`'s box). vox-import's own
// multi-part builder (OWN-REQ-005b) HARD-REJECTS any pair of overlapping
// part boxes (its own AC, not a bug) - reimporting such a model's exact
// part structure through vox-import is therefore not possible without
// changing vox-import.mjs, which is out of scope here (new-file-only
// story). This exporter falls back to the 'single' shape for exactly
// those two models: the round trip still proves voxel-for-voxel and
// material-for-material fidelity for them, just not a part-by-part one
// (see docs/backlog.md row 25z for the full note).
//
// Palette: one MagicaVoxel palette index (1..255) is minted per distinct
// material key actually used in the model (first-encounter order scanning
// the model's own layers/mats), RGB = design/palette.js's own
// `materials[key].base` -> `rgb[base]` (that table already carries every
// voxel-prop material's colour - see design/README.md "MERGED" notes on
// voxel_props.js / voxel_tower.js / voxel_world.js). A `<name>.map.json`
// sidecar (palette index decimal string -> material key, the exact shape
// tools/vox-import.mjs's own `--map` wants) is written next to each
// `.vox` file so a real `--parts on|off` CLI re-import works immediately,
// no guessing indices by hand.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- low-level RIFF / .vox chunk writers (mirror of vox-import.mjs's readers) --

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}
function i32(n) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n | 0, 0);
  return b;
}
function chunk(id, content) {
  return Buffer.concat([Buffer.from(id, 'ascii'), u32(content.length), u32(0), content]);
}
function str(s) {
  const b = Buffer.from(String(s), 'utf8');
  return Buffer.concat([u32(b.length), b]);
}
function dict(obj) {
  const keys = Object.keys(obj);
  const parts = [u32(keys.length)];
  for (const k of keys) { parts.push(str(k)); parts.push(str(obj[k])); }
  return Buffer.concat(parts);
}
function sizeChunk(sx, sy, sz) {
  return chunk('SIZE', Buffer.concat([u32(sx), u32(sy), u32(sz)]));
}
function xyziChunk(voxels) {
  const body = Buffer.alloc(4 + voxels.length * 4);
  body.writeUInt32LE(voxels.length, 0);
  voxels.forEach((v, i) => {
    const o = 4 + i * 4;
    body[o] = v.x; body[o + 1] = v.y; body[o + 2] = v.z; body[o + 3] = v.c;
  });
  return chunk('XYZI', body);
}
function rgbaChunk(entries256) {
  const body = Buffer.alloc(256 * 4);
  for (let i = 0; i < 256; i++) {
    const e = entries256[i] || [0, 0, 0, 0];
    body[i * 4] = e[0]; body[i * 4 + 1] = e[1]; body[i * 4 + 2] = e[2]; body[i * 4 + 3] = e[3];
  }
  return chunk('RGBA', body);
}
/** One nTRN node: single frame, translation only (identity rotation - see
 * vox-import.mjs's ROTATION note; byte value 4 is identity, but the `_r`
 * key is simply omitted here, matching parseTranslation's "absent = no
 * rotation dict entry at all" path used by every existing test fixture). */
function ntrnChunk(nodeId, childId, layerId, t) {
  const frame = dict({ _t: `${t[0]} ${t[1]} ${t[2]}` });
  const body = Buffer.concat([u32(nodeId), dict({}), u32(childId), i32(-1), i32(layerId), u32(1), frame]);
  return chunk('nTRN', body);
}
function ngrpChunk(nodeId, childIds) {
  const body = Buffer.concat([u32(nodeId), dict({}), u32(childIds.length), ...childIds.map(u32)]);
  return chunk('nGRP', body);
}
function nshpChunk(nodeId, modelId) {
  const body = Buffer.concat([u32(nodeId), dict({}), u32(1), u32(modelId), dict({})]);
  return chunk('nSHP', body);
}
function layrChunk(layerId, name) {
  const body = Buffer.concat([u32(layerId), dict({ _name: name }), i32(-1)]);
  return chunk('LAYR', body);
}
function mainChunk(childrenBuf) {
  return Buffer.concat([Buffer.from('MAIN', 'ascii'), u32(0), u32(childrenBuf.length), childrenBuf]);
}
function voxFile(version, mainBuf) {
  return Buffer.concat([Buffer.from('VOX ', 'ascii'), u32(version), mainBuf]);
}

// ---- material / palette assignment --------------------------------------

/** Scans every layer/row/char of `def` in z,y,x order and returns the
 * distinct material keys actually used, in first-encounter order (this
 * order becomes the minted palette index, 1-based, matching what
 * tools/vox-import.mjs's `map.json` expects). Cells whose char maps to a
 * null/absent material (or the empty chars '.'/' ') are skipped. */
export function collectMaterials(def) {
  const [sx, sy, sz] = def.size;
  const orderedKeys = [];
  const seen = new Set();
  for (let z = 0; z < sz; z++) {
    const layer = def.layers[z];
    for (let y = 0; y < sy; y++) {
      const row = layer[y];
      for (let x = 0; x < sx; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const matKey = def.mats[ch];
        if (!matKey || seen.has(matKey)) continue;
        seen.add(matKey);
        orderedKeys.push(matKey);
      }
    }
  }
  if (orderedKeys.length > 255) {
    throw new Error(`vox-export: ${orderedKeys.length} distinct materials used, exceeds the 255 palette-index limit`);
  }
  const indexOf = new Map(orderedKeys.map((k, i) => [k, i + 1])); // 1-based, matches vox-import's XYZI `c` byte convention
  return { orderedKeys, indexOf };
}

/** RGBA entries (256, index i = palette color i+1) built from
 * design/palette.js's own `materials[key].base` -> `rgb[base]`. */
export function paletteEntries(orderedKeys, materials, rgb) {
  return orderedKeys.map((key) => {
    const matDef = materials[key];
    if (!matDef) throw new Error(`vox-export: material '${key}' not found in palette.materials`);
    const baseRgb = rgb[matDef.base];
    if (!baseRgb) throw new Error(`vox-export: material '${key}' base color '${matDef.base}' not found in palette.rgb`);
    return [baseRgb[0], baseRgb[1], baseRgb[2], 255];
  });
}

function boxesOverlap(a, b) {
  return a[0] < b[3] && b[0] < a[3] && a[1] < b[4] && b[1] < a[4] && a[2] < b[5] && b[2] < a[5];
}

/**
 * 'single' (one part, or 2+ parts with any pairwise overlapping box - see
 * this file's header KNOWN LIMITATION) or 'multi' (2+ parts, all pairwise
 * non-overlapping boxes - the only shape vox-import's multi-part builder
 * can reconstruct without its own overlap check rejecting it).
 */
export function chooseExportMode(def) {
  const names = Object.keys(def.parts);
  if (names.length <= 1) return 'single';
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (boxesOverlap(def.parts[names[i]].box, def.parts[names[j]].box)) return 'single';
    }
  }
  return 'multi';
}

// ---- export builders ------------------------------------------------------

function exportSingle(def, materials, rgb) {
  const [sx, sy, sz] = def.size;
  const { orderedKeys, indexOf } = collectMaterials(def);
  const voxels = [];
  for (let z = 0; z < sz; z++) {
    const layer = def.layers[z];
    for (let y = 0; y < sy; y++) {
      const row = layer[y];
      for (let x = 0; x < sx; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const matKey = def.mats[ch];
        if (!matKey) continue;
        voxels.push({ x, y, z, c: indexOf.get(matKey) });
      }
    }
  }
  const children = Buffer.concat([
    sizeChunk(sx, sy, sz),
    xyziChunk(voxels),
    rgbaChunk(paletteEntries(orderedKeys, materials, rgb))
  ]);
  const buffer = voxFile(150, mainChunk(children));
  const map = {};
  orderedKeys.forEach((k, i) => { map[String(i + 1)] = k; });
  return { buffer, map };
}

function exportMulti(def, materials, rgb) {
  const partNames = Object.keys(def.parts);
  const { orderedKeys, indexOf } = collectMaterials(def);

  const modelChunks = [];
  const partInfo = []; // { msx, msy, msz, x0, y0, z0 }
  partNames.forEach((pname) => {
    const [x0, y0, z0, x1, y1, z1] = def.parts[pname].box;
    const msx = x1 - x0, msy = y1 - y0, msz = z1 - z0;
    const voxels = [];
    for (let z = z0; z < z1; z++) {
      const layer = def.layers[z];
      for (let y = y0; y < y1; y++) {
        const row = layer[y];
        for (let x = x0; x < x1; x++) {
          const ch = row[x];
          if (ch === '.' || ch === ' ') continue;
          const matKey = def.mats[ch];
          if (!matKey) continue;
          voxels.push({ x: x - x0, y: y - y0, z: z - z0, c: indexOf.get(matKey) });
        }
      }
    }
    modelChunks.push(sizeChunk(msx, msy, msz));
    modelChunks.push(xyziChunk(voxels));
    partInfo.push({ msx, msy, msz, x0, y0, z0 });
  });

  const rgba = rgbaChunk(paletteEntries(orderedKeys, materials, rgb));

  // Scene graph: node0 nTRN (root, no translation) -> node1 nGRP -> per
  // part i: nTRN(translation = box origin + floor(local size / 2), so
  // vox-import's `local - floor(size/2) + translation` formula lands
  // exactly back on the original global box coordinates) -> nSHP(modelId
  // = i, matching the SIZE/XYZI pair order above) + a named LAYR(i).
  const partIds = partNames.map((_, i) => ({ trn: 2 + i * 2, shp: 2 + i * 2 + 1 }));
  const scene = [];
  scene.push(ntrnChunk(0, 1, -1, [0, 0, 0]));
  scene.push(ngrpChunk(1, partIds.map((p) => p.trn)));
  partNames.forEach((pname, i) => {
    const info = partInfo[i];
    const t = [
      info.x0 + Math.floor(info.msx / 2),
      info.y0 + Math.floor(info.msy / 2),
      info.z0 + Math.floor(info.msz / 2)
    ];
    scene.push(ntrnChunk(partIds[i].trn, partIds[i].shp, i, t));
    scene.push(nshpChunk(partIds[i].shp, i));
  });
  partNames.forEach((pname, i) => scene.push(layrChunk(i, pname)));

  const children = Buffer.concat([...modelChunks, rgba, ...scene]);
  const buffer = voxFile(200, mainChunk(children));
  const map = {};
  orderedKeys.forEach((k, i) => { map[String(i + 1)] = k; });
  return { buffer, map };
}

/**
 * @param {Object} def   a VoxelModelDef (engine/voxel/VoxelModel.js)
 * @param {Object} materials   design/palette.js `palette.materials`
 * @param {Object} rgb         design/palette.js `palette.rgb`
 * @returns {{mode:'single'|'multi', buffer:Buffer, map:Object<string,string>}}
 */
export function exportVoxelModel(def, materials, rgb) {
  const mode = chooseExportMode(def);
  const built = mode === 'multi' ? exportMulti(def, materials, rgb) : exportSingle(def, materials, rgb);
  return { mode, ...built };
}

// ---- loading the real content (design/palette.js + design/models/*.js) ----

/** Loads design/palette.js and every design/models/*.js file that sets
 * ASSETS.voxelModels, via CJS `require` (these are plain IIFE scripts, not
 * ES modules - see their own header comments) so real content need not be
 * duplicated or re-parsed by hand. Returns `{ palette, voxelModels }`.
 * Load order matters: palette.js first (materials/rgb), then voxel_props.js
 * (batch 1 - lever/lantern), voxel_tower.js (batch 2 - boulder, rubble0-2,
 * canvasHeap, gondola, strut, envelopeHeap, relay), voxel_world.js (batch 3
 * - waystone) - each ADDS to the same global ASSETS.voxelModels object,
 * same as loading them as <script> tags in order in a real page. */
export function loadRealVoxelModels() {
  const require = createRequire(import.meta.url);
  const root = path.resolve(__dirname, '..');
  require(path.join(root, 'design/palette.js'));
  require(path.join(root, 'design/models/voxel_props.js'));
  require(path.join(root, 'design/models/voxel_tower.js'));
  require(path.join(root, 'design/models/voxel_world.js'));
  const ASSETS = globalThis.ASSETS;
  if (!ASSETS || !ASSETS.palette || !ASSETS.voxelModels) {
    throw new Error('vox-export: expected design/palette.js + the voxel model files to set global ASSETS.palette/ASSETS.voxelModels');
  }
  // Filter out the non-model entries voxel_tower.js/voxel_world.js also
  // stash on ASSETS.voxelModels (attach()/attachTower()/attachWorld()
  // functions, the batch2/batch3 name-list arrays).
  const voxelModels = {};
  for (const key of Object.keys(ASSETS.voxelModels)) {
    const v = ASSETS.voxelModels[key];
    if (v && typeof v === 'object' && !Array.isArray(v) && v.voxel && typeof v.voxel === 'object') {
      voxelModels[key] = v;
    }
  }
  return { palette: ASSETS.palette, voxelModels };
}

// ---- CLI -------------------------------------------------------------------

const HELP = `vox-export - project VoxelModelDef -> MagicaVoxel .vox (OWN-REQ-005c)

Usage:
  node tools/vox-export.mjs [--out <dir>] [--only name1,name2,...]

Writes every ASSETS.voxelModels entry (design/models/voxel_props.js,
voxel_tower.js, voxel_world.js - the real, current content) to
<dir>/<name>.vox plus a <dir>/<name>.map.json sidecar (palette index ->
material key, the shape tools/vox-import.mjs's own --map wants).

Options:
  --out <dir>     output directory (default: content/vox)
  --only a,b,c    export only these model keys (default: all of them)
  --help          this text
`;

function parseArgs(argv) {
  const args = { only: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a === '--out') { args.out = argv[++i]; continue; }
    if (a === '--only') { args.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean); continue; }
  }
  return args;
}

/** Runs the CLI end-to-end (throws on error). Split out from `main()` so
 * both a real run and a test can drive it without touching process.exit. */
export function runCli(argv) {
  const args = parseArgs(argv);
  if (args.help) return { help: true, text: HELP };

  const { palette, voxelModels } = loadRealVoxelModels();
  const outDir = path.resolve(args.out || 'content/vox');
  fs.mkdirSync(outDir, { recursive: true });

  const names = args.only || Object.keys(voxelModels).sort();
  const written = [];
  for (const name of names) {
    const model = voxelModels[name];
    if (!model) throw new Error(`vox-export: no ASSETS.voxelModels.${name} (real model keys: ${Object.keys(voxelModels).sort().join(', ')})`);
    const { mode, buffer, map } = exportVoxelModel(model.voxel, palette.materials, palette.rgb);
    const voxPath = path.join(outDir, `${name}.vox`);
    const mapPath = path.join(outDir, `${name}.map.json`);
    fs.writeFileSync(voxPath, buffer);
    fs.writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n', 'utf8');
    written.push({ name, mode, voxPath, mapPath, bytes: buffer.length });
  }
  return { help: false, written, outDir };
}

function main() {
  try {
    const result = runCli(process.argv.slice(2));
    if (result.help) { console.log(result.text); return; }
    for (const w of result.written) {
      console.log(`vox-export: wrote ${w.voxPath} (${w.mode}, ${w.bytes} bytes) + ${w.mapPath}`);
    }
    console.log(`vox-export: ${result.written.length} model(s) written to ${result.outDir}`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();
