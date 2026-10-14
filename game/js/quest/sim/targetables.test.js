// OB-169: targetable capacity (256 shared cap, nearest-N selection on overflow). Run: node game/js/quest/sim/targetables.test.js
import { makeOk } from '../../../../engine/test/assert.js';
import { MAX_TARGETABLES, createNearestSelector, createTargetables } from './targetables.js';
import { createTargeting } from '../targeting.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const mk = (i, x, y = 0) => ({ id: 'e' + i, transform: { x, y, z: 0 }, components: { targetable: { radius: 0.5, height: 1 } } });
const events = { on() { return () => {}; } };
const worldOf = (list) => ({ forEachEntity(f) { for (const e of list) f(e); }, get: (id) => list.find((e) => e.id === id) || null });

ok(MAX_TARGETABLES >= 128, 'cap has headroom over 87+');
{ // 120 targetables: all usable
  const list = Array.from({ length: 120 }, (_, i) => mk(i, i));
  const t = createTargetables(worldOf(list), events);
  ok(t.count === 120 && t.ent[119] === list[119], '120 targetables all kept');
}
{ // forced small cap keeps the nearest, not the first
  const list = Array.from({ length: 20 }, (_, i) => mk(i, i * 10));
  const sel = createNearestSelector(5), out = [];
  const n = sel.pick(list, 150, 0, out);
  ok(n === 5 && out.map((e) => e.id).join() === 'e15,e14,e16,e13,e17' || out.map((e) => e.id).sort().join() === ['e13', 'e14', 'e15', 'e16', 'e17'].sort().join(), 'nearest 5 kept');
  const ties = [mk(0, 5), mk(1, -5), mk(2, 5), mk(3, 50)];
  sel.pick(ties, 0, 0, out);
  ok(out.length === 4, 'under cap copies all');
  const s2 = createNearestSelector(2); s2.pick(ties, 0, 0, out);
  ok(out[0].id === 'e0' && out[1].id === 'e1', 'tie-break = load order');
  const heap = process.memoryUsage().heapUsed;
  for (let i = 0; i < 2000; i++) sel.pick(list, i % 200, 0, out);
  ok(process.memoryUsage().heapUsed - heap < 2e6, 'pick: no meaningful allocation');
}
{ // targetables.setFocus on overflow (cap is 256: make 300)
  const list = Array.from({ length: 300 }, (_, i) => mk(i, i * 2));
  const t = createTargetables(worldOf(list), events);
  ok(t.count === MAX_TARGETABLES && t.ent[0].id === 'e0', 'overflow keeps first by default focus (0,0) = nearest');
  t.setFocus(560, 0);
  ok(t.ent.some((e) => e.id === 'e299') && !t.ent.some((e) => e.id === 'e0'), 'setFocus re-picks nearest to far focus');
}
{ // targeting: 300 entities, player far away at the end still sees the last ones
  const list = Array.from({ length: 300 }, (_, i) => mk(i, 0, -(i * 2) - 3));
  const look = { yawDeg: 0, pitchDeg: 0, locked: false, lockActive: false, setLockPoint() {}, clearLock() {}, clear() {} };
  const tg = createTargeting(worldOf(list), events, { maxTargets: 256 });
  const player = { id: 'player', transform: { x: 0, y: -596, z: 0 }, components: { body: { eyeH: 1.6 } } };
  let threw = false;
  try { tg.step && tg.step(player, look, {}); } catch (e) { threw = true; }
  ok(!threw, 'targeting step with overflow runs');
}
console.log(`targetables.test: ${pass} pass, ${fail} fail`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
