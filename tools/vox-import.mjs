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
import { validateVoxelModel } from '../engine/index.js';
import { parseVox, buildVoxelModel } from './voxParse.mjs';

// OWN-REQ-011: the RIFF/.vox chunk parsing + VoxelModelDef-building logic
// (parseVox/buildVoxelModel and everything they call) has moved to the
// portable, browser-safe tools/voxParse.mjs so tools/editor/*'s "Import
// .vox" button can share the exact same implementation - see that file for
// the full parsing code and its own header comment. This file re-exports
// `parseVox` for its existing test suite (tools/vox-import.test.mjs) and
// keeps every CLI-only piece (module-snippet formatting, argument parsing,
// the `runCli`/`main` entry points) below unchanged.
export { parseVox, buildVoxelModel };

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
