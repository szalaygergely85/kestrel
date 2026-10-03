// Game-bound voxel packs must fit the shared DDA atlas without changing its limit.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { AssetRegistry, VoxelPool } from '../../../engine/index.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';

const root = new URL('../../../', import.meta.url);
const html = await readFile(new URL('game/index.html', root), 'utf8');
globalThis.window = globalThis;
for (const match of html.matchAll(/<script\b[^>]*\bsrc="(\.\.\/design\/[^"?]+)"/g)) {
  const url = new URL(match[1], new URL('game/index.html', root));
  // The developer's optional local voxel pack is absent in a clean checkout.
  if (match[1].startsWith('../design/local/')) {
    try { await access(url); } catch { continue; }
  }
  await import(url.href);
}
const { assets } = await loadTestAssets();
assert.ok(assets instanceof AssetRegistry);
const pool = new VoxelPool();
pool.bind(assets, { idFor: () => 1 });
assert.ok(pool.models.size > 0, 'game packs must exercise atlas binding');
assert.ok(pool.atlas.h <= 256, 'all bound non-meshOnly packs must fit the 256-row atlas');
for (const [key, model] of pool.models) {
  assert.equal(pool._modelIndexByKey[key] !== undefined, !model.meshOnly,
    `${key}: only non-meshOnly models belong to the shared DDA atlas`);
}
console.log(`voxel packs: ${pool.models.size} bound models, ${pool.atlas.h}/256 atlas rows. ALL PASS`);
