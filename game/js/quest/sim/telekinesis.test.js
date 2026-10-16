// SPELL-R3: Telekinesis L1-2 push/pull (cone, LOS, nearest only, roller props, wall damage, tiers, 0 alloc). Run: node game/js/quest/sim/telekinesis.test.js
import assert from 'node:assert/strict';
import { createTelekinesisSim, HOLD_SEC, PULL_STOP } from './telekinesis.js';
import { createTargetables } from './targetables.js';
import { SPELL_DEFS } from '../spellDefs.js';

const deg = (d) => d * Math.PI / 180;
const tgt = (id, x, y) => ({ id, transform: { x, y, z: 0 }, components: { targetable: { radius: 0.3, height: 1.6 }, health: { hp: 4, max: 4 } } });
const roller = (x, y) => ({ id: 'tower.boulder', transform: { x, y, z: 0 }, components: { roller: {}, body: { vx: 0, vy: 0, vz: 0, grounded: true } } });
function rig(tier, { wx = null, ents = [], props = [], mp = 100, dmul } = {}) {
  const player = { id: 'player', transform: { x: 0, y: 0, z: 0 }, components: {} };
  const all = [player, ...ents];
  const world = { state: {}, forEachEntity: (fn) => all.forEach(fn), raySegmentRay(s, out) { if (wx === null) return false; const dx = s[3] - s[0]; if (Math.abs(dx) < 1e-9) return false; const t = (wx - s[0]) / dx; if (t <= 0 || t > 1) return false; out.t = t; return true; } };
  const hits = [], bus = { mute: false, on() { return () => {}; }, emit(n, p) { if (!bus.mute && n === 'combat:hit') hits.push({ ...p }); } };
  const m = { mp };
  const g = createTelekinesisSim(world, bus, createTargetables(world, bus), { spendMana: (n) => (m.mp < n ? false : (m.mp -= n, true)), tier: () => tier, forEachProp: (fn) => props.forEach(fn), damageMul: dmul === undefined ? undefined : () => dmul });
  const go = (holdSteps = 0) => { g.requestCast(); for (let i = 0; i < holdSteps; i++) g.step(player, 1, 0, true); g.step(player, 1, 0, false); }; // tap = 0 held steps
  return { g, hits, m, player, bus, go, pull: () => go(Math.round(HOLD_SEC * 60) + 1) };
}
const at = (r, a) => [Math.cos(deg(a)) * r, Math.sin(deg(a)) * r];
for (const t of [1, 2]) { // push: range edge, knock, stagger, dmg 0, mana, cd
  const row = SPELL_DEFS.telekinesis.tiers[t - 1];
  const R = rig(t, { ents: [tgt('in', row.range - 0.5, 0), tgt('far', row.range + 1, 0)] }); R.go();
  assert.deepEqual(R.hits.map((h) => h.target), ['in']); const h = R.hits[0];
  assert.equal(h.knock, row.knock); assert.equal(h.damage, 0); assert.equal(h.heavy, 1); assert.equal(h.stunSec, row.stagger); assert.ok(h.dirX > 0.99);
  assert.equal(R.m.mp, 100 - row.mana); assert.equal(R.g.cooldown, Math.round(row.cd * 60));
  assert.equal(R.g.requestCast(), 'busy'); R.go(); assert.equal(R.hits.length, 1, 'cooldown: second cast does nothing'); assert.equal(R.m.mp, 100 - row.mana);
}
{ // nearest valid target only
  const R = rig(1, { ents: [tgt('far', 6, 0), tgt('near', 3, 0.2)] }); R.go(); assert.deepEqual(R.hits.map((h) => h.target), ['near']);
  const P = rig(1, { ents: [tgt('beast', 6, 0)], props: [roller(3, 0)] }); P.go(); assert.equal(P.hits.length, 0, 'closer roller wins over a farther beast'); assert.equal(P.g.propHits, 1);
}
{ // 30 degrees each side: 29 in, 31 out; behind out
  const [ix, iy] = at(5, 29), [ox, oy] = at(5, 31), [bx, by] = at(5, 59), [cx, cy] = at(5, 61);
  const R = rig(1, { ents: [tgt('in29', ix, iy), tgt('out31', ox, oy), tgt('out59', bx, by), tgt('out61', cx, cy), tgt('behind', -3, 0)] }); R.go();
  assert.deepEqual(R.hits.map((h) => h.target), ['in29']);
  const S = rig(1, { ents: [tgt('out31', ox, oy)] }); S.go(); assert.equal(S.hits.length, 0);
}
{ const R = rig(2, { ents: [tgt('hid', 4, 0), tgt('vis', 1, 0)], wx: 2 }); R.go(); assert.deepEqual(R.hits.map((h) => h.target), ['vis'], 'wall at x=2 blocks the one behind it'); }
{ const R = rig(1, { mp: 3, ents: [tgt('a', 3, 0)] }); R.go(); assert.equal(R.g.cooldown, 0, 'no mana: nothing, no cd'); assert.equal(R.hits.length, 0); assert.equal(R.m.mp, 3); }
{ // pull: toward the player, stops 1.5 m short (slide v^2/(2*12) <= d - 1.5); a tap (< 0.4 s) stays a push
  const R = rig(2, { ents: [tgt('a', 8, 0)] }); R.pull(); const h = R.hits[0];
  assert.ok(h.dirX < -0.99, 'pulled toward the player'); assert.ok(h.knock >= 1 && h.knock <= 16); assert.ok(h.knock * h.knock / 24 <= 8 - PULL_STOP + 1e-9, 'slide ends >= 1.5 m short'); assert.equal(R.g.pulls, 1);
  const N = rig(2, { ents: [tgt('a', 1.5, 0)] }); N.pull(); assert.equal(N.hits.length, 0, 'already within reach: nothing to pull');
  const T = rig(2, { ents: [tgt('a', 8, 0)] }); T.go(Math.round(HOLD_SEC * 60) - 2); assert.ok(T.hits[0].dirX > 0.99, 'held < 0.4 s = push');
  const L1 = rig(1, { ents: [tgt('a', 7, 0)] }); L1.pull(); assert.ok(L1.hits[0].dirX < 0);
}
{ // roller props: impulse <= 8 m/s, only rollers in cone + LOS
  const crate = { id: 'crate', transform: { x: 2, y: 0, z: 0 }, components: { body: { vx: 0, vy: 0, vz: 0, grounded: true } } };
  const a = roller(3, 0), b = roller(-3, 0), c = roller(5, 5), d = roller(1, 0);
  const R = rig(2, { props: [a, b, c, d, crate], wx: 2 }); R.go();
  assert.equal(a.components.body.vx, 0, 'behind the wall'); assert.equal(b.components.body.vx, 0); assert.equal(c.components.body.vy, 0); assert.equal(crate.components.body.vx, 0, 'not a roller');
  assert.ok(d.components.body.vx > 0 && d.components.body.vx <= 8, 'prop pushed, capped 8 m/s'); assert.equal(R.g.propHits, 1);
  const q = roller(6, 0); const P = rig(1, { props: [q] }); P.pull(); assert.ok(q.components.body.vx < 0 && q.components.body.vx >= -8, 'pulled boulder moves toward the player');
}
{ // Lv2 wall impact: 3 dmg once within 0.5 s; Lv1 never; pull never
  const wallAt = (lvl, pull) => { const R = rig(lvl, { ents: [tgt('a', 4, 0)], wx: 4.5, dmul: 1.1 }); pull ? R.pull() : R.go(); for (let i = 0; i < 40; i++) R.g.step(R.player, 1, 0, false); return R; };
  const R = wallAt(2, false); assert.equal(R.hits.length, 2); assert.equal(R.hits[1].damage, SPELL_DEFS.telekinesis.tiers[1].wallDmg * 1.1); assert.equal(R.g.wallHits, 1);
  assert.equal(wallAt(1, false).hits.length, 1, 'Lv1: no wall damage'); assert.equal(wallAt(2, true).hits.length, 1, 'pull: no wall damage');
  const far = rig(2, { ents: [tgt('a', 4, 0)] }); far.go(); for (let i = 0; i < 40; i++) far.g.step(far.player, 1, 0, false); assert.equal(far.hits.length, 1, 'no wall: no damage');
}
{ // determinism + 0 alloc
  const run = () => { const R = rig(2, { ents: [tgt('a', 4, 1), tgt('b', 5, -1)], props: [roller(3, 0)] }); R.go(); return JSON.stringify(R.hits); };
  assert.equal(run(), run());
  const R = rig(2, { ents: [tgt('a', 4, 1)], mp: 1e9, props: [roller(3, 0)] }); R.go(); R.bus.mute = true;
  const loop = (n) => { for (let i = 0; i < n; i++) { for (let k = 0; k < 100; k++) R.g.step(R.player, 1, 0, false); R.g.requestCast(); R.g.step(R.player, 1, 0, false); } };
  loop(500); if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed; loop(3000); if (global.gc) global.gc();
  const dh = process.memoryUsage().heapUsed - h0; assert.ok(dh < 100000, '0 alloc ' + dh);
}
console.log('telekinesis.test.js OK');
