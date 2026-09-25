#!/usr/bin/env node
// OWN-REQ-010 (docs/backlog.md row 25zb, owner: "how can I create animations
// without knowing JS?"): converts a Blockbench project (`.bbmodel`, plain
// JSON) into this project's voxel `parts` (name, parent, pivot) + `clips`
// (VoxelClipDef, engine/voxel/VoxelModel.js, architecture.md 15.1) and
// merges them into an EXISTING VoxelModelDef by part name.
//
//   node tools/bb-import.mjs project.bbmodel --model model.json [--out merged.json] [--origin x,y,z]
//
// `model.json` is a plain VoxelModelDef (the `voxel: {...}` object of a
// `design/models/*.js`-style entry, or the object `tools/vox-import.mjs`
// builds) - its VOXELS (mats/layers/box) already come from MagicaVoxel via
// vox-import; Blockbench never supplies shape data, only the RIG (bone
// hierarchy + pivots) and ANIMATION (rotation/position keyframes). Every
// Blockbench bone must be named after an EXISTING part of `model.json` (see
// "Unknown bone names" below) - this tool never invents a new part, because
// it has no voxel geometry to give it.
//
// Output: the same VoxelModelDef, JSON-formatted (2-space indent), with:
//   - every named part's `pivot` (and, where the bone is nested under
//     another matched bone, `parent`) overwritten from the Blockbench rig
//   - `animations` gaining one VoxelClipDef per Blockbench animation
// The `box`/`mats`/`layers` (actual voxels) are never touched. Drop the
// result's `parts`/`animations` into the target `design/models/*.js` file's
// `voxel: {...}` block by hand (the geometry fields do not change).
//
// ---- axis / units mapping (Blockbench -> this engine) ---------------------
// Confirmed against engine/voxel/voxelPose.js's `computeVoxelPose` (which
// this file's own Node test drives end to end) and design/README.md section
// 7 ("x = east, y = south, z = up"). Blockbench follows the Minecraft
// convention: 1 "block" = 16 px, X = east, Y = up, Z = south. Physically
// that is the SAME three directions our engine uses (east / south / up) -
// only the axis LABELS differ (Blockbench calls "up" Y and "south" Z; we
// call "up" Z and "south" Y). Swapping two axis labels is an orientation-
// reversing (odd) permutation, so positions carry over unchanged but every
// ROTATION angle flips sign (a rotation matrix conjugated by an odd
// permutation is that rotation's matrix with the angle negated - verified
// by hand against `setRx`/`setRy`/`setRz` below and pinned by this file's
// own test). Units: 16 px = 1 block = 1 metre (Blockbench/Minecraft
// convention), and our voxel-grid units are metres/`cellM` each.
//
//   quantity          Blockbench (px, degrees)   this engine (voxel units, degrees)
//   -----------------------------------------------------------------------
//   position/pivot x  bbX                        ourX  = (bbX/16 + offsetX) / cellM
//   position/pivot y  bbY  (up)                  ourZ  = (bbY/16 + offsetY) / cellM
//   position/pivot z  bbZ  (south)                ourY  = (bbZ/16 + offsetZ) / cellM
//   rotation x        bbRotX (about east)         ourRotX = -bbRotX
//   rotation y        bbRotY (about up)           ourRotZ = -bbRotY
//   rotation z        bbRotZ (about south)         ourRotY = -bbRotZ
//
// `--origin x,y,z` (Blockbench pixels, default 0,0,0) is added to every
// bone origin/position BEFORE the /16/cellM conversion - use it to align
// Blockbench's own scene origin with this model's voxel-grid corner (e.g.
// so a bone's origin matches the same point as the part's existing pivot);
// vox-import's `--anchor` is the equivalent concept for the vox side.
//
// ---- KNOWN LIMITATIONS (deliberate; matches vox-import.mjs's own pattern
// of a clear thrown error over a silent guess) --------------------------
//   - a bone's own Blockbench "rest rotation" (the `rotation` field on an
//     outliner group, as opposed to its animated keyframes) must be zero -
//     composing a non-zero bind-pose rotation with animated keyframes is
//     genuinely ambiguous without knowing Blockbench's own composition
//     order, so this throws rather than guess.
//   - a keyframe's `interpolation` must be 'linear' (Blockbench's default)
//     or unset; bezier/catmullrom/step keyframes throw.
//   - a keyframe must carry exactly one numeric `data_points` entry -
//     Molang expressions (strings like "query.anim_time") are not
//     supported.
//   - a Blockbench animation's rotation values are assumed to compose as a
//     SINGLE rotation about ONE axis per keyframe at a time (the common
//     hinge/swivel rigging pattern this project's own voxel clips already
//     use - e.g. the lever's `pull`, the lantern's `unlit` glint). The
//     per-axis sign-flip above is proven exactly correct for that case (see
//     this file's test). A keyframe that rotates a bone about TWO OR THREE
//     axes AT ONCE is converted the same componentwise way, but the engine
//     composes a part's rot as `Rz(rz)*Ry(ry)*Rx(rx)` in that FIXED axis
//     order (VoxelModel.js), while Blockbench's own bone matrix may compose
//     axes in a different order once the Y/Z axes are swapped - the two can
//     disagree for a simultaneous multi-axis keyframe. This is a real
//     format gap (the clip format has no "axis order" field) that cannot be
//     fixed without an engine change - see the backlog row 25zb note
//     "NEEDS PC-A: architect: VoxelClipDef has no per-keyframe rotation
//     axis order, so a Blockbench keyframe combining 2-3 axes of rotation
//     at once cannot be guaranteed to convert exactly; single-axis-at-a-time
//     keyframes (the pattern already used everywhere in this project) are
//     exact." Everything else in this tool still ships.
//   - effect/event keyframes (Blockbench's "timeline" pseudo-bone) are
//     supported only in the cheapest possible form: a `data_points[0]`
//     with a plain identifier in `.script`/`.effect`/`.instructions`
//     becomes a frame event of that name; anything else is skipped with a
//     warning, never a crash.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateVoxelModel } from '../engine/index.js';

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,15}$/;

// ---- unit / axis conversion -------------------------------------------

/** Blockbench pixels -> this model's voxel-grid units, one axis. */
function pxToVoxel(px, cellM) {
  return px / 16 / cellM;
}

/** Bone origin (Blockbench px, axis order [x,y,z] with y=up, z=south) ->
 * a `pivot` in this model's voxel-grid units (see the header mapping
 * table). `offsetPx` (Blockbench px, same [x,y,z] order) is added first. */
export function convertPivot(originPx, cellM, offsetPx) {
  const off = offsetPx || [0, 0, 0];
  const x = pxToVoxel(originPx[0] + off[0], cellM);
  const yUp = pxToVoxel(originPx[1] + off[1], cellM);
  const zSouth = pxToVoxel(originPx[2] + off[2], cellM);
  return [x, zSouth, yUp]; // ourX=bbX, ourY=bbZ(south), ourZ=bbY(up)
}

/** A position/translation KEYFRAME value (Blockbench px, relative delta -
 * no `--origin` offset applies to a relative delta). Same axis remap as
 * `convertPivot`, no `--origin`. */
export function convertPos(posPx, cellM) {
  return [pxToVoxel(posPx[0], cellM), pxToVoxel(posPx[2], cellM), pxToVoxel(posPx[1], cellM)];
}

/** Wraps a degree value into (-180, 180]. */
function wrapDeg(d) {
  let n = ((d + 180) % 360 + 360) % 360 - 180;
  if (n <= -180) n += 360;
  return n;
}

/** A rotation KEYFRAME value (Blockbench degrees, [rx,ry,rz]) -> this
 * engine's [rx,ry,rz] (see the header mapping table - every component
 * negates because the Y/Z axis swap is orientation-reversing). */
export function convertRot(rotDeg) {
  return [wrapDeg(-rotDeg[0]), wrapDeg(-rotDeg[2]), wrapDeg(-rotDeg[1])];
}

// ---- .bbmodel outliner walk (bones) ------------------------------------

/**
 * Walks `bbmodel.outliner` and returns one entry per GROUP node (a
 * Blockbench "bone"): `{ name, origin, rotation, parent }`. Plain strings
 * in the tree are element (cube) uuids - Blockbench voxel/mesh data, not
 * ours to import (voxels come from vox-import) - and are skipped.
 */
export function collectBones(outliner) {
  const bones = [];
  function visit(nodes, parentName) {
    for (const node of nodes || []) {
      if (typeof node === 'string' || !node || typeof node !== 'object') continue; // element uuid leaf
      bones.push({
        name: node.name,
        origin: Array.isArray(node.origin) ? node.origin : [0, 0, 0],
        rotation: Array.isArray(node.rotation) ? node.rotation : [0, 0, 0],
        parent: parentName,
      });
      if (Array.isArray(node.children)) visit(node.children, node.name);
    }
  }
  visit(outliner, undefined);
  return bones;
}

// ---- animation -> VoxelClipDef ------------------------------------------

/** Linear-samples a sorted `[{t, v:[x,y,z]}]` keyframe list at time `t`
 * (ms); constant-extrapolates before the first / after the last keyframe
 * (Blockbench's own behaviour); `[0,0,0]` if there are no keyframes at all. */
function sampleChannel(keys, t) {
  if (!keys.length) return [0, 0, 0];
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const alpha = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return [0, 1, 2].map((k) => a.v[k] + (b.v[k] - a.v[k]) * alpha);
    }
  }
  return last.v; // unreachable given the checks above; keeps the function total
}

function readNumericDataPoint(kf, animName, boneName) {
  if (kf.interpolation && kf.interpolation !== 'linear') {
    throw new Error(`bb-import: animation '${animName}' bone '${boneName}' keyframe at ${kf.time}s uses interpolation '${kf.interpolation}' - only 'linear' (Blockbench's default) is supported`);
  }
  if (!Array.isArray(kf.data_points) || kf.data_points.length !== 1) {
    throw new Error(`bb-import: animation '${animName}' bone '${boneName}' keyframe at ${kf.time}s must have exactly 1 data point (bezier/multi-point keyframes are not supported)`);
  }
  const dp = kf.data_points[0];
  const v = [Number(dp.x), Number(dp.y), Number(dp.z)];
  if (v.some((n) => !Number.isFinite(n))) {
    throw new Error(`bb-import: animation '${animName}' bone '${boneName}' keyframe at ${kf.time}s has a non-numeric value (Molang expressions are not supported)`);
  }
  return v;
}

/** Best-effort (see header "KNOWN LIMITATIONS"): extracts a bare-identifier
 * event name from a Blockbench "timeline" effect keyframe, or null if the
 * keyframe does not look like a simple event tag (never throws - an
 * unrecognized effect keyframe is just not imported as an event). */
function effectTagFor(kf) {
  if (kf.channel !== 'timeline') return null;
  const dp = kf.data_points && kf.data_points[0];
  const raw = dp && (dp.script || dp.effect || dp.instructions);
  if (!raw) return null;
  const tag = String(raw).trim();
  return NAME_RE.test(tag) ? tag : null;
}

/**
 * Converts one Blockbench `animations[]` entry into a VoxelClipDef, sampled
 * at the union of every referenced bone/effect keyframe time (see the
 * header comment: re-sampling a piecewise-linear function at extra points
 * along one of its already-linear segments, then linearly interpolating
 * between the samples, reproduces the exact original function).
 * `targetParts` gates which animator entries are bones (vs. the "effects"
 * pseudo-animator) - callers already validated every bone name exists.
 */
export function buildClip(anim, targetPartNames, cellM) {
  const boneAnimators = [];
  const effectKeyframes = [];
  const animators = anim.animators || {};
  for (const key of Object.keys(animators)) {
    const a = animators[key];
    const boneName = a.name;
    const isEffects = !boneName || boneName === 'effects' || a.type === 'effect';
    if (isEffects) {
      for (const kf of a.keyframes || []) {
        const tag = effectTagFor(kf);
        if (tag) effectKeyframes.push({ tMs: Math.round(kf.time * 1000), tag });
        else if (kf.channel === 'timeline') console.error(`bb-import: warning - animation '${anim.name}' effect keyframe at ${kf.time}s is not a simple event name, skipped`);
      }
      continue;
    }
    if (targetPartNames.indexOf(boneName) < 0) continue; // aggregate error already thrown by the caller if this ever matters
    const rotKeys = [], posKeys = [];
    for (const kf of a.keyframes || []) {
      if (kf.channel !== 'rotation' && kf.channel !== 'position') continue;
      const v = readNumericDataPoint(kf, anim.name, boneName);
      const tMs = Math.round(kf.time * 1000);
      (kf.channel === 'rotation' ? rotKeys : posKeys).push({ t: tMs, v });
    }
    rotKeys.sort((x, y) => x.t - y.t);
    posKeys.sort((x, y) => x.t - y.t);
    if (rotKeys.length || posKeys.length) boneAnimators.push({ name: boneName, rotKeys, posKeys });
  }

  const timeSet = new Set([0]);
  for (const b of boneAnimators) {
    for (const k of b.rotKeys) timeSet.add(k.t);
    for (const k of b.posKeys) timeSet.add(k.t);
  }
  for (const e of effectKeyframes) timeSet.add(e.tMs);
  const times = [...timeSet].sort((x, y) => x - y);
  if (times.length > 64) throw new Error(`bb-import: animation '${anim.name}' needs ${times.length} sample frames, exceeds the 64-frame clip limit (VoxelModel.js)`);

  const frames = times.map(() => ({}));
  for (const b of boneAnimators) {
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      const rot = convertRot(sampleChannel(b.rotKeys, t));
      const pos = convertPos(sampleChannel(b.posKeys, t), cellM);
      const pf = {};
      if (rot.some((n) => n !== 0)) pf.rot = rot;
      if (pos.some((n) => n !== 0)) pf.pos = pos;
      if (Object.keys(pf).length) frames[i][b.name] = pf;
    }
  }

  const lengthMs = Math.round((anim.length || 0) * 1000);
  const durations = times.map((t, i) => {
    if (i < times.length - 1) return times[i + 1] - t;
    const d = lengthMs - t;
    return d > 0 ? d : 1; // held tail frame (one-shot) - any positive value works, see animation.js's `MAX_STEPS_PER_CALL` guard
  });

  const events = {};
  for (const e of effectKeyframes) {
    const idx = times.indexOf(e.tMs);
    if (idx < 0) continue; // defensive - e.tMs was added to timeSet above, always found
    (events[e.tag] || (events[e.tag] = [])).push(idx);
  }

  const clip = { durations, loop: anim.loop === 'loop', interp: 'linear', frames };
  if (Object.keys(events).length) clip.events = events;
  return clip;
}

// ---- merge ----------------------------------------------------------------

/**
 * Merges a parsed `.bbmodel` (rig + animations) into an existing
 * VoxelModelDef, matched by part name. Throws one aggregate, clear error
 * listing every Blockbench bone name that has no matching part (the AC's
 * "unknown bone names produce a clear error, not a silent skip or crash") -
 * checked BEFORE any part/clip is touched, so a bad file never produces a
 * half-merged result.
 */
export function mergeBBModel(bbmodel, targetDef, opts) {
  const offsetPx = (opts && opts.originOffsetPx) || [0, 0, 0];
  const cellM = targetDef.cellM;
  const targetPartNames = Object.keys(targetDef.parts || {});

  const bones = collectBones(bbmodel.outliner);
  const referenced = new Set(bones.map((b) => b.name));
  for (const anim of bbmodel.animations || []) {
    for (const key of Object.keys(anim.animators || {})) {
      const a = anim.animators[key];
      const isEffects = !a.name || a.name === 'effects' || a.type === 'effect';
      if (!isEffects) referenced.add(a.name);
    }
  }
  const unknown = [...referenced].filter((n) => targetPartNames.indexOf(n) < 0).sort();
  if (unknown.length) {
    throw new Error(
      `bb-import: ${unknown.length} Blockbench bone name(s) do not match any part of the target model:\n` +
      unknown.map((n) => `  '${n}'`).join('\n') + '\n' +
      `Known parts: ${targetPartNames.join(', ') || '(none)'}\n` +
      `Rename the bone(s) in Blockbench to match an existing voxel part (parts come from the .vox file's ` +
      `layers/groups via tools/vox-import.mjs), or add the missing part to the .vox model first - this tool ` +
      `never invents a part, because it has no voxel geometry to give it.`
    );
  }

  for (const bone of bones) {
    if (bone.rotation.some((v) => v !== 0)) {
      throw new Error(
        `bb-import: bone '${bone.name}' has a non-zero rest rotation [${bone.rotation.join(', ')}] in Blockbench - ` +
        `not supported (composing a bind-pose rotation with animated keyframes is ambiguous without knowing ` +
        `Blockbench's own composition order). Zero the bone's rotation in Blockbench (use keyframes for all ` +
        `motion) and re-export.`
      );
    }
  }

  const newParts = {};
  for (const name of targetPartNames) newParts[name] = { ...targetDef.parts[name] };

  for (const bone of bones) {
    const part = newParts[bone.name];
    part.pivot = convertPivot(bone.origin, cellM, offsetPx);
    if (bone.parent === undefined) {
      delete part.parent;
      continue;
    }
    if (targetPartNames.indexOf(bone.parent) < 0) {
      // A purely organizational Blockbench group with no matching part
      // (e.g. artist grouping) - not itself an error; this part's parent
      // (from the target model) is left as it was.
      continue;
    }
    const parentIdx = targetPartNames.indexOf(bone.parent);
    const ownIdx = targetPartNames.indexOf(bone.name);
    if (parentIdx >= ownIdx) {
      throw new Error(
        `bb-import: bone '${bone.name}' is parented to '${bone.parent}' in Blockbench, but '${bone.parent}' is ` +
        `not an EARLIER part in the target model (part order: ${targetPartNames.join(', ')} - VoxelModel.js ` +
        `requires a part's parent to already exist earlier). Reorder the parts in the target model (the ` +
        `vox-import output, or the .vox file's own layer/group order) so parents come first.`
      );
    }
    part.parent = bone.parent;
  }

  const newAnimations = { ...(targetDef.animations || {}) };
  for (const anim of bbmodel.animations || []) {
    newAnimations[anim.name] = buildClip(anim, targetPartNames, cellM);
  }

  return { ...targetDef, parts: newParts, animations: newAnimations };
}

// ---- CLI --------------------------------------------------------------

const HELP = `bb-import - Blockbench .bbmodel -> voxel parts + clips (OWN-REQ-010)

Usage:
  node tools/bb-import.mjs <in.bbmodel> --model <model.json> [options]

Required:
  <in.bbmodel>          a Blockbench project file (plain JSON)
  --model <model.json>  the EXISTING target VoxelModelDef (a plain JSON dump
                        of a design/models/*.js entry's \`voxel: {...}\`
                        block, or tools/vox-import.mjs's output) - its
                        voxels (mats/layers/parts[].box) come from
                        MagicaVoxel and are never changed by this tool.

Options:
  --origin x,y,z        Blockbench pixels added to every bone origin before
                        conversion (default 0,0,0) - aligns Blockbench's own
                        scene origin with this model's voxel-grid corner.
  --out <merged.json>   write the merged VoxelModelDef JSON here instead of
                        stdout.

Output: the target VoxelModelDef, JSON-formatted, with every rigged part's
\`pivot\`/\`parent\` updated from the Blockbench outliner and one VoxelClipDef
per Blockbench animation added to \`animations\`. Paste the \`parts\`/
\`animations\` fields into the target design/models/*.js file by hand.

Every Blockbench bone must be named after an existing part of --model, or
this tool exits with a clear error listing the unknown name(s) - it never
creates a new part. See this file's header comment for the full axis/units
mapping table and known limitations (bind-pose rest rotations, non-linear
interpolation, Molang expressions, multi-axis-at-once keyframes).
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a === '--model') { args.model = argv[++i]; continue; }
    if (a === '--origin') { args.origin = argv[++i]; continue; }
    if (a === '--out') { args.out = argv[++i]; continue; }
    args._.push(a);
  }
  return args;
}

function readJson(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(`bb-import: cannot read ${label} '${filePath}': ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`bb-import: ${label} '${filePath}' is not valid JSON (${e.message})`);
  }
}

/** Runs the CLI end-to-end (throws on error; caller prints/exits) - same
 * split as vox-import.mjs's `runCli`, so both real files and tests can
 * drive it without touching process.exit. */
export function runCli(argv) {
  const args = parseArgs(argv);
  if (args.help || args._.length === 0) return { help: true, text: HELP };
  const bbPath = args._[0];
  if (!args.model) throw new Error('bb-import: --model <model.json> is required (see --help)');

  const bbmodel = readJson(bbPath, '.bbmodel file');
  const targetDef = readJson(args.model, '--model file');

  let originOffsetPx = [0, 0, 0];
  if (args.origin) {
    const parts = args.origin.split(',').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(`bb-import: --origin '${args.origin}' must be 'x,y,z'`);
    }
    originOffsetPx = parts;
  }

  const merged = mergeBBModel(bbmodel, targetDef, { originOffsetPx });

  const { errors } = validateVoxelModel(merged);
  if (errors.length) {
    throw new Error(`bb-import: merged model failed validateVoxelModel:\n${errors.join('\n')}`);
  }

  const text = JSON.stringify(merged, null, 2) + '\n';
  if (args.out) {
    fs.writeFileSync(args.out, text, 'utf8');
    return { help: false, wrote: args.out, text };
  }
  return { help: false, wrote: null, text };
}

function main() {
  try {
    const result = runCli(process.argv.slice(2));
    if (result.help) { console.log(result.text); return; }
    if (result.wrote) console.log(`bb-import: wrote ${result.wrote}`);
    else console.log(result.text);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();
