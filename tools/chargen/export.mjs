#!/usr/bin/env node
// tools/chargen/export.mjs (CHARGEN-07): CLI + helpers. Builds a character from the real human kit and writes a .glb.
//   node tools/chargen/export.mjs --out docs/test-reports/chargen-sample.glb [--seed N] [--demo-clips]
// --demo-clips adds two synthetic clips (idle, wave) because the kit v0 ships `clips: {}`; they are for checking the
// animation export only. Node-only file (fs); the exporters in tools/export/ stay browser-safe.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import { composeCharacter, meshCharacter, randomRecipe, validateKit, validateRecipe, HUMANOID_PART_MAP } from '../../engine/index.js';
import { exportGlb } from '../export/gltfWrite.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KIT_PATH = path.join(ROOT, 'content', 'chargen', 'human.charkit.json');

export function loadKit() {
  const kit = JSON.parse(fs.readFileSync(KIT_PATH, 'utf8'));
  // TEMP shim until the designer re-emits the kit with the array partMap (batch 9, CHARGEN-01): remove then.
  if (!Array.isArray(kit.partMap)) kit.partMap = HUMANOID_PART_MAP;
  return kit;
}

/** matKey -> [r,g,b] from the master palette (material base colour). */
export function paletteRgbOf() {
  const P = globalThis.ASSETS.palette;
  return (key) => {
    const m = P.materials[key];
    if (!m || !P.rgb[m.base]) throw new Error(`palette: no colour for material "${key}"`);
    return P.rgb[m.base];
  };
}

/** Two small synthetic clips (degrees, Rz*Ry*Rx) so the sample shows the animation path. */
export const DEMO_CLIPS = {
  idle: { duration: 2000, loop: true, keys: [
    { t: 0, pos: { Hips: [0, 0, 0] } },
    { t: 1000, rot: { Spine: [2, 0, 0], Head: [-2, 0, 3] }, pos: { Hips: [0, 0, -0.5] } },
  ] },
  wave: { duration: 1200, loop: true, keys: [
    { t: 0, rot: { RightUpperArm: [0, 0, 0] } },
    { t: 300, rot: { RightUpperArm: [0, -100, 0], RightLowerArm: [0, -40, 0] } },
    { t: 600, rot: { RightUpperArm: [0, -100, 0], RightLowerArm: [0, -80, 0] } },
    { t: 900, rot: { RightUpperArm: [0, -100, 0], RightLowerArm: [0, -40, 0] } },
  ] },
};

/** recipe -> {rigged, glb}. */
export function buildGlb(kit, recipe, { clips = null, colorMode } = {}) {
  const k = clips ? { ...kit, clips } : kit;
  const grid = composeCharacter(k, recipe);
  const rigged = meshCharacter(grid);
  return { rigged, glb: exportGlb(rigged, { rgbOf: paletteRgbOf(), recipe, partMap: kit.partMap, colorMode }) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const arg = (n) => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1]; };
  const out = arg('--out');
  if (!out) { console.error('usage: node tools/chargen/export.mjs --out file.glb [--seed N] [--demo-clips]'); process.exit(2); }
  const kit = loadKit();
  const P = globalThis.ASSETS.palette;
  const kv = validateKit(kit, P.materials);
  if (kv.errors.length) { console.error('kit errors:\n' + kv.errors.join('\n')); process.exit(1); }
  const seed = arg('--seed');
  const recipe = seed == null ? kit.defaults : randomRecipe(kit, Number(seed));
  const re = validateRecipe(kit, recipe).errors;
  if (re.length) { console.error('recipe errors:\n' + re.join('\n')); process.exit(1); }
  const { glb } = buildGlb(kit, recipe, { clips: args.includes('--demo-clips') ? DEMO_CLIPS : null });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, glb);
  console.log(`wrote ${out} (${glb.length} bytes)`);
}
