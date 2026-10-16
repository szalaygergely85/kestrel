// OB-089 part 4: placements beyond streaming.cutM are not in the active list; landmarks (keepFar) are.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PlacementGrid } from './placementGrid.js';

const world = JSON.parse(fs.readFileSync(new URL('../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const st = world.streaming;
assert.ok(st && st.cutM > 0 && st.cutM <= 200, 'world_m1 streaming.cutM set (<= 200 m)');
const box = (id, x, y, r) => ({ id, kind: 'mesh', bbox: { x0: x - r, y0: y - r, z0: 0, x1: x + r, y1: y + r, z1: 2 * r } });
const S = [box('ow_wall1', 400, 0, 6), box('sg_wall1', 400, 0, 6), box('relayBendBase', 400, 0, 6), box('ow_wall2', 100, 0, 6), { ...box('x1', 400, 0, 6), keepFar: true }];
const g = new PlacementGrid(S, st);
g.update(0, 0);
const act = new Set(Array.from(g.activeList.subarray(0, g.activeCount)));
assert.ok(!act.has(0), 'far building (400 m) not drawn');
assert.ok(act.has(2) && act.has(4), 'landmarks (relay / keepFar flag) stay');
assert.ok(!act.has(1), 'OB-059/OB-209: the Sealed Gate (sg*) is NOT a landmark - seen from the tower it floated in the sky as a dark J');
assert.ok(act.has(3), 'near building kept');
const off = new PlacementGrid(S, {}); off.update(0, 0);
assert.ok(new Set(Array.from(off.activeList.subarray(0, off.activeCount))).has(0), 'no cutM = old behaviour');
console.log('placementCut.test ok');
