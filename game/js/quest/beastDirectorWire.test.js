// BEAST-WIRE-01: director wire with a fake sim/world: kill -> timer -> respawn (never in view), save round trip, difficulty apply/refuse.
import assert from 'node:assert/strict';
import { createBeastDirectorWire, terrainLos, viewCosFor } from './beastDirectorWire.js';
import { createTactics } from './sim/tactics.js';
import { difficultyName, requestDifficulty, setDifficultyName, DIFFICULTY_REFUSED } from '../ui/difficultyFlag.js';

const handlers = {}, hs = {}, events = { on: (n, f) => { (hs[n] = hs[n] || []).push(f); handlers[n] = (p) => hs[n].slice().forEach((h) => h(p)); return () => { hs[n] = hs[n].filter((h) => h !== f); }; } };
const members = [];
for (let k = 0; k < 3; k++) members.push({ id: 'boar.downs.' + (k + 1), species: 'boar', region: 'downs', group: 0, x: 500 + k, y: 500 });
for (let k = 0; k < 2; k++) members.push({ id: 'grey_wolf.nw.' + (k + 1), species: 'grey_wolf', region: 'nw', group: 0, x: 900 + k, y: 900 });
const mkSim = () => { const resets = [], downs = new Set(); return { resets, downs, count: 5, state: new Uint8Array(8), setDown: (s, on) => { if (on) downs.add(s); else { downs.delete(s); resets.push(s); } }, isDown: (s) => downs.has(s), tactics: createTactics(8, 1), slotOf: (id) => members.findIndex((m) => m.id === id), respawnSlot: (s) => { resets.push(s); return true; } }; };
const flat = { heightAt: () => 0 };
const mk = (sim, state) => createBeastDirectorWire({ sim, members, seed: 12, state, events, terrain: flat, dayLenSec: 600, los: () => false });

setDifficultyName('normal');
let sim = mkSim(), state = {}, w = mk(sim, state);
assert.equal(w.groups.length, 2);
const died = (i) => handlers['beast:died']({ id: members[i].id });
died(0); died(1); died(2);
assert.equal(w.dir.dead[0], 1, 'boar group dead');
const far = [-300, -300]; let t = 0;
const run = (sec) => { for (let i = 0; i < sec * 60; i++) { w.step(1 / 60, far[0], far[1], -1, 0); t += 1 / 60; } };
run(100); assert.equal(sim.resets.length, 0, 'not before the timer');
run(300); assert.deepEqual(sim.resets, [0, 1, 2], 'common timer 360 s elapsed -> every member reset at home');
assert.equal(w.dir.dead[0], 0);
// wolf group: save mid-timer, restore on a new wire (unpaused time continues from the saved clock)
died(3); died(4); run(100);
const blob = JSON.parse(JSON.stringify(state)); assert.ok(blob['beast.v1'].g['grey_wolf.nw.1'], 'dead group saved by gid');
sim = mkSim(); sim.events = events; const state2 = JSON.parse(JSON.stringify(blob)); w.dispose(); w = mk(sim, state2);
assert.equal(w.dir.dead[1], 1, 'dead group restored');
assert.deepEqual([...sim.downs].sort(), [3, 4], 'reload: dead group members are parked down');
sim.downs.clear(); handlers['beasts:reset'](); assert.deepEqual([...sim.downs].sort(), [3, 4], 'resetAll/travel: still down');
assert.ok(w.dir.dueAt(1) - w.dir.t > 300 && w.dir.dueAt(1) - w.dir.t < 400, 'remaining pack timer ~380 s: ' + (w.dir.dueAt(1) - w.dir.t));
// view rule: player standing 100 m from home looking at it -> deferred, not respawned
for (let i = 0; i < 600 * 60; i++) w.step(1 / 60, 900 - 100, 900, 1, 0);
assert.equal(sim.resets.length, 0, 'in view cone -> no respawn');
for (let i = 0; i < 600; i++) w.step(1 / 60, 900 - 100, 900, -1, 0);
assert.deepEqual(sim.resets, [3, 4], 'looks away -> respawn (setDown off)'); assert.equal(sim.downs.size, 0);
assert.ok(Math.abs(w.dir.viewCos - viewCosFor(1.2)) < 1e-12); w.setHfov(0.8); assert.ok(w.dir.viewCos > viewCosFor(1.2));
// difficulty: applied through the flag, refused while a token is held
assert.equal(requestDifficulty('hard'), true); assert.equal(difficultyName(), 'hard'); assert.equal(w.dir.diffName, 'hard');
sim.tactics.nM = 1;
assert.equal(requestDifficulty('easy'), false, 'refused during a fight'); assert.equal(difficultyName(), 'hard');
assert.ok(/fight/.test(DIFFICULTY_REFUSED));
sim.tactics.nM = 0; sim.state[2] = 2; assert.equal(requestDifficulty('easy'), false, 'refused: a legacy slot is chasing (no token)'); sim.state[2] = 0;
assert.equal(requestDifficulty('easy'), true); assert.equal(w.dir.diffName, 'easy');
w.dispose(); assert.equal(requestDifficulty('normal'), true, 'no applier -> just remembered');
// terrain LOS: a ridge blocks
assert.equal(terrainLos({ heightAt: (x) => (x > 40 && x < 60 ? 50 : 0) })(0, 0, 100, 0), false);
assert.equal(terrainLos(flat)(0, 0, 100, 0), true);
console.log('beastDirectorWire.test: PASS');
