// POI-05: poiFights. Run: node game/js/life/poiFights.test.js
// 12 simulated days: small fight returns 4 times (days 3,6,9,12 after each clear), guardian 0; chest locked until cleared, opens after.
import { makeOk } from '../../../engine/test/assert.js';
import { createPoiWire } from './poiWire.js';
import { createPoiFights, fightSlots, TRIGGER_R, LEAVE_R } from './poiFights.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const chest = { model: 'chestSmall', anim: 'closed', at: [2, 1], chest: true };
const defs = [
  { id: 'poi.s', at: [100, 100], props: [chest], table: { fixed: [], weighted: [] }, fight: { species: 'boar', n: 4 }, guardian: false },
  { id: 'poi.g', at: [300, 100], props: [chest], table: { fixed: [], weighted: [] }, fight: { species: 'wolf', n: 2, guardian: true }, guardian: true },
];
const world = { addEntity() {}, removeEntity() {} };
const handlers = {}; const events = { on: (n, f) => { handlers[n] = f; return () => { delete handlers[n]; }; } };
let nextId = 0, chestIds = [];
const spawned = []; const spawner = { spawn: (d, k) => { const id = `e${nextId++}`; spawned.push([d.id, id]); return id; }, despawn() {} };
const state = {};
const pw = createPoiWire({ world, defs, state, onChange: (l) => { chestIds = l.map((c) => c.id); } });
const pf = createPoiFights({ wire: pw, spawner, events });

ok('fightSlots deterministic, n points', JSON.stringify(fightSlots(defs[0])) === JSON.stringify(fightSlots(defs[0])) && fightSlots(defs[0]).length === 4);
const killAll = (poi) => { for (const [p, id] of spawned.filter((s) => s[0] === poi)) handlers['beast:died']({ id }); spawned.length = spawned.filter((s) => s[0] !== poi).length ? spawned.length : 0; };
const countSpawn = (poi) => spawned.filter((s) => s[0] === poi).length;

// 12 days: the player stands at each POI every day (alternating), clears whatever is there
let smallStarts = 0, guardStarts = 0;
pw.step(100, 100); pw.step(300, 100); // both live (ACTIVE_R 200: step twice, then keep both live by standing between? use two steps)
ok('chest locked before the clear (no defs, no [E])', !pw.chestUnlocked('poi.s') && !chestIds.includes('poi.s.p0') && pw.chestDefs(true).length === 0);
for (let day = 0; day <= 12; day++) {
  for (const [poi, x] of [['poi.s', 100], ['poi.g', 300]]) {
    pw.step(x, 100); pf.step(x, 100, day);
    if (pf.isFighting(poi)) {
      if (poi === 'poi.s') smallStarts++; else guardStarts++;
      if (day === 0 && poi === 'poi.s') ok('4 members spawned for the small fight', countSpawn('poi.s') === 4);
      const before = spawned.length;
      for (const [p, id] of spawned.slice()) if (p === poi) handlers['beast:died']({ id });
      spawned.length = 0;
      ok(`${poi} day ${day}: cleared`, !pf.isFighting(poi) && before > 0);
      if (day === 0) ok(`${poi} chest opens after the clear`, pw.chestUnlocked(poi) && chestIds.includes(poi + '.p0'));
    }
  }
}
ok(`small fight starts: day 0 + 4 returns = 5 starts (3-day cadence over 12 days)`, smallStarts === 5, `starts ${smallStarts}`);
ok('guardian: 1 start, 0 returns', guardStarts === 1, `starts ${guardStarts}`);
ok('guardianDead saved in poi.v1', state['poi.v1']['poi.g'].guardianDead === true && state['poi.v1']['poi.s'].cleared === true);
// leaving despawns; dead ids ignored
const pf2 = createPoiFights({ wire: createPoiWire({ world, defs, state: {} }), spawner, events: null });
const w2 = pf2; w2.step(100, 100, 0); ok('no live POIs -> no spawn before the wire activates', !pf2.isFighting('poi.s'));
ok('trigger radius is 15 m, leave 60', TRIGGER_R === 15 && LEAVE_R === 60);

console.log(`poiFights: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
