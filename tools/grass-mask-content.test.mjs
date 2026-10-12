// MASK-e1: the baked content/grassmask/overworld_far.grassMask.json round-trips, is canonical, loads through the
// content loader, and samples ~1 in a meadow, 0 on the road / in the tower, soft at an area edge.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { grassMaskFromJSON, grassMaskToJSON, grassMaskAt, stringifyContent } from '../engine/index.js';
import { bakeOverworldGrassMask, GRASS_MASK_PATH, GRASS_MASK_ID, FEATHER_M } from './bake-grass-mask.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const lf = (s) => s.replace(/\r\n/g, '\n');
const raw = fs.readFileSync(ROOT + 'content/' + GRASS_MASK_PATH, 'utf8');
const obj = JSON.parse(raw);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

ok(lf(raw) === lf(stringifyContent(obj)), 'file is canonical (stringifyContent byte for byte)');
ok(obj.kind === 'grassMask' && obj.id === GRASS_MASK_ID, 'envelope');
ok(JSON.parse(JSON.stringify(grassMaskToJSON(grassMaskFromJSON(obj), GRASS_MASK_ID))).chunks && lf(stringifyContent(grassMaskToJSON(grassMaskFromJSON(obj), GRASS_MASK_ID))) === lf(raw), 'fromJSON -> toJSON is byte-identical');
ok(lf(stringifyContent(bakeOverworldGrassMask())) === lf(raw), 'file matches a fresh bake of the recipe areas (re-run tools/bake-grass-mask.mjs)');
ok(JSON.parse(fs.readFileSync(ROOT + 'content/manifest.json', 'utf8')).files.includes(GRASS_MASK_PATH), 'listed in manifest.files');

const L = grassMaskFromJSON(obj);
ok(grassMaskAt(L, 1440, 1004) > 0.99, 'large north meadow centre ~1');
ok(grassMaskAt(L, 1350, 1050) === 0, 'road = 0');
ok(grassMaskAt(L, 1496, 1024) === 0, 'tower = 0');
// soft value at the disc edge (1360,1086 r8; OB-101: 1440,1004 is inside the huge tower field): d = 0.75 m outside -> halfway down the 1.5 m feather
const edge = grassMaskAt(L, 1360 + 8 + FEATHER_M / 2, 1086);
ok(edge > 0.2 && edge < 0.8, `soft edge value ${edge.toFixed(2)}`);
ok(grassMaskAt(L, 1360 + 8 + FEATHER_M + 1, 1086) < 0.02, 'zero beyond the feather');

// the content loader accepts the kind (manifest reduced to this one file) and exposes the raw object
const { loadContentPack } = await import('../engine/index.js');
const man = JSON.parse(fs.readFileSync(ROOT + 'content/manifest.json', 'utf8'));
const url = 'file:///x/manifest.json';
const bundle = await loadContentPack(url, {
  fetchText: async (u) => (u === url ? JSON.stringify({ ...man, files: [GRASS_MASK_PATH], masks: [] }) : raw),
  fetchBytes: async () => new ArrayBuffer(0),
});
ok(!(bundle instanceof Error) && !bundle.errors, 'loader accepts kind grassMask: ' + (bundle.errors || []).map((e) => e.message));
ok(bundle.grassMasks[GRASS_MASK_ID] && bundle.grassMasks[GRASS_MASK_ID].chunks === undefined === false, 'bundle.grassMasks[id] has chunks');
console.log(`grass-mask-content.test: ${n} checks ok`);
