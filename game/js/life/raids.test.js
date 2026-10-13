// game/js/life/raids.test.js (LIFE-08). Run: node game/js/life/raids.test.js  (node --expose-gc for the alloc check)
import { createRaids, raidRoll, nightOf, lastDayKey, defendedKey } from './raids.js';
import { makeOk } from '../../../engine/test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (msg) => failures.push(msg));

// Stub sim + event bus (the real beastSim goal/alt behaviour is tested in beastSim.test.js).
function stubSim(ids) {
  const dead = new Set(), goals = {};
  const sim = {
    goals, dead, altN: 0,
    slotOf: (id) => ids.indexOf(id),
    isDead: (s) => dead.has(s),
    setGoal: (s, x, y) => { goals[s] = [x, y]; },
    clearGoal: (s) => { delete goals[s]; },
    setAltTargets: (n) => { sim.altN = n; },
  };
  return sim;
}
function bus(keepLog = true) {
  const L = {}, log = [];
  return {
    log,
    on(n, f) { (L[n] = L[n] || []).push(f); return () => { L[n] = L[n].filter((x) => x !== f); }; },
    emit(n, p) { if (keepLog) log.push(n + (p && p.npc ? ':' + p.npc : '') + (p && p.id ? ':' + p.id : '')); const a = L[n]; if (a) for (let i = 0; i < a.length; i++) a[i](p); },
  };
}
const DEF = { id: 'farm', pack: ['w1', 'w2', 'w3'], target: 'gooseFarm', from: 21, to: 5, chancePerNight: 1, cooldownDays: 2, alt: ['ana', 'bo'] };
function make(over, stateInit, keepLog = true) {
  const sim = stubSim(['w1', 'w2', 'w3']), events = bus(keepLog), state = stateInit || {};
  const pos = { ana: { x: 860, y: 990 }, bo: { x: 862, y: 991 } };
  const raids = createRaids({
    defs: [{ ...DEF, ...over }], sim, events, state, anchors: { gooseFarm: [860, 990] },
    npcPos: (id, o) => { const p = pos[id]; if (!p) return false; o.x = p.x; o.y = p.y; return true; },
  });
  return { sim, events, state, raids, pos };
}

ok('roll is deterministic and in [0,1)', raidRoll(5, 0) === raidRoll(5, 0) && raidRoll(5, 0) >= 0 && raidRoll(5, 0) < 1);
{ let hit = 0; for (let d = 0; d < 2000; d++) if (raidRoll(d, 3) < 0.35) hit++; ok('roll rate ~ 0.35 over 2000 nights', hit > 600 && hit < 800, 'hit=' + hit); }
ok('nightOf: 22:00 day 4 = night 4, 02:00 day 5 = night 4, noon = -1', nightOf(4, 22, 21, 5) === 4 && nightOf(5, 2, 21, 5) === 4 && nightOf(4, 12, 21, 5) === -1);

{ // night roll -> pack travels (goals at the anchor), start event, lastDay saved
  const t = make({});
  t.raids.step(3, 12);
  ok('no raid by day', !t.raids.isActive(0) && Object.keys(t.sim.goals).length === 0);
  t.raids.step(3, 21.5);
  ok('raid starts at night: 3 goals at the gooseFarm anchor', t.raids.isActive(0) && Object.keys(t.sim.goals).length === 3 && t.sim.goals[0][0] === 860 && t.sim.goals[2][1] === 990);
  ok('start event + lastDay saved', t.events.log.includes('life:raid:start:farm') && t.state[lastDayKey('farm')] === 3);
  t.raids.step(3, 22);
  ok('alt targets pushed (2 villagers)', t.sim.altN === 2);
  t.events.emit('beast:altHit', { slot: 0, alt: 1, id: 'w1' });
  ok('beast:altHit -> life:npcHit {bo}', t.events.log.includes('life:npcHit:bo'));
  t.pos.ana = null; t.raids.step(3, 22.5); t.events.emit('beast:altHit', { slot: 0, alt: 0, id: 'w1' });
  ok('a missing villager is skipped (alt 0 now maps to bo)', t.sim.altN === 1 && t.events.log.filter((e) => e === 'life:npcHit:bo').length === 2 && !t.events.log.includes('life:npcHit:ana'));
  t.sim.dead.add(0); t.sim.dead.add(1); t.raids.step(3, 23);
  ok('2 of 3 dead: still active', t.raids.isActive(0));
  t.sim.dead.add(2); t.raids.step(3, 23.1);
  ok('pack killed -> defended flag + event, goals cleared', !t.raids.isActive(0) && t.state[defendedKey('farm')] === true && t.events.log.includes('life:raid:defended:farm') && Object.keys(t.sim.goals).length === 0 && t.sim.altN === 0);
  t.raids.step(3, 23.2);
  ok('same night: no second raid', !t.raids.isActive(0));
}
{ // timeout -> lost, goals cleared, no defended flag
  const t = make({});
  t.raids.step(7, 21.2);
  t.raids.step(8, 4.9);
  ok('still raiding at 04:54 next day', t.raids.isActive(0));
  t.raids.step(8, 5.0);
  ok('timeout at `to` -> lost, wolves released, not defended', !t.raids.isActive(0) && t.events.log.includes('life:raid:lost:farm') && !t.state[defendedKey('farm')] && Object.keys(t.sim.goals).length === 0);
  t.raids.step(8, 5.5); t.raids.step(8, 21.5);
  ok('cooldown: night 8 is within 2 days of night 7 -> no raid', !t.raids.isActive(0));
  t.raids.step(9, 21.5);
  ok('cooldown over on night 9 -> raids again', t.raids.isActive(0));
}
{ // chance gate, requires gate, save keys
  const t0 = make({ chancePerNight: 0 }); t0.raids.step(3, 22);
  ok('chancePerNight 0: never', !t0.raids.isActive(0));
  const t1 = make({ requires: 'quest.givenFarm' }); t1.raids.step(3, 22);
  ok('requires flag unset: no raid', !t1.raids.isActive(0));
  const t2 = make({ requires: 'quest.givenFarm' }, { 'quest.givenFarm': true }); t2.raids.step(3, 22);
  ok('requires flag set: raid', t2.raids.isActive(0));
  const t3 = make({}, { [lastDayKey('farm')]: 3 }); t3.raids.step(3, 22);
  ok('load mid-night (lastDay = tonight): not resumed', !t3.raids.isActive(0));
  const t4 = make({}, { [lastDayKey('farm')]: 3, [defendedKey('farm')]: true }); t4.raids.step(5, 22);
  ok('defended flag survives; next raid after the cooldown starts', t4.raids.isActive(0) && t4.state[defendedKey('farm')] === true);
  const seq = () => { const t = make({ chancePerNight: 0.35 }); const r = []; for (let d = 0; d < 40; d++) { t.raids.step(d, 22); r.push(t.raids.isActive(0) ? 1 : 0); t.raids.step(d + 1, 5.1); } return r.join(''); };
  const s1 = seq();
  ok('same nights -> same raids, a mix of raid / quiet nights', s1 === seq() && s1.includes('1') && s1.includes('0'), s1);
  const d = make({ pack: ['nobody'] }); d.raids.step(3, 22);
  ok('pack with no known beasts: no raid', !d.raids.isActive(0));
}

{ // GOB-06: goblin camp raid with torches
  const ids = ['g1', 'g2', 'g3', 'g4', 'g5'];
  const campDefs = [{ id: 'campNorth', members: ids.map((id) => ({ id })) }];
  const mk = (stateInit, keepLog = true) => {
    const sim = stubSim(ids); sim.entities = ids.map(() => ({ components: { voxel: { model: 'goblin' } } }));
    const events = bus(keepLog), state = stateInit || {};
    const raids = createRaids({ defs: [{ id: 'gob', campId: 'campNorth', torches: 5, target: 'gooseFarm', from: 22, to: 4, chancePerNight: 1, cooldownDays: 3 }],
      sim, events, state, anchors: { gooseFarm: [860, 990] }, npcPos: () => false, campDefs });
    return { sim, events, state, raids, models: () => sim.entities.map((e) => e.components.voxel.model).join(',') };
  };
  const t = mk();
  t.raids.step(3, 12);
  ok('goblin raid: none by day', !t.raids.isActive(0));
  t.raids.step(3, 22.5);
  ok('goblin raid starts from its camp at night (5 goals)', t.raids.isActive(0) && Object.keys(t.sim.goals).length === 5);
  ok('max 3 torch-bearers swap to goblinTorch (first 3)', t.models() === 'goblinTorch,goblinTorch,goblinTorch,goblin,goblin', t.models());
  t.sim.dead.add(1); t.raids.step(3, 23);
  ok('a dying torch-bearer reverts its model', t.models() === 'goblinTorch,goblin,goblinTorch,goblin,goblin' && t.raids.isActive(0), t.models());
  [0, 2, 3, 4].forEach((s) => t.sim.dead.add(s)); t.raids.step(3, 23.5);
  ok('all dead: defended event + models back', t.events.log.includes('life:raid:defended:gob') && t.models() === 'goblin,goblin,goblin,goblin,goblin' && t.state[defendedKey('gob')] === true);
  const l = mk(); l.raids.step(3, 22.5); l.raids.step(4, 4.5);
  ok('timeout at dawn: lost event + models back', l.events.log.includes('life:raid:lost:gob') && l.models() === 'goblin,goblin,goblin,goblin,goblin');
  const dn = mk({ 'life.camp.campNorth.down': true }); dn.raids.step(3, 22.5);
  ok('camp cleared (down): no goblin raid', !dn.raids.isActive(0));
  const w = mk(); w.raids.step(3, 22.5);
  ok('wolf-style one-raid-at-a-time unaffected: same def cannot restart tonight', (w.raids.step(3, 23), w.raids.isActive(0)));
}
if (global.gc) {
  const t = make({ chancePerNight: 0.5 }, null, false);
  for (let d = 0; d < 300; d++) { t.raids.step(d, 22); t.sim.dead.clear(); t.raids.step(d + 1, 5.1); }
  global.gc(); const b = process.memoryUsage().heapUsed;
  for (let d = 0; d < 20000; d++) { t.raids.step(d % 3000 + 400, 22); t.raids.step(d % 3000 + 401, 5.1); t.raids.step(d % 3000 + 401, 12); }
  global.gc(); const a = process.memoryUsage().heapUsed;
  ok('zero allocation per step', a <= b + 1e6, 'b=' + b + ' a=' + a);
} else console.log('(skip) alloc check needs --expose-gc');

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
