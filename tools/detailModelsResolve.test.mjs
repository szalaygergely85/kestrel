// OB-166: every ground-detail species model of the overworld recipe resolves in ASSETS.models (the voxel registry the game builds
// from design scripts). Meshes are checked against content/meshes. Run: node tools/detailModelsResolve.test.mjs
import assert from 'node:assert/strict';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/ground_detail.js';
import '../design/levels/overworld_far.js';

const A = globalThis.ASSETS;
// find every detail layer (an object with `ground` lists) anywhere under ASSETS and collect voxel model ids + mesh ids
const found = new Set(), meshes = new Set(), seen = new Set();
const walk = o => {
  if (!o || typeof o !== 'object' || seen.has(o)) return;
  seen.add(o);
  if (o.ground && typeof o.ground === 'object' && o.name && o.cellM) {
    for (const list of Object.values(o.ground)) for (const sp of list) { if (sp.model) found.add(sp.model); if (sp.mesh) meshes.add(sp.mesh); }
  }
  for (const k of Object.keys(o)) walk(o[k]);
};
walk(A.levels);
assert.ok(found.size >= 3 && meshes.size >= 5, `layer walk found ${found.size} models / ${meshes.size} meshes`);
const models = found;
const missing = [...models].filter(id => !A.models?.[id]);
assert.deepEqual(missing, [], 'detail models missing from ASSETS.models: ' + missing.join(', '));
console.log(`detailModelsResolve: ${models.size} detail model ids resolve in ASSETS.models PASS`);
