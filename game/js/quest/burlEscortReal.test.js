// BURL-ESCORT: drives the escort with Burl's REAL walks from content/worlds/world_m1.world.json, the player teleporting 4 m ahead every 1.2 s
// (exactly what tools/verify-quest-walk.mjs step 7 does): Burl must reach the stone (phase 2, burl.arrived) well inside 40 s; also with the
// player standing still 12+ m back (waits, never stalls past resume).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNpcWalk } from './npcWalk.js';
import { createBurlEscort } from './burlEscort.js';

const w = JSON.parse(readFileSync(new URL('../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const e = (w.entities || w).find((x) => x.id === 'bear');
assert.ok(e && e.components.walks && e.components.walks.follow, 'bear has walks.follow');
function mk() {
  const ent = { transform: { x: e.x, y: e.y, z: 0, yawDeg: e.yawDeg || 0 }, components: JSON.parse(JSON.stringify(e.components)) };
  const state = { 'burl.follow': true }, kin = [];
  const world = { state, terrain: { groundAt: () => 0 }, get: () => ({ data: ent }), setEntityCollider: (id, x, y, z) => { kin.push([x, y, z]); return true; } };
  const walk = createNpcWalk(world, 'bear', {});
  const esc = createBurlEscort({ world, walk, questFlag: (k) => { state[k] = true; }, id: 'bear', x: () => ent.transform.x, y: () => ent.transform.y });
  return { ent, state, esc };
}
{
  const c = mk(); let px = c.ent.transform.x - 4, py = c.ent.transform.y + 1, i = 0;
  for (; i < 60 * 60 && c.esc.phase < 2; i++) { if (i % 72 === 0) { px = c.ent.transform.x - 4; py = c.ent.transform.y + 1; } c.esc.step(1 / 60, px, py, false); }
  assert.equal(c.esc.phase, 2, 'Burl reached the stone, phase ' + c.esc.phase);
  assert.ok(i / 60 < 40, 'in ' + (i / 60).toFixed(1) + ' s'); assert.ok(c.state['burl.arrived']);
}
{ // player far at the stone end: Burl waits at the start (by design, 10 m); the player walking back to him un-sticks it
  const c = mk(); const poly = e.components.walks.follow, last = poly[poly.length - 1];
  for (let i = 0; i < 60 * 20; i++) c.esc.step(1 / 60, last[0], last[1], false);
  assert.equal(c.esc.phase, 1); assert.ok(c.ent.transform.x > last[0] + 20, 'still waiting at the start');
  for (let i = 0; i < 60 * 80 && c.esc.phase < 2; i++) c.esc.step(1 / 60, c.ent.transform.x - 3, c.ent.transform.y, false);
  assert.equal(c.esc.phase, 2);
}
console.log('burlEscortReal: 4 pass');
