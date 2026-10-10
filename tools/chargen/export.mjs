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
import { composeCharacter, meshCharacter } from '../../engine/index.js';
import { exportGlb } from '../export/gltfWrite.js';
import { createChargen } from './core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KIT_PATH = path.join(ROOT, 'content', 'chargen', 'human.charkit.json');

export function loadKit() {
  return JSON.parse(fs.readFileSync(KIT_PATH, 'utf8'));
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

const USAGE = `usage: node tools/chargen/export.mjs (--recipe <json> | --seed <n>) --format glb|fbx|obj|vox|zip --out <path> [--demo-clips] [--fbx <file>]
  --recipe <json>  CharRecipe file (default: the kit defaults)
  --seed <n>       random recipe from seed n
  --format         glb (default) | fbx (+ palette.png beside it) | obj (+ .mtl + palette.png beside it) | vox | zip (all available formats)
  --out <path>     output file
  --help           this text`;

/** argv -> {help, recipe, seed, format, out, demoClips, fbx}; throws on unknown flags / bad values. */
export function parseArgs(argv) {
  const o = { help: false, recipe: null, seed: null, format: 'glb', out: null, demoClips: false, fbx: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--recipe') o.recipe = val();
    else if (a === '--seed') { o.seed = Number(val()); if (!Number.isInteger(o.seed)) throw new Error('--seed must be an integer'); }
    else if (a === '--format') { o.format = val(); if (!['glb', 'fbx', 'obj', 'vox', 'zip'].includes(o.format)) throw new Error(`--format must be glb|fbx|obj|vox|zip, got ${o.format}`); }
    else if (a === '--out') o.out = val();
    else if (a === '--fbx') o.fbx = val();
    else if (a === '--demo-clips') o.demoClips = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (o.recipe && o.seed != null) throw new Error('--recipe and --seed are exclusive');
  return o;
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message + '\n' + USAGE); process.exit(2); }
  if (o.help) { console.log(USAGE); return; }
  if (!o.out) { console.error('--out is required\n' + USAGE); process.exit(2); }
  const kit0 = loadKit();
  const kit = o.demoClips ? { ...kit0, clips: DEMO_CLIPS } : kit0;
  try {
    const cg = createChargen({ kit, rgbOf: paletteRgbOf(), materials: globalThis.ASSETS.palette.materials });
    if (o.recipe) cg.setRecipe(JSON.parse(fs.readFileSync(o.recipe, 'utf8')));
    else if (o.seed != null) cg.random(o.seed);
    const out = path.resolve(o.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    let bytes;
    if (o.format === 'glb') bytes = cg.exportGlb();
    else if (o.format === 'zip') bytes = await cg.exportAllZip();
    else if (o.format === 'vox') bytes = cg.exportVox();
    else if (o.format === 'obj') {
      const r = cg.exportObj(), dir = path.dirname(out);
      bytes = Buffer.from(r.obj);
      fs.writeFileSync(path.join(dir, r.mtlName), r.mtl); fs.writeFileSync(path.join(dir, r.pngName), r.png);
    } else {
      const { fbx, png } = cg.exportFbx();
      bytes = fbx; fs.writeFileSync(path.join(path.dirname(out), 'palette.png'), png);
    }
    fs.writeFileSync(out, bytes);
    console.log(`wrote ${o.out} (${bytes.length} bytes)`);
    if (o.fbx) { // CHARGEN-10 flag kept: also a static .fbx + palette.png
      const { fbx, png } = cg.exportFbx();
      const dir = path.dirname(path.resolve(o.fbx));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(o.fbx, fbx); fs.writeFileSync(path.join(dir, 'palette.png'), png);
      console.log(`wrote ${o.fbx} (${fbx.length} bytes) + palette.png`);
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
