// POI-02: poiWire. Run: node game/js/life/poiWire.test.js
// dormancy by distance, save round trip with a fake world, mixed respawn over 10 simulated days (fight 4 returns, guardian 0), chest defs.
import { makeOk } from '../../../engine/test/assert.js';
import { createPoiWire, ACTIVE_R, HYST, RESPAWN_DAYS, SAVE_KEY } from './poiWire.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const defs = [
  { id: 'poi.a.1', at: [100, 100], props: [{ model: 'brazier', anim: 'burn', at: [0, 0], light: 'torch' }, { smoke: 'farSmoke', at: [0, 0] }, { model: 'chestSmall', anim: 'closed', at: [2, 1], chest: true }], table: { fixed: [], weighted: [] }, fight: { species: 'boar', n: 4 } },
  { id: 'poi.b.1', at: [900, 900], props: [{ model: 'chestSmall', anim: 'closed', at: [0, 0], chest: true }], table: { fixed: [], weighted: [] }, fight: { species: 'wolf', n: 1, guardian: true }, guardian: true },
  { id: 'poi.c.1', at: [100, 300], props: [], table: null, fight: null },
];
const mkWorld = () => { const m = new Map(); return { m, addEntity: (e) => m.set(e.id, e), removeEntity: (id) => m.delete(id) }; };

let w = mkWorld(), state = {};
const pw = createPoiWire({ world: w, defs, state, terrain: { groundAt: () => 5 } });
ok('nothing live before the first step', pw.liveCount === 0 && w.m.size === 0);
pw.step(100, 150);
ok('near POIs spawn props (a: 3, c: 0), far one stays dormant', pw.isLive('poi.a.1') && pw.isLive('poi.c.1') && !pw.isLive('poi.b.1') && w.m.size === 3);
ok('prop z from the ground', w.m.get('poi.a.1.p0').transform.z === 5);
ok('chest closed', w.m.get('poi.a.1.p2').components.voxel.anim === 'closed');
pw.step(100 + ACTIVE_R + HYST - 1, 100);
ok('hysteresis: still live just inside ACTIVE_R + HYST', pw.isLive('poi.a.1'));
pw.step(100 + ACTIVE_R + HYST + 1, 100);
ok('beyond ACTIVE_R + HYST: props removed', !pw.isLive('poi.a.1') && !w.m.has('poi.a.1.p0'));
pw.step(900, 880);
ok('far POI wakes when the player arrives', pw.isLive('poi.b.1') && w.m.has('poi.b.1.p0'));

// save round trip
pw.markDone('poi.a.1'); pw.markGuardianDead('poi.b.1'); pw.markFightCleared('poi.a.1', 4);
const json = JSON.parse(JSON.stringify(state));
ok('saved under poi.v1 with {done, guardianDead, fightClearedAtDay}', json[SAVE_KEY]['poi.a.1'].done === true && json[SAVE_KEY]['poi.a.1'].fightClearedAtDay === 4 && json[SAVE_KEY]['poi.b.1'].guardianDead === true);
w = mkWorld();
const pw2 = createPoiWire({ world: w, defs, state: json });
pw2.step(100, 100);
ok('after load: opened chest shows open, done stays', pw2.isDone('poi.a.1') && w.m.get('poi.a.1.p2').components.voxel.anim === 'opened');
ok('after load: guardian stays dead', pw2.guardianDead('poi.b.1') && !pw2.fightActive('poi.b.1', 99));
ok('unknown ids are ignored (no junk in the save)', (pw2.markDone('nope'), !json[SAVE_KEY].nope));

// mixed respawn: the player clears both every time they are up (guardian dies for good on day 0)
const pw3 = createPoiWire({ world: mkWorld(), defs, state: {} });
let fightReturns = 0, guardReturns = 0, fightUp = true, guardUp = true;
for (let day = 0; day <= 12; day++) {
  const f = pw3.fightActive('poi.a.1', day), g = pw3.fightActive('poi.b.1', day);
  if (f && !fightUp) fightReturns++;
  if (g && !guardUp) guardReturns++;
  fightUp = f; guardUp = g;
  if (f) { pw3.markFightCleared('poi.a.1', day); fightUp = false; }
  if (g) { pw3.markFightCleared('poi.b.1', day); pw3.markGuardianDead('poi.b.1'); guardUp = false; }
}
ok(`12 days, ${RESPAWN_DAYS}-day respawn: fight returns 4 times (days 3, 6, 9, 12), guardian 0`, fightReturns === 4 && guardReturns === 0, `fight ${fightReturns} guardian ${guardReturns}`);
const p4 = createPoiWire({ world: mkWorld(), defs, state: {} }); p4.markFightCleared('poi.a.1', 1);
ok('cleared day 1: off on day 2 and 3, back on day 4, no fight for fight:null POI', !p4.fightActive('poi.a.1', 2) && !p4.fightActive('poi.a.1', 3) && p4.fightActive('poi.a.1', 4) && !p4.fightActive('poi.c.1', 4));

// chest defs
const cd = pw.chestDefs();
ok('chest defs: one per chest prop, with the table, prop id and no counters', cd.length === 2 && cd[0].propId === 'poi.a.1.p2' && cd[1].propId === 'poi.b.1.p0' && cd[0].interact.radius > 0);
ok('dispose removes live props', (pw.dispose(), pw.liveCount === 0));

console.log(`poiWire: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
