#!/usr/bin/env node
// tools/vox-split.mjs (owner request, 2026-09-27: "separate them and import
// them" - the owner's free voxel pack in Vox/*.vox, 5 files with several
// unrelated models each, no node names).
//
// Splits one multi-model MagicaVoxel `.vox` file into one single-model
// `.vox` file per UNIQUE model (palette kept as-is, nothing else applied:
// no re-centring, no material remap - that's tools/vox-import.mjs's job,
// later, per model). Exact duplicates (same declared size + identical
// voxel set) are detected and skipped - only the first-seen copy gets its
// own file; every duplicate is recorded in the index pointing back at the
// model it duplicates.
//
// Also records, per model, which .vox scene-graph shape (`nSHP`) node(s)
// reference it (real MagicaVoxel scene graphs are always node-per-model
// here, per the real Vox/*.vox files checked while writing this: one nTRN
// -> nSHP pair per model under a single root nGRP, no names on any layer -
// so this is mostly a "no reuse found" report, but the field exists for any
// pack that DOES instance a model across several scene nodes).
//
//   node tools/vox-split.mjs Vox/<file>.vox --out design/vox/
//
// Reuses tools/voxParse.js (parseVox) - the exact same MagicaVoxel reader
// tools/vox-import.mjs and the editor's Import .vox button use - so a
// model split by this tool parses back byte-identical through the same
// path. Writes MagicaVoxel RIFF chunks directly (SIZE/XYZI/RGBA + MAIN),
// the same chunk shapes tools/vox-export.mjs already writes for its
// 'single' mode (mirrored here rather than imported, since vox-export.mjs
// only exports this project's own VoxelModelDef content, not arbitrary
// parsed .vox models).
//
// This tool only reads <in.vox> and writes under --out - it never touches
// design/models/*.js or any other content file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVox, paletteColor } from './voxParse.js';

// ---- low-level RIFF / .vox chunk writers (mirrors tools/vox-export.mjs) --

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function i32(n) { const b = Buffer.alloc(4); b.writeInt32LE(n | 0, 0); return b; }
function chunk(id, content) { return Buffer.concat([Buffer.from(id, 'ascii'), u32(content.length), u32(0), content]); }
function sizeChunk(sx, sy, sz) { return chunk('SIZE', Buffer.concat([u32(sx), u32(sy), u32(sz)])); }
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
function mainChunk(childrenBuf) { return Buffer.concat([Buffer.from('MAIN', 'ascii'), u32(0), u32(childrenBuf.length), childrenBuf]); }
function voxFile(version, mainBuf) { return Buffer.concat([Buffer.from('VOX ', 'ascii'), u32(version), mainBuf]); }

/** One single-model `.vox` buffer (v150, no scene graph - exactly the
 * shape tools/vox-import.mjs's `buildSinglePartModel` path (no scene
 * graph present) reads back). Palette carried through unchanged (256
 * entries, or all-transparent if the source file had none). */
export function buildSingleModelVox(model, palette) {
  const [sx, sy, sz] = model.size;
  const children = [sizeChunk(sx, sy, sz), xyziChunk(model.voxels)];
  if (palette) children.push(rgbaChunk(palette));
  return voxFile(150, mainChunk(Buffer.concat(children)));
}

// ---- duplicate detection --------------------------------------------------

/** A stable fingerprint for exact-duplicate detection: declared size +
 * every voxel (sorted, so two identical voxel SETS written in a different
 * order still fingerprint the same). */
export function fingerprintModel(model) {
  const [sx, sy, sz] = model.size;
  const rows = model.voxels.map((v) => `${v.x},${v.y},${v.z},${v.c}`).sort();
  return `${sx}x${sy}x${sz}|${rows.join(';')}`;
}

/** Walks `models`, returns one entry per model in original order:
 * `{ index, isUnique, duplicateOf }` - `duplicateOf` is the index of the
 * FIRST model with the identical fingerprint (null for the first/only copy
 * of a shape, which is the one considered "unique" and gets its own file). */
export function findDuplicates(models) {
  const seen = new Map(); // fingerprint -> first index
  return models.map((model, index) => {
    const fp = fingerprintModel(model);
    if (seen.has(fp)) return { index, isUnique: false, duplicateOf: seen.get(fp) };
    seen.set(fp, index);
    return { index, isUnique: true, duplicateOf: null };
  });
}

// ---- scene-node cross-reference (which nSHP nodes use which modelId) -----

/** `{ modelId: [{ nodeId, name }] }` for every reachable nSHP shape node in
 * the file's scene graph (or `{}` if the file has no scene graph at all -
 * a plain v150 file). `name` is the shape node's own `_name` attrib if
 * set, else its parent nTRN's `_name`, else `null` (the real packs checked
 * while writing this tool have neither - every layer/node is unnamed). */
export function mapSceneNodesToModels(scene) {
  const byModel = {};
  if (!scene) return byModel;
  const parentNameOfChild = new Map();
  for (const node of scene.nodes.values()) {
    if (node.type === 'nTRN' && node.attribs && node.attribs._name) {
      parentNameOfChild.set(node.childId, node.attribs._name);
    }
  }
  for (const node of scene.nodes.values()) {
    if (node.type !== 'nSHP') continue;
    const name = (node.attribs && node.attribs._name) || parentNameOfChild.get(node.nodeId) || null;
    for (const m of node.models) {
      (byModel[m.modelId] = byModel[m.modelId] || []).push({ nodeId: node.nodeId, name });
    }
  }
  return byModel;
}

// ---- per-model report data (bbox, dominant colors, 2D projections) -------

function hex(rgba) {
  if (!rgba) return null;
  const h = (n) => n.toString(16).padStart(2, '0');
  return `#${h(rgba[0])}${h(rgba[1])}${h(rgba[2])}`;
}

/** Tight bounding box of the voxels actually present (may be smaller than
 * the declared SIZE - real exports often pad). `[x0,y0,z0,x1,y1,z1]`
 * (x1/y1/z1 exclusive), or null for an empty model. */
export function tightBBox(voxels) {
  if (!voxels.length) return null;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const v of voxels) {
    if (v.x < x0) x0 = v.x; if (v.x + 1 > x1) x1 = v.x + 1;
    if (v.y < y0) y0 = v.y; if (v.y + 1 > y1) y1 = v.y + 1;
    if (v.z < z0) z0 = v.z; if (v.z + 1 > z1) z1 = v.z + 1;
  }
  return [x0, y0, z0, x1, y1, z1];
}

/** Top N palette colors by voxel count, descending, as
 * `[{ index, rgba, hex, count }]`. */
export function dominantColors(voxels, palette, n = 4) {
  const counts = new Map();
  for (const v of voxels) counts.set(v.c, (counts.get(v.c) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([index, count]) => {
      const rgba = paletteColor(palette, index);
      return { index, rgba, hex: hex(rgba), count };
    });
}

/** Small 2D colour projections for the contact-sheet preview: `front`
 * (looking along -y, i.e. the frontmost/min-y voxel wins per (x,z) column)
 * and `top` (looking down, the topmost/max-z voxel wins per (x,y) column).
 * Each is `{ w, h, cells }`, `cells` row-major top-to-bottom, one hex color
 * or null (empty) per cell - deliberately NOT the full voxel list, to keep
 * the eventual contact-sheet page small even for the largest models. */
export function projections(model, palette) {
  const [sx, sy, sz] = model.size;
  const front = { best: new Array(sx * sz).fill(null), bestY: new Array(sx * sz).fill(Infinity) };
  const top = { best: new Array(sx * sy).fill(null), bestZ: new Array(sx * sy).fill(-Infinity) };
  for (const v of model.voxels) {
    if (v.x < 0 || v.x >= sx || v.y < 0 || v.y >= sy || v.z < 0 || v.z >= sz) continue; // tolerate stray out-of-box voxels
    const c = hex(paletteColor(palette, v.c)) || '#888888';
    const fi = v.z * sx + v.x; // front cell (x, z)
    if (v.y < front.bestY[fi]) { front.bestY[fi] = v.y; front.best[fi] = c; }
    const ti = v.y * sx + v.x; // top cell (x, y)
    if (v.z > top.bestZ[ti]) { top.bestZ[ti] = v.z; top.best[ti] = c; }
  }
  // Row order: front is drawn top-down, so row 0 = highest z. Top is drawn
  // north-at-top the same way the game's y0=front convention reads, so row
  // 0 = smallest y (front row) - either is an arbitrary preview choice, not
  // a project convention, since this is foreign, unannotated art.
  const frontRows = [];
  for (let z = sz - 1; z >= 0; z--) frontRows.push(front.best.slice(z * sx, z * sx + sx));
  const topRows = [];
  for (let y = 0; y < sy; y++) topRows.push(top.best.slice(y * sx, y * sx + sx));
  return { front: { w: sx, h: sz, rows: frontRows }, top: { w: sx, h: sy, rows: topRows } };
}

// ---- fit check (mirrors tools/vox-import.mjs buildSinglePartModel rules) --

/** True if a single-part `body` import (buildSinglePartModel, the shape
 * this pack's models will use - none have named layers/groups) would
 * accept this model's size/voxel-count today, WITHOUT raising any engine
 * limit: <=32 per axis, <=4096 total voxels, and axis-sum <=48 (the
 * full-box single-part-box-extent rule). */
export function fitsCurrentLimits(size) {
  const [sx, sy, sz] = size;
  return sx <= 32 && sy <= 32 && sz <= 32 && sx * sy * sz <= 4096 && (sx + sy + sz) <= 48;
}

// ---- top-level split ------------------------------------------------------

/**
 * @param {Buffer|Uint8Array} voxBuffer  the source .vox file's raw bytes
 * @param {string} fileId  basename used for ids/filenames, e.g. 'buildings'
 * @returns {{ fileId, palette, entries: Array, files: Array<{id:string, buffer:Buffer}> }}
 *   `entries` is the full per-model report (including duplicates, unique or
 *   not); `files` is only the unique models, ready to write to disk.
 */
export function splitVoxFile(voxBuffer, fileId) {
  const parsed = parseVox(voxBuffer);
  const dupInfo = findDuplicates(parsed.models);
  const sceneByModel = mapSceneNodesToModels(parsed.scene);

  let uniqueCount = 0;
  const idByIndex = new Array(parsed.models.length).fill(null);
  const entries = [];
  const files = [];
  for (let i = 0; i < parsed.models.length; i++) {
    const model = parsed.models[i];
    const dup = dupInfo[i];
    const bbox = tightBBox(model.voxels);
    const voxelCount = model.voxels.length;
    const fits = fitsCurrentLimits(model.size);
    let id = null;
    if (dup.isUnique) {
      uniqueCount++;
      id = `${fileId}_${String(uniqueCount).padStart(2, '0')}`;
      idByIndex[i] = id;
      files.push({ id, buffer: buildSingleModelVox(model, parsed.palette) });
    }
    entries.push({
      modelIndex: i,
      id,
      size: model.size,
      voxelCount,
      bbox,
      // dup.duplicateOf, when set, is always the index of the FIRST (and
      // therefore always unique - findDuplicates only ever points at a
      // first occurrence) copy of this shape, so its id is already known.
      duplicateOf: dup.duplicateOf === null ? null : idByIndex[dup.duplicateOf],
      fits,
      fitsNote: fits ? null : 'needs mesh path (ME-07/voxelMesh) or a split - do NOT raise the engine limits',
      dominantColors: dominantColors(model.voxels, parsed.palette),
      sceneNodes: sceneByModel[i] || [],
      views: projections(model, parsed.palette)
    });
  }
  return {
    fileId,
    palette: parsed.palette,
    totalModels: parsed.models.length,
    uniqueModels: uniqueCount,
    duplicateModels: parsed.models.length - uniqueCount,
    entries,
    files
  };
}

// ---- CLI -------------------------------------------------------------------

const HELP = `vox-split - split a multi-model MagicaVoxel .vox into one file per unique model

Usage:
  node tools/vox-split.mjs <in.vox> --out <dir>

Writes <dir>/<name>/<name>_NN.vox (one per unique model, palette kept
as-is) + <dir>/<name>/index.json (per-model report: id, size, voxel count,
bbox, duplicate-of, fits-current-limits, dominant colors, scene-node
reuse, and small front/top colour projections for a contact-sheet preview).
Exact duplicate models (same size + identical voxel set) are skipped - no
file is written for them, only an index.json entry pointing at the model
they duplicate.
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a === '--out') { args.out = argv[++i]; continue; }
    args._.push(a);
  }
  return args;
}

export function runCli(argv) {
  const args = parseArgs(argv);
  if (args.help || args._.length === 0) return { help: true, text: HELP };
  const inPath = args._[0];
  if (!args.out) throw new Error('vox-split: --out <dir> is required (see --help)');

  const fileId = path.basename(inPath, path.extname(inPath));
  const buf = fs.readFileSync(inPath);
  const result = splitVoxFile(buf, fileId);

  const outDir = path.join(path.resolve(args.out), fileId);
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of result.files) {
    fs.writeFileSync(path.join(outDir, `${f.id}.vox`), f.buffer);
  }
  const indexPath = path.join(outDir, 'index.json');
  const indexJson = {
    file: fileId,
    sourceVox: inPath,
    totalModels: result.totalModels,
    uniqueModels: result.uniqueModels,
    duplicateModels: result.duplicateModels,
    models: result.entries
  };
  fs.writeFileSync(indexPath, JSON.stringify(indexJson, null, 2) + '\n', 'utf8');

  return { help: false, outDir, indexPath, written: result.files.length, ...result };
}

function main() {
  try {
    const result = runCli(process.argv.slice(2));
    if (result.help) { console.log(result.text); return; }
    console.log(`vox-split: ${result.fileId}: ${result.totalModels} model(s), ${result.uniqueModels} unique, ${result.duplicateModels} duplicate(s)`);
    console.log(`vox-split: wrote ${result.written} .vox file(s) + index.json under ${result.outDir}`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();
