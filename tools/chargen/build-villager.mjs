#!/usr/bin/env node
// CHARGEN-15: builds content/packages/villager_01.kestrel (models-only add-on, 38.33) from a fixed chargen seed, and index.json.
//   node tools/chargen/build-villager.mjs [--seed 7]
import fs from 'node:fs';
import path from 'node:path';
import { writeZip } from '../../engine/index.js';
import { createChargen } from './core.js';
import { fileURLToPath } from 'node:url';
import { parseBuildArgs } from './buildArgs.mjs';
import { loadKit, paletteRgbOf } from './export.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const args = parseBuildArgs(process.argv);
const seed = args.seed;
const kit = loadKit();
const cg = createChargen({ kit, rgbOf: paletteRgbOf(), materials: globalThis.ASSETS.palette.materials });
if (args.mode === 'recipe') cg.setRecipe(JSON.parse(fs.readFileSync(path.resolve(ROOT, args.recipe), 'utf8')));
else cg.random(seed);
const enc = new TextEncoder();
const json = (o) => enc.encode(JSON.stringify(o, null, 2) + '\n');
const recipeMode = args.mode === 'recipe';
const glbName = recipeMode ? args.assetId + '.glb' : 'villager_01.glb';
const assetId = recipeMode ? args.assetId : 'villager_01';
const manifest = {
  format: 'kestrel-package', formatVersion: 1,
  id: recipeMode ? args.id : 'villager.v01', name: recipeMode ? args.name : 'Villager 01', version: '1.0.0',
  license: { spdx: 'LicenseRef-AllRightsReserved', attribution: recipeMode ? 'Kestrel chargen (recipe ' + path.basename(args.recipe) + ')' : 'Kestrel chargen (seed ' + seed + ')' },
  authors: ['Kestrel'],
  assets: [{ path: glbName, type: 'model.rigged', id: assetId }, { path: 'recipe.json', type: 'chargen.recipe' }],
};
const bytes = await writeZip([
  { path: 'kestrel.json', bytes: json(manifest) },
  { path: 'recipe.json', bytes: json(cg.recipe) },
  { path: glbName, bytes: cg.exportGlb() },
]);
const dir = path.join(ROOT, 'content', 'packages');
fs.mkdirSync(dir, { recursive: true });
if (recipeMode) {
  // add-on: write the named package and add it to index.json (keeps existing entries)
  const out = path.resolve(ROOT, args.out);
  fs.writeFileSync(out, bytes);
  const ip = path.join(dir, 'index.json');
  const idx = JSON.parse(fs.readFileSync(ip, 'utf8'));
  const rel = path.relative(dir, out).split(path.sep).join('/');
  if (!idx.packages.includes(rel)) idx.packages.push(rel);
  fs.writeFileSync(ip, JSON.stringify(idx, null, 2) + '\n');
  console.log(`wrote ${rel} (${bytes.length} bytes), index.json has ${idx.packages.length} package(s)`);
} else {
  fs.writeFileSync(path.join(dir, 'villager_01.kestrel'), bytes);
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ format: 'kestrel-addons', formatVersion: 1, packages: ['villager_01.kestrel'] }, null, 2) + '\n');
  console.log(`wrote content/packages/villager_01.kestrel (${bytes.length} bytes) + index.json`);
}
