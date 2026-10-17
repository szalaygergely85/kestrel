// Owner 2026-10-10: walking out of the open SW tower door (cell Q -> trench row 12 -> ring) must enter the towerDoor area (completes `leave`).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const w = JSON.parse(readFileSync(new URL('../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const all = JSON.stringify(w);
const m = /\{"id":"towerDoor"[^}]*"r":(\d+),"shape":"circle","x":(\d+),"y":(\d+)\}/.exec(all);
assert.ok(m, 'towerDoor area row');
const [r, cx, cy] = [+m[1], +m[2], +m[3]];
const inside = (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
assert.ok(!inside(1495.5, 1030.5), 'the doorway itself is outside the area (the player leaves, not just stands at the bar)');
assert.ok(inside(1490.5, 1030.5), 'trench steps toward the ring are inside');
assert.ok(inside(1488.5, 1030.5), 'ring top is inside');
console.log('towerDoorArea.test ok');
