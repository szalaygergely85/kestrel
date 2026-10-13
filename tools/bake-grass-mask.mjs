#!/usr/bin/env node
// MASK-e1 (arch 38.52 OB-096 grass mask): bake ALL recipe.carpet variants' `areas` into one grass paint layer.
// Deterministic, Node only: node tools/bake-grass-mask.mjs  ->  content/grassmask/overworld_far.grassMask.json
// (+ lists it in content/manifest.json "files"). Re-run after editing the areas; the output is canonical content.
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createGrassMask, bakeAreasToMask, grassMaskToJSON, stringifyContent } from '../engine/index.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const GRASS_MASK_ID = 'overworld_far';
export const GRASS_MASK_PATH = 'grassmask/overworld_far.grassMask.json'; // relative to content/
export const FEATHER_M = 1.5;

export function bakeOverworldGrassMask() {
  const file = 'design/levels/overworld_far.js', context = { window: { ASSETS: {} }, Math };
  vm.runInNewContext(fs.readFileSync(ROOT + file, 'utf8'), context, { filename: file, timeout: 5000 });
  const carpet = context.window.ASSETS.levels.overworld_far.recipe.carpet;
  const layer = bakeAreasToMask(createGrassMask(0.5, 64), carpet.variants, FEATHER_M);
  return grassMaskToJSON(layer, GRASS_MASK_ID);
}

import path from 'node:path';
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const text = stringifyContent(bakeOverworldGrassMask());
  fs.mkdirSync(ROOT + 'content/grassmask', { recursive: true });
  fs.writeFileSync(ROOT + 'content/' + GRASS_MASK_PATH, text);
  const mp = ROOT + 'content/manifest.json', raw = fs.readFileSync(mp, 'utf8'), m = JSON.parse(raw);
  if (!m.files.includes(GRASS_MASK_PATH)) {
    // insert after the terrain edits entry, keeping the rest of the file byte-identical
    const anchor = '    "terrain/overworld_far.edits.json",\n';
    const nl = raw.includes('\r\n') ? '\r\n' : '\n';
    const a = anchor.replace(/\n/g, nl);
    if (!raw.includes(a)) throw new Error('manifest anchor not found');
    fs.writeFileSync(mp, raw.replace(a, a + `    "${GRASS_MASK_PATH}",` + nl));
  }
  console.log(`bake-grass-mask: ${text.length} bytes -> content/${GRASS_MASK_PATH}`);
}
