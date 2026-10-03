// BUG-CLOTH-002: real tower draft, visibility sleep, capsule response and save/load.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { AssetRegistry, World, serialize, deserialize } from '../../../engine/index.js';
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
const world = World.load(assets.world('world_m1'), assets);
const sys = world.cloths, cloth = sys.cloths[0], anchor = Array.from(cloth.pos.slice(0, 3));
const wind = [0, 0, 0];
world.wind.sampleInto(...anchor, 0, wind);
assert.ok(Math.abs(wind[1]) > 0, 'the real stairwell has a local draft');
world.wind.sampleInto(1460, 1040, 0, 0, wind);
assert.ok(wind.every((v) => v === 0), 'outside the stairwell stays calm');
const push = [0, 0]; world.wind.pushAt(anchor[0], anchor[1], 0, push);
assert.ok(push.every((v) => v === 0), 'the cosmetic draft does not push the player');
let tick = 0;
function frame(body, field = world.wind) {
  if (body) sys.setBody(0, ...body); else sys.clearBodies();
  sys.tick(++tick, field, anchor[0] + 1, anchor[1] - 2, 2.5);
  sys.markDrawn(0); // Renderer runs after the fixed step, as in the real game loop.
}
const start = Array.from(cloth.pos);
for (let i = 0; i < 180; i++) frame(null);
let sway = 0;
for (let i = 0; i < cloth.pos.length; i++) sway = Math.max(sway, Math.abs(cloth.pos[i] - start[i]));
assert.ok(sway > 0.002, `visible real-content cloth sways under the draft (${sway})`);
assert.equal(sys.stats.awake, 1);
const calm = World.load({ ...assets.world('world_m1'), wind: null }, assets).wind;
for (let i = 0; i < 1200; i++) frame(null, calm);
assert.equal(sys.isAsleep(0), true, 'visible cloth rests without wind or body contact');
const before = Array.from(cloth.pos), bb = cloth.bbox;
const body = [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2 - 0.08, bb[2], 0.3, 1.7];
for (let i = 0; i < 30; i++) frame(body, calm);
assert.equal(sys.bodyCount, 1);
assert.equal(sys.isAsleep(0), false, 'body overlap wakes resting real-content cloth');
let displacement = 0;
for (let i = 0; i < cloth.pos.length; i++) displacement = Math.max(displacement, Math.abs(cloth.pos[i] - before[i]));
assert.ok(displacement > 0.05, `capsule pushes the cloth aside (${displacement})`);
const restored = deserialize(JSON.parse(JSON.stringify(serialize(world))), assets);
restored.wind.sampleInto(...anchor, 0, wind);
assert.ok(Math.abs(wind[1]) > 0, 'the authored draft survives save/load');
console.log(`cloth physics: sway ${sway.toFixed(4)} m, capsule displacement ${displacement.toFixed(4)} m. ALL PASS`);
