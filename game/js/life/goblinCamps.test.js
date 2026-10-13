// GOB-04: goblin camps. Run: node game/js/life/goblinCamps.test.js   (--expose-gc adds the allocation check)
// Stubs the GOB-01 sim API (setDormant / flee / setDown); no beastSim needed.
import { readFileSync } from 'node:fs';
import '../../../design/levels/world_geo.js';
import { createBand } from '../quest/sim/band.js';
import { activeCamps, ensureGoblinCamps, createGoblinCamps, clearedKey, dayKey, downKey, WEST_X, DORMANT_R, WAKE_R, RESPAWN_FAR_R } from './goblinCamps.js';
import { makeOk } from '../../../engine/test/assert.js';
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const json = JSON.parse(readFileSync(new URL('../../../content/life/goblinCamps.json', import.meta.url), 'utf8'));
const world_m1 = JSON.parse(readFileSync(new URL('../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const defs = activeCamps(json);
const band = createBand(globalThis.ASSETS.levels.world_geo.regions);

// --- placement + content rules
ok('2 active camps, third authored but disabled', defs.length === 2 && json.camps.length === 3 && json.camps[2].enabled === false);
const bounds = world_m1.bounds.parts;
function inBounds(x, y) {
  for (const p of bounds) {
    if (p.shape === 'circle') { if (Math.hypot(x - p.x, y - p.y) <= p.r) return true; continue; }
    const dx = p.bx - p.ax, dy = p.by - p.ay;
    const t = Math.max(0, Math.min(1, ((x - p.ax) * dx + (y - p.ay) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(x - p.ax - t * dx, y - p.ay - t * dy) <= p.r) return true;
  }
  return false;
}
const modelIds = new Set(['brazier']); // existing prop models; anything else must be listed in needsDesigner
for (const c of json.camps) {
  ok(c.id + ' band >= 5 and west bank', band.bandAt(c.at[0], c.at[1]) >= 5 && c.at[0] < WEST_X, band.bandAt(c.at[0], c.at[1]));
  ok(c.id + ' 4-6 members', c.members.length >= 4 && c.members.length <= 6);
  ok(c.id + ' leash 25, respawn 3 days', c.leashR === 25 && c.respawnDays === 3);
  ok(c.id + ' members inside the walk bounds and the leash', c.members.every((m) => inBounds(c.at[0] + m.at[0], c.at[1] + m.at[1]) && Math.hypot(m.at[0], m.at[1]) <= c.leashR));
  ok(c.id + ' props: existing model or NEEDS DESIGNER', c.props.every((p) => modelIds.has(p.model) || json.needsDesigner.includes(p.model)));
  ok(c.id + ' members band >= 5', c.members.every((m) => band.bandAt(c.at[0] + m.at[0], c.at[1] + m.at[1]) >= 5));
}
const allIds = json.camps.flatMap((c) => c.members.map((m) => m.id));
ok('member ids unique and not clashing with world entities', new Set(allIds).size === allIds.length && allIds.every((id) => !world_m1.entities.some((e) => e.id === id)));
ok('roles melee/thrower only', json.camps.every((c) => c.members.every((m) => m.role === 'melee' || m.role === 'thrower')));

// --- ensureGoblinCamps
const ents = new Map();
const added = ensureGoblinCamps({ addEntity: (e) => ents.set(e.id, e) }, defs, null);
ok('spawn count = members of active camps (+ props)', added === defs.reduce((a, c) => a + c.members.length, 0) && ents.size === added + defs.reduce((a, c) => a + c.props.length, 0), added);
const g0 = ents.get(defs[0].members[0].id);
ok('goblin entity: species, role, home, leash', g0.components.brain.species === 'goblin' && g0.components.brain.role === 'melee' && g0.components.brain.leashR === 25 && g0.components.brain.home[0] === g0.transform.x);

// --- sim stub + events
function mk(stateInit = {}) {
  const handlers = {};
  const events = { on: (n, f) => { (handlers[n] ||= []).push(f); return () => { handlers[n] = handlers[n].filter((x) => x !== f); }; }, emit: (n, p) => { (handlers[n] || []).forEach((f) => f(p)); } };
  const slotById = {}; let k = 0; for (const id of allIds) slotById[id] = k++;
  const log = { dormant: {}, fled: [], down: {} }; const dead = new Set();
  const sim = {
    slotOf: (id) => (id in slotById ? slotById[id] : -1), isDead: (s) => dead.has(s),
    setDormant: (s, on) => { log.dormant[s] = on; }, flee: (s) => log.fled.push(s),
    setDown: (s, on) => { log.down[s] = on; if (!on) dead.delete(s); },
  };
  const state = { ...stateInit };
  const camps = createGoblinCamps({ defs, sim, events, state });
  const kill = (id) => { dead.add(slotById[id]); events.emit('beast:died', { id }); };
  return { camps, state, events, sim, log, kill, slotById };
}

// --- cleared flags + respawn rule
{
  const t = mk(); const c = defs[0]; let cleared = 0;
  t.events.on('life:camp:cleared', () => cleared++);
  t.camps.step(7, 925, 905);
  for (const m of c.members.slice(0, -1)) t.kill(m.id);
  ok('not cleared with a survivor', !t.state[clearedKey(c.id)] && cleared === 0);
  t.kill(c.members[c.members.length - 1].id);
  ok('all dead: cleared + day + down set, event once', t.state[clearedKey(c.id)] === true && t.state[dayKey(c.id)] === 7 && t.state[downKey(c.id)] === true && cleared === 1);
  ok('other camp untouched', !t.state[clearedKey(defs[1].id)]);
  const saved = JSON.parse(JSON.stringify(t.state));
  ok('only the three camp keys are saved', Object.keys(saved).every((k2) => /^life\.camp\.[A-Za-z]+\.(cleared|day|down)$/.test(k2)));
  const t2 = mk(saved);
  ok('save/load round trip: camp stays down (slots GONE)', c.members.every((m) => t2.log.down[t2.slotById[m.id]] === true));
  t2.camps.step(9, 0, 0);
  ok('day 9 (2 days): still down', t2.state[downKey(c.id)] === true);
  t2.camps.step(10, 925, 905);
  ok('3 days but player at the camp: still down (150 m guard)', t2.state[downKey(c.id)] === true);
  t2.camps.step(10, 925 + RESPAWN_FAR_R - 1, 905);
  ok('3 days, player 149 m away: still down', t2.state[downKey(c.id)] === true);
  t2.camps.step(10, 925 + RESPAWN_FAR_R + 1, 905);
  ok('3 days, player > 150 m away: respawned', t2.state[downKey(c.id)] === false && c.members.every((m) => t2.log.down[t2.slotById[m.id]] === false));
  ok('cleared stays true for quests', t2.state[clearedKey(c.id)] === true);
}

// --- morale: half dead -> survivors flee once
{
  const t = mk(); const c = defs[1]; // 4 members
  t.camps.step(1, 965, 975);
  t.kill(c.members[0].id);
  ok('1 of 4 dead: no flee', t.log.fled.length === 0);
  t.kill(c.members[1].id);
  ok('2 of 4 dead: the 2 survivors flee', t.log.fled.length === 2 && !t.log.fled.includes(t.slotById[c.members[0].id]) && !t.log.fled.includes(t.slotById[c.members[1].id]));
  t.kill(c.members[2].id);
  ok('flee only once', t.log.fled.length === 2);
}

// --- dormant when far, awake when near (hysteresis)
{
  const t = mk(); const c = defs[0]; const s0 = t.slotById[c.members[0].id];
  t.camps.step(1, c.at[0] + DORMANT_R - 5, c.at[1]);
  ok('155 m: awake', !t.camps.isDormant(0) && t.log.dormant[s0] === undefined);
  t.camps.step(1, c.at[0] + DORMANT_R + 5, c.at[1]);
  ok('> 160 m: dormant', t.camps.isDormant(0) && t.log.dormant[s0] === true && t.log.dormant[t.slotById[c.members[3].id]] === true);
  t.camps.step(1, c.at[0] + 150, c.at[1]);
  ok('150 m (inside the hysteresis band): still dormant', t.camps.isDormant(0));
  t.camps.step(1, c.at[0] + WAKE_R - 5, c.at[1]);
  ok('< 140 m: awake', !t.camps.isDormant(0) && t.log.dormant[s0] === false);
}

// --- resetAll while down keeps the camp down
{
  const t = mk({ [downKey(defs[0].id)]: true, [dayKey(defs[0].id)]: 1, [clearedKey(defs[0].id)]: true });
  t.log.down = {}; t.events.emit('beasts:reset');
  ok('beasts:reset re-applies the down state', defs[0].members.every((m) => t.log.down[t.slotById[m.id]] === true));
}

if (global.gc) {
  const t = mk(); t.camps.step(1, 0, 0); global.gc(); const b = process.memoryUsage().heapUsed;
  for (let i = 0; i < 200000; i++) t.camps.step(1, (i & 255) * 4, 900);
  global.gc(); ok('zero allocation per step', process.memoryUsage().heapUsed <= b + 1e6);
}
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
