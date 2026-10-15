// SPELL-07: Gust (cone, LOS, props, tiers, 0 alloc). Run: node game/js/quest/sim/gust.test.js
import assert from 'node:assert/strict';
import { createGustSim } from './gust.js';
import { createTargetables } from './targetables.js';
import { SPELL_DEFS } from '../spellDefs.js';

const deg = (d) => d * Math.PI / 180;
const tgt = (id, x, y) => ({ id, transform: { x, y, z: 0 }, components: { targetable: { radius: 0.3, height: 1.6 }, health: { hp: 4, max: 4 } } });
function rig(tier, { wx = null, ents = [], props = [], mp = 100 } = {}) {
  const player = { id: 'player', transform: { x: 0, y: 0, z: 0 }, components: {} };
  const all = [player, ...ents];
  const world = { state: {}, forEachEntity: (fn) => all.forEach(fn), raySegmentRay(s, out) { if (wx === null) return false; const dx = s[3] - s[0]; if (Math.abs(dx) < 1e-9) return false; const t = (wx - s[0]) / dx; if (t <= 0 || t > 1) return false; out.t = t; return true; } };
  const hits = [], bus = { mute: false, on() { return () => {}; }, emit(n, p) { if (!bus.mute && n === 'combat:hit') hits.push({ ...p }); } };
  const m = { mp };
  const g = createGustSim(world, bus, createTargetables(world, bus), { spendMana: (n) => (m.mp < n ? false : (m.mp -= n, true)), tier: () => tier, forEachProp: (fn) => props.forEach(fn) });
  return { g, hits, m, player, bus, go: () => { g.requestCast(); g.step(player, 1, 0); } };
}
const at = (r, a) => [Math.cos(deg(a)) * r, Math.sin(deg(a)) * r];
for (const t of [1, 2, 3]) { // tier numbers: range edge, knock, dmg, mana, cd
  const row = SPELL_DEFS.gust.tiers[t - 1];
  const ents = [tgt('in', row.range - 0.5, 0), tgt('far', row.range + 1, 0)];
  const R = rig(t, { ents }); R.go();
  assert.deepEqual(R.hits.map((h) => h.target), ['in']); assert.equal(R.hits[0].knock, row.knock); assert.equal(R.hits[0].damage, row.dmg); assert.equal(R.hits[0].heavy, 1); assert.equal(R.hits[0].stunSec, row.stagger); // SPELL-ARCH8
  assert.equal(R.m.mp, 100 - row.mana); assert.equal(R.g.cooldown, Math.round(row.cd * 60));
  R.go(); assert.equal(R.hits.length, 1, 'cooldown: second cast does nothing'); assert.equal(R.m.mp, 100 - row.mana);
}
{ // 60 degree cone = 30 degrees each side: 29 in, 31 out; 59 / 61 clearly out; behind out
  const [ix, iy] = at(5, 29), [ox, oy] = at(5, 31), [bx, by] = at(5, 59), [cx, cy] = at(5, 61);
  const R = rig(1, { ents: [tgt('in29', ix, iy), tgt('out31', ox, oy), tgt('out59', bx, by), tgt('out61', cx, cy), tgt('behind', -3, 0)] }); R.go();
  assert.deepEqual(R.hits.map((h) => h.target), ['in29']);
}
{ const R = rig(3, { ents: [tgt('hid', 4, 0), tgt('vis', 1, 0)], wx: 2 }); R.go(); assert.deepEqual(R.hits.map((h) => h.target), ['vis'], 'wall at x=2 blocks the one behind it'); }
{ const R = rig(1, { mp: 3 }); R.go(); assert.equal(R.g.cooldown, 0, 'no mana: nothing, no cd'); }
{ // props: impulse <= 8 m/s, only in cone + LOS
  const mkProp = (x, y) => ({ id: 'crate', transform: { x, y, z: 0 }, components: { body: { vx: 0, vy: 0, vz: 0, grounded: true } } });
  const a = mkProp(3, 0), b = mkProp(-3, 0), c = mkProp(5, 5), d = mkProp(1, 0);
  const R = rig(3, { props: [a, b, c, d], wx: 2 }); R.go();
  assert.equal(a.components.body.vx, 0, 'behind the wall'); assert.equal(b.components.body.vx, 0); assert.equal(c.components.body.vy, 0);
  assert.ok(d.components.body.vx > 0 && d.components.body.vx <= 8, 'prop pushed, capped 8 m/s'); assert.equal(R.g.propHits, 1);
}
{ // determinism + 0 alloc
  const run = () => { const R = rig(2, { ents: [tgt('a', 4, 1), tgt('b', 5, -1)] }); R.go(); return JSON.stringify(R.hits); };
  assert.equal(run(), run());
  const R = rig(2, { ents: [tgt('a', 4, 1)], mp: 1e9 }); R.go(); R.bus.mute = true;
  const loop = (n) => { for (let i = 0; i < n; i++) { for (let k = 0; k < 100; k++) R.g.step(R.player, 1, 0); R.g.requestCast(); R.g.step(R.player, 1, 0); } };
  loop(500); if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed; loop(3000); if (global.gc) global.gc();
  const dh = process.memoryUsage().heapUsed - h0; assert.ok(dh < 100000, '0 alloc ' + dh);
}
console.log('gust.test.js OK');
