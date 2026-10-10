#!/usr/bin/env node
// CHARGEN-15: builds content/packages/villager_01.kestrel (models-only add-on, 38.33) from a fixed chargen seed, and index.json.
//   node tools/chargen/build-villager.mjs [--seed 7]
import fs from 'node:fs';
import path from 'node:path';
import { writeZip } from '../../engine/index.js';
import { createChargen } from './core.js';
import { fileURLToPath } from 'node:url';
import { loadKit, paletteRgbOf } from './export.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const seed = Number(process.argv[process.argv.indexOf('--seed') + 1]) || 7;
const kit = loadKit();
const cg = createChargen({ kit, rgbOf: paletteRgbOf(), materials: globalThis.ASSETS.palette.materials });
cg.random(seed);
const enc = new TextEncoder();
const json = (o) => enc.encode(JSON.stringify(o, null, 2) + '\n');
const manifest = {
  format: 'kestrel-package', formatVersion: 1,
  id: 'villager.v01', name: 'Villager 01', version: '1.0.0',
  license: { spdx: 'LicenseRef-AllRightsReserved', attribution: 'Kestrel chargen (seed ' + seed + ')' },
  authors: ['Kestrel'],
  assets: [{ path: 'villager_01.glb', type: 'model.rigged', id: 'villager_01' }, { path: 'recipe.json', type: 'chargen.recipe' }],
};
const bytes = await writeZip([
  { path: 'kestrel.json', bytes: json(manifest) },
  { path: 'recipe.json', bytes: json(cg.recipe) },
  { path: 'villager_01.glb', bytes: cg.exportGlb() },
]);
const dir = path.join(ROOT, 'content', 'packages');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'villager_01.kestrel'), bytes);
fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ format: 'kestrel-addons', formatVersion: 1, packages: ['villager_01.kestrel'] }, null, 2) + '\n');
console.log(`wrote content/packages/villager_01.kestrel (${bytes.length} bytes) + index.json`);
