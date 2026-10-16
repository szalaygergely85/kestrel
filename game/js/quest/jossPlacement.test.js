// BEND-NPC-01: Joss stands on walkable ground (slope <= the engine's walkable limit), not inside a collider, not in water, faces the Bend Waystone.
// Run: node game/js/quest/jossPlacement.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildContext } from '../../../tools/content-lint.mjs';
import { PHYSICS_DEFAULTS } from '../../../engine/index.js';

const ctx = await buildContext();
const { entities, groundAt, entSupport } = ctx;
const joss = entities.find((e) => e.id === 'joss'), stone = entities.find((e) => e.id === 'relayBend');
assert.ok(joss && stone, 'joss + relayBend placed');
const { x, y } = joss, g0 = groundAt(x, y);

// slope: steepest rise over 0.5 m in 8 directions (angle) <= the physics walkable limit
let worst = 0;
for (let a = 0; a < 360; a += 45) { const r = a * Math.PI / 180; worst = Math.max(worst, Math.abs(Math.atan2(groundAt(x + Math.cos(r) * 0.5, y + Math.sin(r) * 0.5) - g0, 0.5)) * 180 / Math.PI); }
assert.ok(worst <= PHYSICS_DEFAULTS.maxSlopeDeg, 'slope ' + worst.toFixed(1) + ' deg vs limit ' + PHYSICS_DEFAULTS.maxSlopeDeg);

// not buried / floating, nothing built over her feet (content-lint R12 data)
const es = entSupport.find((e) => e.id === 'joss');
assert.ok(es && es.floorAbove === null && Math.abs(es.base - es.support) <= 0.3, 'support ' + JSON.stringify(es));
// no other solid entity within 0.9 m (stone collider r 0.9 sits 2.7 m away)
for (const e of entities) if (e.id !== 'joss' && e.components.collider && Math.hypot(e.x - x, e.y - y) < (e.components.collider.r || 0) + 0.5) assert.fail('inside collider of ' + e.id);
// dry land: the river corridor (riverX +- riverHalf) is far away
assert.ok(Math.abs(x - ctx.riverX(y)) > ctx.riverHalf + 20, 'far from the river');

// faces the waystone: entity forward = (sin yaw, -cos yaw) (Player.js convention), within 30 deg
const placed = JSON.parse(readFileSync(new URL('../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8')).entities.find((e) => e.id === 'joss');
const yaw = (placed.yawDeg || 0) * Math.PI / 180, dx = stone.x - x, dy = stone.y - y, d = Math.hypot(dx, dy);
const cos = (Math.sin(yaw) * dx + -Math.cos(yaw) * dy) / d;
assert.ok(cos >= Math.cos(30 * Math.PI / 180), 'faces the waystone (cos ' + cos.toFixed(2) + ')');
console.log('joss', x, y, 'ground', g0.toFixed(2), 'slope', worst.toFixed(1));
console.log('jossPlacement.test.js: ok');
