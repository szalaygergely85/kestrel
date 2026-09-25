#!/usr/bin/env node
// OWN-REQ-005a (docs/backlog.md row 25r): MagicaVoxel `.vox` importer, core
// split. Converts a MagicaVoxel `.vox` file into this project's
// VoxelModelDef (engine/voxel/VoxelModel.js, architecture.md 15.1) and
// prints (or writes) a `design/models/*.js`-style module snippet.
//
// OWN-REQ-005b (row 25r split) adds parts-from-layers/-groups on top: when
// the file has a MagicaVoxel v200 scene graph (`nTRN`/`nGRP`/`nSHP`, named
// by `LAYR`), each named layer (or, if the file has no named layers, each
// top-level group under the scene root) becomes one `parts` entry instead
// of a single `body` box. See the "---- scene graph (OWN-REQ-005b) ----"
// section below for the exact chunk layout and the world-space transform
// formula this is built against, and its "KNOWN LIMITATIONS" note for what
// is deliberately NOT supported (rotated nodes, animated nodes, >1 model
// per shape, mixed layer/group organization).
//
//   node tools/vox-import.mjs in.vox --map map.json --cell 0.05 [--anchor x,y,z] [--out model.js] [--name NAME] [--parts on|off]
//
// map.json shape: a plain JSON object mapping the MagicaVoxel palette index
// (as a decimal string, 1..255 - the byte value stored per-voxel in the
// XYZI chunk) to one of this project's material keys (a string), e.g.
//   { "1": "stone", "5": "brass_dark" }
// Every palette index actually USED by a voxel in the file must have an
// entry in map.json, or the tool exits with a clear error listing every
// unmapped index and its RGBA color (read from the file's own RGBA chunk,
// so you can tell which color is which).
//
// This tool only reads the .vox file and map.json named on the command
// line and writes to the file named by --out (or stdout) - it never
// touches design/.
//
// Format notes confirmed against engine/voxel/VoxelModel.js and
// design/models/voxel_props.js before writing this tool (do not change
// without re-checking both):
//   - `layers[z][y]` is a row STRING of `sx` characters; the character at
//     column x is voxel (x,y,z). z indexes the outer `layers` array, y
//     indexes rows within a layer, x is a row's characters. This is
//     EXACTLY the .vox axis order (SIZE gives [sx,sy,sz], XYZI gives
//     (x,y,z), .vox is already Z-up) - no axis swap is needed, we map
//     vox (x,y,z) -> project (x,y,z) directly.
//   - the empty-voxel character is '.' (see voxel_props.js `rep('.', 15)`
//     rows and VoxelModel.js's `validChars` default set, which always
//     treats '.' - and ' ' - as empty regardless of `mats`). A used
//     `mats` key must be one char in 0x21..0x7E; '.' (0x2E) is inside
//     that range but reserved for empty, so we never assign it to a
//     material.
//   - `anchor` is in voxel-cell units, default feet-centre [sx/2, sy/2, 0]
//     (voxel_props.js lever: anchor [7.5, 5.5, 0] for a 15x8 foot with
//     z0 = bottom).
//   - one root part `body` with `box: [0,0,0,sx,sy,sz]` and
//     `pivot: <anchor>` (parts pivot mirrors anchor in the lever/lantern
//     examples).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateVoxelModel, MAX_VOX_PARTS } from '../engine/index.js';

// ---- RIFF / .vox chunk parsing -----------------------------------------

/** Reads one chunk header at `off`. Returns byte ranges; does not care
 * whether the chunk id is recognized (unknown chunks are skipped by the
 * caller simply advancing to `.next`). */
function readChunkHeader(buf, off) {
  if (off + 12 > buf.length) throw new Error(`vox-import: truncated file (chunk header at byte ${off})`);
  const id = buf.toString('ascii', off, off + 4);
  const contentSize = buf.readUInt32LE(off + 4);
  const childrenSize = buf.readUInt32LE(off + 8);
  const contentStart = off + 12;
  const childrenStart = contentStart + contentSize;
  const next = childrenStart + childrenSize;
  if (next > buf.length) throw new Error(`vox-import: truncated file (chunk '${id}' at byte ${off} runs past end of file)`);
  return { id, contentSize, childrenSize, contentStart, childrenStart, next };
}

// ---- scene graph (OWN-REQ-005b) ----------------------------------------
//
// Chunk layouts below are the MagicaVoxel `.vox` "VOX EXTENSION" v200
// scene-graph chunks, as documented in the community-maintained spec
// (ephtracy/voxel-model's `MagicaVoxel-file-format-vox-extension.txt`,
// fetched and quoted while writing this tool - not re-derived from memory):
//   STRING := int32 len, then `len` raw bytes (no NUL terminator)
//   DICT   := int32 numPairs, then numPairs * (STRING key, STRING value)
//   ROTATION (int8, packed into a frame's `_r` dict value, itself a
//     decimal-ASCII string of that byte): bits 0-1 = row0's nonzero column
//     (0/1/2), bits 2-3 = row1's nonzero column, row2's column is whatever
//     is left; bit 4/5/6 = sign of row0/row1/row2. Byte value 4 (row0=col0
//     +, row1=col1 +, row2=col2 +) is the identity - this tool only
//     supports identity rotation (see KNOWN LIMITATIONS below).
//   nTRN := int32 nodeId, DICT nodeAttribs, int32 childId, int32 reservedId
//           (-1), int32 layerId, int32 numFrames, numFrames * DICT
//           frameAttribs (keys used here: `_t` = "x y z" decimal ints,
//           space-separated translation; `_r` = decimal-ASCII rotation byte)
//   nGRP := int32 nodeId, DICT nodeAttribs, int32 numChildren, numChildren *
//           int32 childId
//   nSHP := int32 nodeId, DICT nodeAttribs, int32 numModels, numModels *
//           (int32 modelId, DICT modelAttribs)
//   LAYR := int32 layerId, DICT layerAttribs (key `_name`), int32
//           reservedId (-1)
//
// World-space transform: per the community-documented convention for
// applying nTRN transforms to a shape's own voxel grid (independently
// confirmed via jpaver/opengametools ogt_vox usage notes, quoted while
// writing this tool), a leaf shape's local voxel (x,y,z) in a model of
// size (sx,sy,sz) maps to world space as
//   world = (x,y,z) - floor(size/2) + sum(_t along the nTRN chain root->leaf)
// (the `+0.5` center-of-voxel offset and the rotation matrix both cancel
// out to this simple integer form when every rotation on the chain is
// identity - see the `_r` note above). This tool sums `_t` translations
// along the chain and applies the `- floor(size/2)` pivot shift once, at
// the shape's own model size; it does NOT implement the general rotation
// matrix.
//
// KNOWN LIMITATIONS (deliberate, not attempted - not guessed at, called
// out per OWN-REQ-005b's instruction to flag real format ambiguity rather
// than silently guess): a non-identity `_r` on any node in a used chain,
// more than one frame on any nTRN (animated scene graph), more than one
// model per nSHP, and a file that names SOME shapes' layers but not
// others (mixed layer/group organization) all throw a clear, specific
// error rather than producing a silently-wrong part placement. Deep
// nGRP-in-nGRP nesting IS supported (translations compose down the whole
// chain); only the leaf shape's own layerId (or, with no named layers, the
// leaf's top-level branch under the scene root) picks its part.

function readString(buf, off) {
  const len = buf.readUInt32LE(off);
  off += 4;
  const str = buf.toString('utf8', off, off + len);
  return { str, next: off + len };
}

function readDict(buf, off) {
  const numPairs = buf.readUInt32LE(off);
  off += 4;
  const dict = {};
  for (let i = 0; i < numPairs; i++) {
    const k = readString(buf, off); off = k.next;
    const v = readString(buf, off); off = v.next;
    dict[k.str] = v.str;
  }
  return { dict, next: off };
}

function readNTRN(buf, c) {
  let off = c.contentStart;
  const nodeId = buf.readUInt32LE(off); off += 4;
  const attribs = readDict(buf, off); off = attribs.next;
  const childId = buf.readUInt32LE(off); off += 4;
  off += 4; // reserved id, must be -1
  const layerId = buf.readInt32LE(off); off += 4;
  const numFrames = buf.readUInt32LE(off); off += 4;
  const frames = [];
  for (let i = 0; i < numFrames; i++) {
    const f = readDict(buf, off); off = f.next;
    frames.push(f.dict);
  }
  return { type: 'nTRN', nodeId, attribs: attribs.dict, childId, layerId, frames };
}

function readNGRP(buf, c) {
  let off = c.contentStart;
  const nodeId = buf.readUInt32LE(off); off += 4;
  const attribs = readDict(buf, off); off = attribs.next;
  const numChildren = buf.readUInt32LE(off); off += 4;
  const children = [];
  for (let i = 0; i < numChildren; i++) {
    children.push(buf.readUInt32LE(off));
    off += 4;
  }
  return { type: 'nGRP', nodeId, attribs: attribs.dict, children };
}

function readNSHP(buf, c) {
  let off = c.contentStart;
  const nodeId = buf.readUInt32LE(off); off += 4;
  const attribs = readDict(buf, off); off = attribs.next;
  const numModels = buf.readUInt32LE(off); off += 4;
  const models = [];
  for (let i = 0; i < numModels; i++) {
    const modelId = buf.readUInt32LE(off); off += 4;
    const modelAttribs = readDict(buf, off); off = modelAttribs.next;
    models.push({ modelId, attribs: modelAttribs.dict });
  }
  return { type: 'nSHP', nodeId, attribs: attribs.dict, models };
}

function readLAYR(buf, c) {
  let off = c.contentStart;
  const layerId = buf.readUInt32LE(off); off += 4;
  const attribs = readDict(buf, off); off = attribs.next;
  return { layerId, name: attribs.dict._name || null };
}

/**
 * Parses a MagicaVoxel `.vox` buffer (RIFF `VOX ` v150/v200).
 * @returns {{
 *   size: [number,number,number]|null, voxels: Array|null,
 *   palette: Array<[number,number,number,number]>|null,
 *   models: Array<{size:[number,number,number], voxels:Array}>,
 *   scene: {nodes: Map<number,Object>, layers: Map<number,{layerId:number,name:string|null}>}|null
 * }}
 */
export function parseVox(buf) {
  if (buf.length < 8 || buf.toString('ascii', 0, 4) !== 'VOX ') {
    throw new Error("vox-import: not a MagicaVoxel .vox file (missing 'VOX ' magic)");
  }
  const version = buf.readUInt32LE(4);
  if (version !== 150 && version !== 200) {
    // Not fatal - the chunk format has not changed across these versions in
    // practice; other tools export other version numbers too. We just note
    // it so a genuinely incompatible file is easier to diagnose later.
    console.error(`vox-import: warning - unexpected .vox version ${version} (expected 150 or 200), attempting to parse anyway`);
  }

  const main = readChunkHeader(buf, 8);
  if (main.id !== 'MAIN') throw new Error(`vox-import: expected a MAIN chunk at byte 8, got '${main.id}'`);

  let palette = null;
  let pendingSize = null;
  const models = [];
  const nodes = new Map();
  const layers = new Map();

  let off = main.childrenStart;
  const end = main.childrenStart + main.childrenSize;
  while (off < end) {
    const c = readChunkHeader(buf, off);
    if (c.id === 'SIZE') {
      pendingSize = [buf.readUInt32LE(c.contentStart), buf.readUInt32LE(c.contentStart + 4), buf.readUInt32LE(c.contentStart + 8)];
    } else if (c.id === 'XYZI') {
      if (!pendingSize) throw new Error('vox-import: an XYZI chunk appears before any SIZE chunk');
      const n = buf.readUInt32LE(c.contentStart);
      const voxels = [];
      for (let i = 0; i < n; i++) {
        const b = c.contentStart + 4 + i * 4;
        voxels.push({ x: buf[b], y: buf[b + 1], z: buf[b + 2], c: buf[b + 3] });
      }
      models.push({ size: pendingSize, voxels });
      pendingSize = null;
    } else if (c.id === 'RGBA') {
      palette = [];
      for (let i = 0; i < 256; i++) {
        const b = c.contentStart + i * 4;
        palette.push([buf[b], buf[b + 1], buf[b + 2], buf[b + 3]]);
      }
    } else if (c.id === 'nTRN') {
      const node = readNTRN(buf, c);
      nodes.set(node.nodeId, node);
    } else if (c.id === 'nGRP') {
      const node = readNGRP(buf, c);
      nodes.set(node.nodeId, node);
    } else if (c.id === 'nSHP') {
      const node = readNSHP(buf, c);
      nodes.set(node.nodeId, node);
    } else if (c.id === 'LAYR') {
      const layer = readLAYR(buf, c);
      layers.set(layer.layerId, layer);
    }
    // Any other chunk id (PACK, MATL, rOBJ, NOTE, ...) is skipped safely: we
    // just advance past its content+children bytes without interpreting it.
    off = c.next;
  }

  if (!models.length) throw new Error('vox-import: no SIZE/XYZI chunk pair found in the .vox file');
  const scene = nodes.size ? { nodes, layers } : null;
  return { size: models[0].size, voxels: models[0].voxels, palette, models, scene };
}

// ---- material-char assignment -------------------------------------------

const EMPTY_CHAR = '.';
// 0x21..0x7E minus '.' (0x2E, reserved for empty) - see VoxelModel.js's
// `validChars` default set and the mats key-range rule (rule 3).
const CHAR_POOL = [];
for (let code = 0x21; code <= 0x7E; code++) {
  const ch = String.fromCharCode(code);
  if (ch !== EMPTY_CHAR) CHAR_POOL.push(ch);
}

/** RGBA for palette (color) index `c` (1..255, the byte stored in XYZI),
 * or null if the file had no RGBA chunk. */
function paletteColor(palette, c) {
  if (!palette) return null;
  const entry = palette[c - 1];
  return entry || null;
}

// ---- build the VoxelModelDef --------------------------------------------

/** Builds the `mats`/`layers` half of a VoxelModelDef from a flat voxel
 * list (already in final, non-negative grid coordinates) + declared size.
 * Shared by the single-part and multi-part builders below so both apply
 * the exact same palette/char-assignment rules. */
function buildMatsAndLayers(sx, sy, sz, voxels, map, palette) {
  const used = new Set();
  for (const v of voxels) {
    if (v.x < 0 || v.y < 0 || v.z < 0 || v.x >= sx || v.y >= sy || v.z >= sz) {
      throw new Error(`vox-import: voxel (${v.x},${v.y},${v.z}) is outside the declared size [${sx}, ${sy}, ${sz}]`);
    }
    used.add(v.c);
  }
  const usedSorted = [...used].sort((a, b) => a - b);

  const unmapped = usedSorted.filter((c) => !Object.prototype.hasOwnProperty.call(map, String(c)));
  if (unmapped.length) {
    const lines = unmapped.map((c) => {
      const rgba = paletteColor(palette, c);
      const colorText = rgba ? `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3]})` : '(no RGBA chunk in file, color unknown)';
      return `  palette index ${c}: ${colorText}`;
    });
    throw new Error(
      `vox-import: ${unmapped.length} palette index(es) used in the file are not mapped in map.json:\n${lines.join('\n')}\n` +
      `Add each one to map.json, e.g. { "${unmapped[0]}": "your_material_key" }`
    );
  }
  if (usedSorted.length > CHAR_POOL.length) {
    throw new Error(`vox-import: ${usedSorted.length} distinct materials used, exceeds the ${CHAR_POOL.length} available mats chars`);
  }

  // Assign one mats char per used palette index, in ascending index order.
  const charOf = new Map();
  const mats = {};
  usedSorted.forEach((c, i) => {
    const ch = CHAR_POOL[i];
    charOf.set(c, ch);
    mats[ch] = map[String(c)];
  });

  // layers[z][y] = row string of sx chars (direct vox (x,y,z) -> project
  // (x,y,z) mapping, see the header comment).
  const grid = [];
  for (let z = 0; z < sz; z++) {
    const rows = [];
    for (let y = 0; y < sy; y++) rows.push(new Array(sx).fill(EMPTY_CHAR));
    grid.push(rows);
  }
  for (const v of voxels) {
    grid[v.z][v.y][v.x] = charOf.get(v.c);
  }
  const layersOut = grid.map((rows) => rows.map((row) => row.join('')));
  return { mats, layers: layersOut };
}

/**
 * @param {{size:[number,number,number], voxels:Array<{x:number,y:number,z:number,c:number}>, palette:Array|null}} parsed
 * @param {Object<string,string>} map   palette index (decimal string) -> material key
 * @param {number} cellM
 * @param {[number,number,number]} [anchor]
 * @returns {Object} VoxelModelDef
 */
function buildSinglePartModel(parsed, map, cellM, anchor) {
  const [sx, sy, sz] = parsed.size;

  if (sx > 32 || sy > 32 || sz > 32) {
    throw new Error(`vox-import: dimension too large - size [${sx}, ${sy}, ${sz}] exceeds 32 on at least one axis`);
  }
  const total = sx * sy * sz;
  if (total > 4096) {
    throw new Error(`vox-import: size [${sx}, ${sy}, ${sz}] = ${total} voxels, exceeds the 4096 limit`);
  }
  // One root `body` part covering the full box (`--parts off`, or no usable
  // scene graph found): VoxelModel.js rule 5 caps a part's box extent
  // (bx+by+bz) at 48, so a full-box single part additionally needs
  // sx+sy+sz <= 48. (OWN-REQ-005b's parts-from-layers path does not have
  // this restriction - each part's own, smaller box is checked instead.)
  if (sx + sy + sz > 48) {
    throw new Error(
      `vox-import: size [${sx}, ${sy}, ${sz}] sums to ${sx + sy + sz}, exceeds 48 - a single full-box 'body' part ` +
      `cannot cover it (VoxelModel.js part-box extent limit). Use the .vox file's layers/groups (--parts on, the ` +
      `default) to split it into smaller parts instead.`
    );
  }

  const { mats, layers } = buildMatsAndLayers(sx, sy, sz, parsed.voxels, map, parsed.palette);
  const finalAnchor = anchor || [sx / 2, sy / 2, 0];

  return {
    version: 1,
    cellM,
    size: [sx, sy, sz],
    anchor: finalAnchor,
    mats,
    layers,
    parts: {
      body: { box: [0, 0, 0, sx, sy, sz], pivot: finalAnchor }
    }
  };
}

// ---- OWN-REQ-005b: parts from the .vox scene graph ------------------------

/** Parses an nTRN frame's `_t` dict value ("x y z", decimal ints,
 * space-separated) into [x,y,z]. Missing/absent = [0,0,0]. */
function parseTranslation(t) {
  if (t === undefined) return [0, 0, 0];
  const parts = t.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
    throw new Error(`vox-import: nTRN frame '_t' value '${t}' is not "x y z" decimal ints`);
  }
  return parts;
}

const IDENTITY_ROTATION_BYTE = 4; // row0=col0+, row1=col1+, row2=col2+ (see the ROTATION note above)

/** Depth-first-walks the scene graph from node id 0 (the MagicaVoxel scene
 * root convention), returns one entry per reachable leaf shape:
 *   { layerId, topBranchId, topBranchName, modelId, translation }
 * `topBranchId`/`topBranchName` are the "top-level group" fallback
 * grouping key/name, used only when the file has no named LAYR layers -
 * see the `branch` comment on `visit()` below for exactly how they're
 * picked. */
function walkVoxScene(scene) {
  const root = scene.nodes.get(0);
  if (!root || root.type !== 'nTRN') {
    throw new Error('vox-import: expected the scene graph root to be node id 0, an nTRN chunk');
  }
  const shapeInstances = [];
  const path = new Set();

  function nodeName(node) {
    return (node && node.attribs && node.attribs._name) || null;
  }

  // `branch` identifies the "top-level group" fallback grouping key (used
  // only when the file has no named LAYR layers): the FIRST nGRP found
  // along a path assigns each of its own children one distinct branch (id
  // = that child's node id); everything below one such child shares its
  // branch. If no nGRP is ever found before an nSHP, that nSHP is its own,
  // sole branch (a single-object/no-group file = one part). The branch's
  // display name is filled in from the branch node's own nTRN `_name`
  // attribute the first time we visit an nTRN with a branch already
  // assigned but not yet named.
  function visit(nodeId, cumT, layerCtx, branch) {
    if (path.has(nodeId)) throw new Error(`vox-import: scene graph cycle detected at node ${nodeId}`);
    path.add(nodeId);
    try {
      const node = scene.nodes.get(nodeId);
      if (!node) throw new Error(`vox-import: scene graph references unknown node id ${nodeId}`);

      if (node.type === 'nTRN') {
        if (node.frames.length !== 1) {
          throw new Error(`vox-import: nTRN node ${nodeId} has ${node.frames.length} frames - animated scene graphs are not supported`);
        }
        const frame = node.frames[0];
        if (frame._r !== undefined && Number(frame._r) !== IDENTITY_ROTATION_BYTE) {
          throw new Error(`vox-import: nTRN node ${nodeId} has a non-identity rotation (_r=${frame._r}) - rotated parts are not supported`);
        }
        const t = parseTranslation(frame._t);
        const newCumT = [cumT[0] + t[0], cumT[1] + t[1], cumT[2] + t[2]];
        const newLayerCtx = node.layerId >= 0 ? node.layerId : layerCtx;
        const newBranch = branch && branch.name === null ? { id: branch.id, name: nodeName(node) } : branch;
        visit(node.childId, newCumT, newLayerCtx, newBranch);
      } else if (node.type === 'nGRP') {
        if (!branch) {
          for (const childId of node.children) visit(childId, cumT, layerCtx, { id: childId, name: null });
        } else {
          for (const childId of node.children) visit(childId, cumT, layerCtx, branch);
        }
      } else if (node.type === 'nSHP') {
        if (node.models.length !== 1) {
          throw new Error(`vox-import: nSHP node ${nodeId} references ${node.models.length} models - exactly 1 per shape is supported`);
        }
        const finalBranch = branch || { id: nodeId, name: nodeName(node) };
        shapeInstances.push({
          layerId: layerCtx,
          topBranchId: finalBranch.id,
          topBranchName: finalBranch.name,
          modelId: node.models[0].modelId,
          translation: cumT
        });
      } else {
        throw new Error(`vox-import: unknown scene node type at id ${nodeId}`);
      }
    } finally {
      path.delete(nodeId);
    }
  }

  visit(0, [0, 0, 0], -1, null);
  return shapeInstances;
}

/** part name sanitizer: NAME_RE in VoxelModel.js is
 * `^[A-Za-z][A-Za-z0-9_]{0,15}$` - map any raw layer/group name into that
 * shape, falling back to `part<N>` if nothing usable is left, and
 * disambiguate collisions with a numeric suffix. */
function sanitizePartName(raw, fallbackIndex, taken) {
  let s = String(raw == null ? '' : raw).replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z]/.test(s)) s = 'p' + s;
  s = s.slice(0, 16);
  if (!s) s = `part${fallbackIndex}`;
  let candidate = s;
  let n = 2;
  while (taken.has(candidate)) {
    const suffix = String(n++);
    candidate = s.slice(0, 16 - suffix.length) + suffix;
  }
  taken.add(candidate);
  return candidate;
}

/** Builds the parts-from-layers VoxelModelDef (OWN-REQ-005b). Throws a
 * clear error for anything the walk/grouping can't resolve unambiguously
 * (see the KNOWN LIMITATIONS note above the scene-graph chunk readers). */
function buildMultiPartModel(parsed, map, cellM, anchor) {
  const shapeInstances = walkVoxScene(parsed.scene);
  if (!shapeInstances.length) {
    throw new Error('vox-import: the .vox scene graph has no reachable nSHP (shape) nodes');
  }

  const namedCount = shapeInstances.filter((s) => {
    const l = parsed.scene.layers.get(s.layerId);
    return l && l.name;
  }).length;
  let groupingMode;
  if (namedCount === shapeInstances.length) groupingMode = 'layer';
  else if (namedCount === 0) groupingMode = 'group';
  else {
    throw new Error(
      'vox-import: some shapes are on a named LAYR layer and others are not - mixed layer/group organization ' +
      'is not supported; name every layer in MagicaVoxel, or remove all layer names and use groups instead'
    );
  }

  // First-encounter order (walk/file order) decides part order - the AC
  // requires the root part to be "the first layer" (or group).
  const order = []; // groupKey, in first-seen order
  const groups = new Map(); // groupKey -> { rawName, shapeInstances: [] }
  for (const s of shapeInstances) {
    const key = groupingMode === 'layer' ? `layer:${s.layerId}` : `group:${s.topBranchId}`;
    if (!groups.has(key)) {
      order.push(key);
      const rawName = groupingMode === 'layer' ? parsed.scene.layers.get(s.layerId).name : s.topBranchName;
      groups.set(key, { rawName, shapeInstances: [] });
    }
    groups.get(key).shapeInstances.push(s);
  }

  if (order.length > MAX_VOX_PARTS) {
    throw new Error(`vox-import: ${order.length} parts found (one per named layer/group), exceeds the ${MAX_VOX_PARTS} limit`);
  }

  // Resolve every shape instance's model + world-space voxel positions
  // (still allowed to be negative here - shifted to a non-negative grid
  // below, once every part's voxels are known).
  const partVoxels = []; // parallel to `order`: Array<{x,y,z,c}>
  for (const key of order) {
    const group = groups.get(key);
    const voxels = [];
    for (const s of group.shapeInstances) {
      const model = parsed.models[s.modelId];
      if (!model) throw new Error(`vox-import: nSHP references model id ${s.modelId}, but the file only has ${parsed.models.length} SIZE/XYZI model(s)`);
      const [msx, msy, msz] = model.size;
      const pivotShift = [Math.floor(msx / 2), Math.floor(msy / 2), Math.floor(msz / 2)];
      for (const v of model.voxels) {
        voxels.push({
          x: v.x - pivotShift[0] + s.translation[0],
          y: v.y - pivotShift[1] + s.translation[1],
          z: v.z - pivotShift[2] + s.translation[2],
          c: v.c
        });
      }
    }
    if (!voxels.length) throw new Error(`vox-import: part '${group.rawName || key}' has no voxels`);
    partVoxels.push(voxels);
  }

  // Shift the whole model so its combined bounding box starts at (0,0,0),
  // same convention as the single-part builder.
  let gMinX = Infinity, gMinY = Infinity, gMinZ = Infinity;
  let gMaxX = -Infinity, gMaxY = -Infinity, gMaxZ = -Infinity;
  for (const voxels of partVoxels) {
    for (const v of voxels) {
      if (v.x < gMinX) gMinX = v.x; if (v.x > gMaxX) gMaxX = v.x;
      if (v.y < gMinY) gMinY = v.y; if (v.y > gMaxY) gMaxY = v.y;
      if (v.z < gMinZ) gMinZ = v.z; if (v.z > gMaxZ) gMaxZ = v.z;
    }
  }
  for (const voxels of partVoxels) {
    for (const v of voxels) { v.x -= gMinX; v.y -= gMinY; v.z -= gMinZ; }
  }
  const sx = gMaxX - gMinX + 1, sy = gMaxY - gMinY + 1, sz = gMaxZ - gMinZ + 1;
  if (sx > 32 || sy > 32 || sz > 32) {
    throw new Error(`vox-import: combined size [${sx}, ${sy}, ${sz}] exceeds 32 on at least one axis`);
  }
  if (sx * sy * sz > 4096) {
    throw new Error(`vox-import: combined size [${sx}, ${sy}, ${sz}] = ${sx * sy * sz} voxels, exceeds the 4096 limit`);
  }

  // Per-part tight bounding box + bottom-centre pivot, box-extent check,
  // and pairwise overlap check (validateVoxelModel does NOT catch
  // overlapping part boxes on its own - see the header note referencing
  // this AC).
  const taken = new Set();
  const partDefs = []; // { name, box, pivot }
  order.forEach((key, i) => {
    const group = groups.get(key);
    const voxels = partVoxels[i];
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const v of voxels) {
      if (v.x < x0) x0 = v.x; if (v.x + 1 > x1) x1 = v.x + 1;
      if (v.y < y0) y0 = v.y; if (v.y + 1 > y1) y1 = v.y + 1;
      if (v.z < z0) z0 = v.z; if (v.z + 1 > z1) z1 = v.z + 1;
    }
    const bx = x1 - x0, by = y1 - y0, bz = z1 - z0;
    if (bx + by + bz > 48) {
      throw new Error(`vox-import: part '${group.rawName || key}' box extent ${bx + by + bz} exceeds 48 (box [${x0},${y0},${z0},${x1},${y1},${z1}])`);
    }
    const name = sanitizePartName(group.rawName, i, taken);
    partDefs.push({ name, box: [x0, y0, z0, x1, y1, z1], pivot: [(x0 + x1) / 2, (y0 + y1) / 2, z0] });
  });

  for (let i = 0; i < partDefs.length; i++) {
    for (let j = i + 1; j < partDefs.length; j++) {
      const a = partDefs[i].box, b = partDefs[j].box;
      const overlap = a[0] < b[3] && b[0] < a[3] && a[1] < b[4] && b[1] < a[4] && a[2] < b[5] && b[2] < a[5];
      if (overlap) {
        throw new Error(`vox-import: part '${partDefs[i].name}' box [${a.join(',')}] overlaps part '${partDefs[j].name}' box [${b.join(',')}]`);
      }
    }
  }

  const allVoxels = partVoxels.flat();
  const { mats, layers } = buildMatsAndLayers(sx, sy, sz, allVoxels, map, parsed.palette);
  const finalAnchor = anchor || [sx / 2, sy / 2, 0];

  const parts = {};
  partDefs.forEach((p, i) => {
    parts[p.name] = i === 0 ? { box: p.box, pivot: p.pivot } : { box: p.box, pivot: p.pivot, parent: partDefs[0].name };
  });

  return {
    version: 1,
    cellM,
    size: [sx, sy, sz],
    anchor: finalAnchor,
    mats,
    layers,
    parts
  };
}

/**
 * @param {ReturnType<typeof parseVox>} parsed
 * @param {Object<string,string>} map   palette index (decimal string) -> material key
 * @param {number} cellM
 * @param {[number,number,number]} [anchor]
 * @param {{parts?: boolean}} [opts]   `parts: false` forces the OWN-REQ-005a
 *   single-`body`-part output even if the file has a usable scene graph
 *   (default: true - use the scene graph when one is present and has at
 *   least one reachable shape; otherwise this is a silent no-op fallback
 *   to the single-part output, same as OWN-REQ-005a on a v150 file with no
 *   scene graph at all).
 * @returns {Object} VoxelModelDef
 */
export function buildVoxelModel(parsed, map, cellM, anchor, opts) {
  const useParts = !opts || opts.parts !== false;
  if (useParts && parsed.scene) {
    return buildMultiPartModel(parsed, map, cellM, anchor);
  }
  return buildSinglePartModel(parsed, map, cellM, anchor);
}

// ---- module-snippet formatting -------------------------------------------

function jsStringLiteral(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function formatArray(a) {
  return `[${a.join(', ')}]`;
}

function formatMats(mats) {
  const keys = Object.keys(mats);
  if (!keys.length) return '{}';
  const lines = keys.map((k) => `      ${jsStringLiteral(k)}: ${jsStringLiteral(mats[k])}`);
  return `{\n${lines.join(',\n')}\n    }`;
}

function formatLayers(layers) {
  const lines = layers.map((rows, z) => {
    const rowsText = rows.map((r) => jsStringLiteral(r)).join(', ');
    return `      /* z${z} */ [${rowsText}]`;
  });
  return `[\n${lines.join(',\n')}\n    ]`;
}

function formatParts(parts) {
  const names = Object.keys(parts);
  const lines = names.map((name) => {
    const p = parts[name];
    const parentText = p.parent !== undefined ? `, parent: ${jsStringLiteral(p.parent)}` : '';
    return `      ${jsStringLiteral(name)}: { box: ${formatArray(p.box)}, pivot: ${formatArray(p.pivot)}${parentText} }`;
  });
  return `{\n${lines.join(',\n')}\n    }`;
}

/** Renders a `design/models/*.js`-style snippet (matches the literal style
 * of design/models/voxel_props.js: `ASSETS.voxelModels.<name> = { name, desc,
 * voxel: {...} }`). Caller drops this straight into a real model file. */
export function formatModule(name, def) {
  const partCount = Object.keys(def.parts).length;
  const descText = partCount > 1
    ? `Imported from .vox by tools/vox-import.mjs (OWN-REQ-005a/005b). ${partCount} parts from the file's layers/groups.`
    : `Imported from .vox by tools/vox-import.mjs (OWN-REQ-005a). One root 'body' part (--parts off, or no usable scene graph).`;
  return `ASSETS.voxelModels.${name} = {
  name: ${jsStringLiteral(name)},
  desc: ${jsStringLiteral(descText)},
  voxel: {
    version: 1,
    cellM: ${def.cellM},
    size: ${formatArray(def.size)},
    anchor: ${formatArray(def.anchor)},
    mats: ${formatMats(def.mats)},
    layers: ${formatLayers(def.layers)},
    parts: ${formatParts(def.parts)}
  }
};
`;
}

// ---- CLI ------------------------------------------------------------------

const HELP = `vox-import - MagicaVoxel .vox -> project VoxelModelDef (OWN-REQ-005a/005b)

Usage:
  node tools/vox-import.mjs <in.vox> --map <map.json> --cell <metres> [options]

Required:
  <in.vox>            path to a MagicaVoxel .vox file (RIFF 'VOX ', v150/v200)
  --map <map.json>     a JSON object mapping palette index (decimal string,
                        1..255 - the color byte stored per-voxel) to one of
                        this project's material keys, e.g.
                          { "1": "stone", "5": "brass_dark" }
                        Every palette index actually used in the file must
                        have an entry here.
  --cell <metres>       cellM for the output model, 0.01..1 (VoxelModel.js)

Options:
  --anchor x,y,z        anchor in voxel-cell units (default: feet centre,
                        [sx/2, sy/2, 0])
  --name <name>         model name (default: the input file's basename)
  --out <model.js>      write the module snippet here instead of stdout
  --parts on|off        on (default): split into one part per named
                        MagicaVoxel layer (or, with no named layers, per
                        top-level group), each part's box = the tight
                        bounds of its own voxels, pivot = that box's
                        bottom centre, root = the first layer/group, every
                        other part parented to the root. off: always emit
                        ONE root part 'body' = the full box (the
                        OWN-REQ-005a core behaviour), ignoring any scene
                        graph in the file.

Output: a design/models/*.js-style snippet:
  ASSETS.voxelModels.<name> = { name, desc, voxel: { ...VoxelModelDef } }
This tool only reads <in.vox>/<map.json> and writes --out - it never edits
files under design/.

Rejects combined dimensions over 32 per axis or 4096 total voxels, more
than 8 parts, overlapping part boxes, or (single-part 'body' output only,
a corollary of the single-box design) a size whose axes sum to more than
48 - each part's own box is checked against that 48 limit instead when
parts-splitting is on. See the file's own header comment for exactly which
.vox scene-graph shapes are supported (rotated/animated nodes and
multi-model shapes are not).
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a === '--map') { args.map = argv[++i]; continue; }
    if (a === '--cell') { args.cell = argv[++i]; continue; }
    if (a === '--anchor') { args.anchor = argv[++i]; continue; }
    if (a === '--out') { args.out = argv[++i]; continue; }
    if (a === '--name') { args.name = argv[++i]; continue; }
    if (a === '--parts') { args.parts = argv[++i]; continue; }
    args._.push(a);
  }
  return args;
}

/** Runs the CLI end-to-end (throws on error; caller prints/exits). Split
 * out from `main()` so both real files and tests can drive it without
 * touching process.exit. */
export function runCli(argv) {
  const args = parseArgs(argv);
  if (args.help || args._.length === 0) {
    return { help: true, text: HELP };
  }
  const inPath = args._[0];
  if (!args.map) throw new Error("vox-import: --map <map.json> is required (see --help)");
  if (!args.cell) throw new Error("vox-import: --cell <metres> is required (see --help)");
  const cellM = Number(args.cell);
  if (!Number.isFinite(cellM)) throw new Error(`vox-import: --cell '${args.cell}' is not a number`);

  const buf = fs.readFileSync(inPath);
  const parsed = parseVox(buf);

  const mapRaw = fs.readFileSync(args.map, 'utf8');
  let map;
  try {
    map = JSON.parse(mapRaw);
  } catch (e) {
    throw new Error(`vox-import: --map '${args.map}' is not valid JSON (${e.message})`);
  }
  if (map === null || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(`vox-import: --map '${args.map}' must be a JSON object of { "paletteIndex": "materialKey" }`);
  }

  let anchor = null;
  if (args.anchor) {
    const parts = args.anchor.split(',').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(`vox-import: --anchor '${args.anchor}' must be 'x,y,z'`);
    }
    anchor = parts;
  }

  let useParts = true;
  if (args.parts !== undefined) {
    if (args.parts === 'on') useParts = true;
    else if (args.parts === 'off') useParts = false;
    else throw new Error(`vox-import: --parts '${args.parts}' must be 'on' or 'off'`);
  }

  const def = buildVoxelModel(parsed, map, cellM, anchor, { parts: useParts });

  const { errors } = validateVoxelModel(def);
  if (errors.length) {
    throw new Error(`vox-import: generated model failed validateVoxelModel:\n${errors.join('\n')}`);
  }

  const name = args.name || path.basename(inPath, path.extname(inPath));
  const text = formatModule(name, def);

  if (args.out) {
    fs.writeFileSync(args.out, text, 'utf8');
    return { help: false, wrote: args.out, text };
  }
  return { help: false, wrote: null, text };
}

function main() {
  try {
    const result = runCli(process.argv.slice(2));
    if (result.help) {
      console.log(result.text);
      return;
    }
    if (result.wrote) {
      console.log(`vox-import: wrote ${result.wrote}`);
    } else {
      console.log(result.text);
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();
