// M4-W1: pure parts of tools/verify-m4-walk.mjs (step order, bugs.md row parsing + position, report rendering). No browser.
import assert from 'node:assert/strict';
import { STEPS, STOPS, stopPose, yawToward, extractPosition, parseBugRows, renderReport } from './verify-m4-walk.mjs';

assert.deepEqual(STEPS.map((s) => s.id), ['run-tests', 'check-deps', 'validate-content', 'quest-sim', 'route-walk', 'verify-m4-exit', 'verify-ch12-run']);
assert.deepEqual(STEPS.filter((s) => s.port).map((s) => s.id), ['verify-m4-exit', 'verify-ch12-run']);
assert.deepEqual(STOPS.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
assert.ok(Math.abs(yawToward({ x: 0, y: 0 }, [0, -5])) < 1e-9, 'north (-y) = yaw 0');
assert.ok(Math.abs(yawToward({ x: 0, y: 0 }, [5, 0]) - 90) < 1e-9, 'east = 90');
assert.equal(stopPose(STOPS[1]).yaw, 265); assert.equal(stopPose(STOPS[0]), null);

assert.deepEqual(extractPosition('pose 1497.15,1027.28 yaw 265, tower'), { x: 1497.15, y: 1027.28, z: undefined, yaw: 265, approx: false });
assert.deepEqual(extractPosition('pose (1264.25,1041.35,-30.93 yaw 344): floats'), { x: 1264.25, y: 1041.35, z: -30.93, yaw: 344, approx: false });
assert.deepEqual(extractPosition('Rook ruin (MAP-23, ~975,1058): arches'), { x: 975, y: 1058, z: undefined, yaw: null, approx: true });
assert.equal(extractPosition('scale 2.2, ring 4160 slots'), null);

const md = [
  '| ID | date | text | fix | status |', '|---|---|---|---|---|',
  '| OB-018 | 2026-10-11 | floats (1264.25,1041.35,-30.93 yaw 344) | lowered | fixed - verify (relays) |',
  '| OB-020 | 2026-10-11 | smoke ugly | puffs | fixed - verify |',
  '| OB-010 | T-posed woman | statue removed | fixed - verify |',
  '| OB-001 | 2026-10-01 | old | done | done |',
  '| OB-024 | 2026-10-11 | near ~975,1058 | rebuilt | fixed - verify (stone) |',
].join('\n');
const rows = parseBugRows(md);
assert.deepEqual(rows.map((r) => r.id), ['OB-018', 'OB-020', 'OB-010', 'OB-024']);
assert.equal(rows[0].pos.yaw, 344); assert.equal(rows[1].pos, null); assert.equal(rows[2].text, 'T-posed woman | statue removed'); assert.equal(rows[3].pos.approx, true);

const rep = renderReport({ date: '2026-10-12', steps: [{ id: 'run-tests', status: 'PASS', secs: 3 }, { id: 'check-deps', status: 'FAIL', secs: 1, note: 'boom' }, { id: 'quest-sim', status: 'SKIPPED' }],
  stops: [{ n: 2, id: 'tower-start', title: 'Tower', files: ['stop-02-tower-start.png'] }], bugs: [{ ...rows[0], file: 'ob-018.png' }, rows[1]] });
assert.match(rep, /\*\*RED\*\*/); assert.match(rep, /\| check-deps \| RED \|/); assert.match(rep, /\| quest-sim \| skipped \|/);
assert.match(rep, /\[stop-02-tower-start\.png\]/); assert.match(rep, /\| OB-020 \| smoke ugly \/ puffs \| owner check only \|/); assert.match(rep, /\[ob-018\.png\]/);
console.log('verify-m4-walk: step order, stops, row/position parsing, report PASS');
