// BUG-FIRE-001: real burner size and authored collision footprint.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { World, PHYSICS_DEFAULTS, integrate } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';

let checks = 0;
function ok(condition, message) { checks++; assert.ok(condition, message); }
const root = new URL('../', import.meta.url);
const html = await readFile(new URL('game/index.html', root), 'utf8');
globalThis.window = globalThis;
for (const match of html.matchAll(/<script\b[^>]*\bsrc="(\.\.\/design\/[^"?]+)"/g)) {
  const url = new URL(match[1], new URL('game/index.html', root));
  if (match[1].startsWith('../design/local/')) {
    try { await access(url); } catch { continue; }
  }
  await import(url.href);
}
const { assets } = await loadTestAssets();
const def = assets.level('tower'), fire = def.props.find((p) => p.id === 'burnerFire');
const burner = def.props.find((p) => p.id === 'brazier');
ok(fire.x === burner.x && fire.y === burner.y, 'fire is centered on the burner');
ok(def.rows[Math.floor(fire.y)][Math.floor(fire.x)] === '*', 'fire is over the authored brazier collision footprint');
ok(def.legend['*'].floorH === burner.z && burner.collide === 'sector', 'raised ring supports the burner feet');
const model = assets.model(fire.model);
ok(model.world.w === 0.5 && model.world.h === 0.75, 'owner-requested fire size resolves from actual assets');
ok(globalThis.ASSETS.particles.presets.embers.sizeM === 0.06, 'owner-requested ember size');
for (const physics of ['grid', 'mesh']) {
  const world = World.load(assets.world('world_m1'), assets, { physics });
  const t = world.get('tower.burnerFire').data.transform;
  const P = PHYSICS_DEFAULTS;
  const player = { transform: { x: t.x, y: t.y + 1.5, z: 0, yawDeg: 0, pitchDeg: 0 },
    components: { body: { radius: P.radius, height: P.height, eyeH: P.eyeHeight, vx: 0, vy: 0, vz: 0,
      grounded: true, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: 0 } } };
  for (let i = 0; i < 180; i++) integrate(player, P.fixedDt, { forward: 1, yawDeg: 0, pitchDeg: 0 }, world, P);
  const end = player.transform;
  ok(end.y > t.y + 0.5, `${physics}: grounded approach cannot enter the fire's ring (${end.y - t.y} m)`);
}
console.log(`fire content: ${checks} checks. ALL PASS`);
