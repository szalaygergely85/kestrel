// tools/voxParse.js - OWN-REQ-011 (docs/backlog.md): the MagicaVoxel `.vox`
// binary-format parsing + VoxelModelDef building logic, extracted from
// tools/vox-import.mjs (OWN-REQ-005a/005b) so it can be shared by BOTH the
// Node CLI (tools/vox-import.mjs) and the browser (tools/editor/*'s "Import
// .vox" button, main.js). Pure ArrayBuffer/DataView/Uint8Array only - no
// `fs`/Buffer-specific APIs - so this file runs unmodified in either
// environment (a Node `Buffer` IS a `Uint8Array` view, so callers that
// already have one, e.g. `fs.readFileSync`, can pass it straight through).
//
// This is a refactor, not a rewrite: every function's behaviour, error
// message and the exact chunk-layout/world-space-transform rules documented
// in tools/vox-import.mjs's own header comments are unchanged - see that
// file for the full format notes (RIFF chunk layout, scene-graph transform
// formula, KNOWN LIMITATIONS). tools/vox-import.mjs re-exports this module's
// `parseVox`/`buildVoxelModel` for its own CLI + existing test suite.
//
// `MAX_VOX_PARTS` / `validateVoxelModel` come from engine/index.js (the
// stable engine surface - both tools/** and tools/editor/** may import it
// per check-deps rule 3).
import { MAX_VOX_PARTS } from '../engine/index.js';

// ---- portable byte-buffer wrapper -----------------------------------------

/** Wraps a Uint8Array with the handful of little-endian reads/decodes this
 * parser needs, replacing Node `Buffer`'s `.readUInt32LE`/`.toString(...)`/
 * `buf[i]` calls with `DataView`/`TextDecoder`-based equivalents that work
 * the same way in Node and the browser. */
class VoxBuf {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get length() { return this.bytes.length; }
  byte(off) { return this.bytes[off]; }
  u32(off) { return this.view.getUint32(off, true); }
  i32(off) { return this.view.getInt32(off, true); }
  /** ASCII decode (chunk ids are always 4 ASCII bytes). */
  ascii(off, len) {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.bytes[off + i]);
    return s;
  }
  /** UTF-8 decode (scene-graph node/layer names, STRING values). */
  utf8(off, len) {
    return new TextDecoder('utf-8').decode(this.bytes.subarray(off, off + len));
  }
}

/** Accepts a Node `Buffer`, a `Uint8Array`, or a raw `ArrayBuffer` and
 * returns a `VoxBuf` over the same bytes (no copy for the typed-array cases). */
function toVoxBuf(input) {
  if (input instanceof VoxBuf) return input;
  if (input instanceof ArrayBuffer) return new VoxBuf(new Uint8Array(input));
  if (ArrayBuffer.isView(input)) return new VoxBuf(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
  throw new Error('voxParse: expected a Buffer, Uint8Array, or ArrayBuffer');
}

// ---- RIFF / .vox chunk parsing -----------------------------------------

/** Reads one chunk header at `off`. Returns byte ranges; does not care
 * whether the chunk id is recognized (unknown chunks are skipped by the
 * caller simply advancing to `.next`). */
function readChunkHeader(buf, off) {
  if (off + 12 > buf.length) throw new Error(`vox-import: truncated file (chunk header at byte ${off})`);
  const id = buf.ascii(off, 4);
  const contentSize = buf.u32(off + 4);
  const childrenSize = buf.u32(off + 8);
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
// fetched and quoted while writing tools/vox-import.mjs - not re-derived
// from memory). See tools/vox-import.mjs's header comment for the full
// STRING/DICT/ROTATION layout and the world-space transform formula.

function readString(buf, off) {
  const len = buf.u32(off);
  off += 4;
  const str = buf.utf8(off, len);
  return { str, next: off + len };
}

function readDict(buf, off) {
  const numPairs = buf.u32(off);
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
  const nodeId = buf.u32(off); off += 4;
  const attribs = readDict(buf, off); off = attribs.next;
  const childId = buf.u32(off); off += 4;
  off += 4; // reserved id, must be -1
  const layerId = buf.i32(off); off += 4;
  const numFrames = buf.u32(off); off += 4;
  const frames = [];
  for (let i = 0; i < numFrames; i++) {
    const f = readDict(buf, off); off = f.next;
    frames.push(f.dict);
  }
  return { type: 'nTRN', nodeId, attribs: attribs.dict, childId, layerId, frames };
}

function readNGRP(buf, c) {
  let off = c.contentStart;
  const nodeId = buf.u32(off); off += 4;
  const attribs = readDict(buf, off); off = attribs.next;
  const numChildren = buf.u32(off); off += 4;
  const children = [];
  for (let i = 0; i < numChildren; i++) {
    children.push(buf.u32(off));
    off += 4;
  }
  return { type: 'nGRP', nodeId, attribs: attribs.dict, children };
}

function readNSHP(buf, c) {
  let off = c.contentStart;
  const nodeId = buf.u32(off); off += 4;
  const attribs = readDict(buf, off); off = attribs.next;
  const numModels = buf.u32(off); off += 4;
  const models = [];
  for (let i = 0; i < numModels; i++) {
    const modelId = buf.u32(off); off += 4;
    const modelAttribs = readDict(buf, off); off = modelAttribs.next;
    models.push({ modelId, attribs: modelAttribs.dict });
  }
  return { type: 'nSHP', nodeId, attribs: attribs.dict, models };
}

function readLAYR(buf, c) {
  let off = c.contentStart;
  const layerId = buf.u32(off); off += 4;
  const attribs = readDict(buf, off); off = attribs.next;
  return { layerId, name: attribs.dict._name || null };
}

/**
 * Parses a MagicaVoxel `.vox` buffer (RIFF `VOX ` v150/v200).
 * @param {Buffer|Uint8Array|ArrayBuffer} input
 * @returns {{
 *   size: [number,number,number]|null, voxels: Array|null,
 *   palette: Array<[number,number,number,number]>|null,
 *   models: Array<{size:[number,number,number], voxels:Array}>,
 *   scene: {nodes: Map<number,Object>, layers: Map<number,{layerId:number,name:string|null}>}|null
 * }}
 */
export function parseVox(input) {
  const buf = toVoxBuf(input);
  if (buf.length < 8 || buf.ascii(0, 4) !== 'VOX ') {
    throw new Error("vox-import: not a MagicaVoxel .vox file (missing 'VOX ' magic)");
  }
  const version = buf.u32(4);
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
      pendingSize = [buf.u32(c.contentStart), buf.u32(c.contentStart + 4), buf.u32(c.contentStart + 8)];
    } else if (c.id === 'XYZI') {
      if (!pendingSize) throw new Error('vox-import: an XYZI chunk appears before any SIZE chunk');
      const n = buf.u32(c.contentStart);
      const voxels = [];
      for (let i = 0; i < n; i++) {
        const b = c.contentStart + 4 + i * 4;
        voxels.push({ x: buf.byte(b), y: buf.byte(b + 1), z: buf.byte(b + 2), c: buf.byte(b + 3) });
      }
      models.push({ size: pendingSize, voxels });
      pendingSize = null;
    } else if (c.id === 'RGBA') {
      palette = [];
      for (let i = 0; i < 256; i++) {
        const b = c.contentStart + i * 4;
        palette.push([buf.byte(b), buf.byte(b + 1), buf.byte(b + 2), buf.byte(b + 3)]);
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
export function paletteColor(palette, c) {
  if (!palette) return null;
  const entry = palette[c - 1];
  return entry || null;
}

/** The distinct palette indices actually used by a flat voxel list, in
 * ascending order, each with its RGBA color (or null if the file had no
 * RGBA chunk) - used by the editor's auto color-to-material mapping
 * (OWN-REQ-011, no manual map.json step) to know which colors to match. */
export function usedPaletteEntries(voxels, palette) {
  const used = new Set();
  for (const v of voxels) used.add(v.c);
  return [...used].sort((a, b) => a - b).map((index) => ({ index, rgba: paletteColor(palette, index) }));
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
  // (x,y,z) mapping, see tools/vox-import.mjs's header comment).
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
export function buildSinglePartModel(parsed, map, cellM, anchor) {
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

const IDENTITY_ROTATION_BYTE = 4; // row0=col0+, row1=col1+, row2=col2+ (see tools/vox-import.mjs's ROTATION note)

/** Depth-first-walks the scene graph from node id 0 (the MagicaVoxel scene
 * root convention), returns one entry per reachable leaf shape:
 *   { layerId, topBranchId, topBranchName, modelId, translation }
 * See tools/vox-import.mjs's header comment for the full grouping rules. */
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
 * (see tools/vox-import.mjs's KNOWN LIMITATIONS note). */
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
  // overlapping part boxes on its own - see tools/vox-import.mjs's header
  // note referencing this AC).
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
