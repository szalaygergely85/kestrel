// MAP-26 AC1: every ow### placement uses a mesh that exists in content/meshes (unknown id fails); the anchor contract ids exist; wolves 8-20 m from gooseFarm.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { staticReach } from './reach-check.mjs';

const w = JSON.parse(readFileSync(new URL('../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const ow = w.structures.filter((s) => /^ow\d+$/.test(s.id));
assert.ok(ow.length >= 150, 'outwall blockout present: ' + ow.length);
const ids = [...new Set(ow.map((s) => s.mesh))];
for (const m of ids) assert.ok(existsSync(new URL(`../content/meshes/${m.replace(/^\/+/, '')}.mesh.json`, import.meta.url)), 'unknown mesh ' + m);
const ent = Object.fromEntries(w.entities.map((e) => [e.id, e]));
for (const id of ['relayOutwall', 'owGate', 'owBoard', 'owForge', 'owPathPost', 'gooseFarm', 'barleyGate', 'pierStone', 'signArm', 'wolf1', 'wolf2', 'wolf3', 'wolf4', 'wolf5']) assert.ok(ent[id], 'anchor ' + id);
assert.equal(ent.relayOutwall.components.waystone.id, 'ws_outwall');
assert.deepEqual([ent.relayOutwall.x, ent.relayOutwall.y], [912, 952]);
for (let i = 1; i <= 5; i++) { const d = Math.hypot(ent['wolf' + i].x - ent.gooseFarm.x, ent['wolf' + i].y - ent.gooseFarm.y); assert.ok(d >= 8 && d <= 20, `wolf${i} ${d.toFixed(1)} m from gooseFarm`); }
assert.equal(ent.signArm.components.questPickup.item, 'signArm');
assert.equal(ent.pierStone.components.inspect.text, 'note.pierStone');
assert.ok(!w.entities.some((e) => /npc/i.test(e.type) && /^ow/.test(e.id)), 'no NPCs');
assert.ok(w.bounds.parts.length <= 16);
const over = staticReach(w).bad.filter((p) => ['owGate', 'gooseFarm', 'barleyGate', 'owPathPost', 'signArm'].includes(p.id));
assert.deepEqual(over, [], 'anchors inside the walk bounds');
console.log('gen-outwall.test: OK', ow.length, 'meshes,', ids.length, 'distinct');
