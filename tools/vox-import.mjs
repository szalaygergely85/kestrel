#!/usr/bin/env node
// OWN-REQ-005a (docs/backlog.md row 25r): MagicaVoxel `.vox` importer, core
// split. Converts a MagicaVoxel `.vox` file into this project's
// VoxelModelDef (engine/voxel/VoxelModel.js, architecture.md 15.1) and
// prints (or writes) a `design/models/*.js`-style module snippet.
//
// No parts-splitting in this core version (one root part `body` = the full
// box) - that is OWN-REQ-005b, out of scope here.
//
//   node tools/vox-import.mjs in.vox --map map.json --cell 0.05 [--anchor x,y,z] [--out model.js] [--name NAME]
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
import { validateVoxelModel } from '../engine/index.js';

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

/**
 * Parses a MagicaVoxel `.vox` buffer (RIFF `VOX ` v150/v200).
 * @returns {{ size: [number,number,number], voxels: Array<{x:number,y:number,z:number,c:number}>, palette: Array<[number,number,number,number]>|null }}
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

  let size = null;
  let voxels = null;
  let palette = null;

  let off = main.childrenStart;
  const end = main.childrenStart + main.childrenSize;
  while (off < end) {
    const c = readChunkHeader(buf, off);
    if (c.id === 'SIZE') {
      size = [buf.readUInt32LE(c.contentStart), buf.readUInt32LE(c.contentStart + 4), buf.readUInt32LE(c.contentStart + 8)];
    } else if (c.id === 'XYZI') {
      const n = buf.readUInt32LE(c.contentStart);
      voxels = [];
      for (let i = 0; i < n; i++) {
        const b = c.contentStart + 4 + i * 4;
        voxels.push({ x: buf[b], y: buf[b + 1], z: buf[b + 2], c: buf[b + 3] });
      }
    } else if (c.id === 'RGBA') {
      palette = [];
      for (let i = 0; i < 256; i++) {
        const b = c.contentStart + i * 4;
        palette.push([buf[b], buf[b + 1], buf[b + 2], buf[b + 3]]);
      }
    }
    // Any other chunk id (PACK, nTRN, nGRP, nSHP, MATL, LAYR, rOBJ, NOTE, ...)
    // is skipped safely: we just advance past its content+children bytes
    // without interpreting them.
    off = c.next;
  }

  if (!size) throw new Error("vox-import: no SIZE chunk found in the .vox file");
  if (!voxels) throw new Error("vox-import: no XYZI chunk found in the .vox file");
  return { size, voxels, palette };
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

/**
 * @param {{size:[number,number,number], voxels:Array<{x:number,y:number,z:number,c:number}>, palette:Array|null}} parsed
 * @param {Object<string,string>} map   palette index (decimal string) -> material key
 * @param {number} cellM
 * @param {[number,number,number]} [anchor]
 * @returns {Object} VoxelModelDef
 */
export function buildVoxelModel(parsed, map, cellM, anchor) {
  const [sx, sy, sz] = parsed.size;

  if (sx > 32 || sy > 32 || sz > 32) {
    throw new Error(`vox-import: dimension too large - size [${sx}, ${sy}, ${sz}] exceeds 32 on at least one axis`);
  }
  const total = sx * sy * sz;
  if (total > 4096) {
    throw new Error(`vox-import: size [${sx}, ${sy}, ${sz}] = ${total} voxels, exceeds the 4096 limit`);
  }
  // One root `body` part in this core version (OWN-REQ-005b splits parts
  // later): VoxelModel.js rule 5 caps a part's box extent (bx+by+bz) at 48,
  // so a full-box single part additionally needs sx+sy+sz <= 48.
  if (sx + sy + sz > 48) {
    throw new Error(
      `vox-import: size [${sx}, ${sy}, ${sz}] sums to ${sx + sy + sz}, exceeds 48 - a single full-box 'body' part ` +
      `cannot cover it (VoxelModel.js part-box extent limit). Parts-splitting is OWN-REQ-005b, out of scope for this tool.`
    );
  }

  // Which palette indices are actually used, in ascending order (for a
  // deterministic, reproducible char assignment).
  const used = new Set();
  for (const v of parsed.voxels) {
    if (v.x >= sx || v.y >= sy || v.z >= sz) {
      throw new Error(`vox-import: voxel (${v.x},${v.y},${v.z}) is outside the declared size [${sx}, ${sy}, ${sz}]`);
    }
    used.add(v.c);
  }
  const usedSorted = [...used].sort((a, b) => a - b);

  const unmapped = usedSorted.filter((c) => !Object.prototype.hasOwnProperty.call(map, String(c)));
  if (unmapped.length) {
    const lines = unmapped.map((c) => {
      const rgba = paletteColor(parsed.palette, c);
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
  for (const v of parsed.voxels) {
    grid[v.z][v.y][v.x] = charOf.get(v.c);
  }
  const layers = grid.map((rows) => rows.map((row) => row.join('')));

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

/** Renders a `design/models/*.js`-style snippet (matches the literal style
 * of design/models/voxel_props.js: `ASSETS.voxelModels.<name> = { name, desc,
 * voxel: {...} }`). Caller drops this straight into a real model file. */
export function formatModule(name, def) {
  return `ASSETS.voxelModels.${name} = {
  name: ${jsStringLiteral(name)},
  desc: ${jsStringLiteral(`Imported from .vox by tools/vox-import.mjs (OWN-REQ-005a). No parts-splitting yet (OWN-REQ-005b).`)},
  voxel: {
    version: 1,
    cellM: ${def.cellM},
    size: ${formatArray(def.size)},
    anchor: ${formatArray(def.anchor)},
    mats: ${formatMats(def.mats)},
    layers: ${formatLayers(def.layers)},
    parts: {
      body: { box: ${formatArray(def.parts.body.box)}, pivot: ${formatArray(def.parts.body.pivot)} }
    }
  }
};
`;
}

// ---- CLI ------------------------------------------------------------------

const HELP = `vox-import - MagicaVoxel .vox -> project VoxelModelDef (OWN-REQ-005a)

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

Output: a design/models/*.js-style snippet:
  ASSETS.voxelModels.<name> = { name, desc, voxel: { ...VoxelModelDef } }
This tool only reads <in.vox>/<map.json> and writes --out - it never edits
files under design/.

This core version emits ONE root part 'body' = the full box (no parts
splitting - that is OWN-REQ-005b). Rejects dimensions over 32 per axis or
4096 total voxels, and (a corollary of the single-part-body design) any
size whose axes sum to more than 48.
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

  const def = buildVoxelModel(parsed, map, cellM, anchor);

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
