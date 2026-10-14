// POI-03: discovery toast once per POI, plain name, saved, map marks, no counts.
import assert from 'node:assert/strict';
import { createPoiWire } from '../life/poiWire.js';
import { createPoiDiscover } from './poiDiscover.js';

const defs = [
  { id: 'poi.a.1', name: 'Hollow Oak', at: [100, 100], props: [], kind: 'inspect' },
  { id: 'poi.b.1', name: 'River Farm', at: [500, 500], props: [], kind: 'npc' },
];
const world = { addEntity() {}, removeEntity() {} }, state = {};
const say = []; const mk = (st) => createPoiDiscover({ wire: createPoiWire({ world, defs, state: st }), say: (t) => say.push(t) });
const pd = mk(state);
pd.step(0, 0); assert.deepEqual(say, [], 'far away: nothing');
pd.step(100, 112.5); assert.deepEqual(say, [], '12.5 m: not yet');
pd.step(100, 110); assert.deepEqual(say, ['Found: Hollow Oak'], 'within 12 m: plain name');
pd.step(100, 100); pd.step(101, 100); assert.equal(say.length, 1, 'once only');
assert.ok(!say.some((t) => /poi\.|\d+\s*\/\s*\d+|all|found \d/i.test(t)), 'no id, no counter');
assert.deepEqual(pd.marks(), [{ x: 100, y: 100 }], 'one mark for the found POI');
const again = mk(JSON.parse(JSON.stringify(state))); // save round trip
again.step(100, 100); assert.equal(say.length, 1, 'saved: no second toast after load');
assert.equal(again.marks().length, 1, 'saved: mark stays');
pd.step(500, 500); assert.equal(say[1], 'Found: River Farm');
assert.equal(pd.marks().length, 2);
console.log('poiDiscover: toast once, plain name, saved, marks, no counter PASS');
