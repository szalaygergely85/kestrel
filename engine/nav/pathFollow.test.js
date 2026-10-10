// CH1-E1. Run: node engine/nav/pathFollow.test.js
import assert from 'node:assert/strict';
import { createPathFollower } from './pathFollow.js';
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const pts = Float64Array.from([0, 0, 10, 0, 10, 10]);
const DT = 1 / 60;

// arrival + seg + onArrive events
{
  const hits = [];
  const f = createPathFollower(pts, { speed: 2, arriveR: 0.5, onArrive: i => hits.push(i) });
  let steps = 0;
  while (!f.done && steps++ < 5000) f.step(DT);
  ok(f.done && f.x === 10 && f.y === 10 && f.seg === 2, 'arrives at end');
  ok(hits.join() === '1,2', 'arrive events per waypoint');
  ok(f.s > 17 && f.s < 20.001, 'path length with corner rounding ' + f.s);
  ok(f.step(DT) === false, 'done follower does not move');
}
// yaw: heading +x = 90 (yawFromDelta(dx,dy) = atan2(dx,-dy))
{
  const f = createPathFollower(pts, { speed: 2, turnRate: 100000 });
  f.step(DT);
  ok(Math.abs(f.yawDeg - 90) < 1e-9, 'yaw faces +x');
  const g = createPathFollower(pts, { speed: 2, turnRate: 90 });
  g.step(DT);
  ok(Math.abs(g.yawDeg - 1.5) < 1e-9, 'turn rate limits yaw: ' + g.yawDeg);
}
// reset(seg) resumes at a waypoint
{
  const f = createPathFollower(pts, { speed: 2 });
  f.reset(1);
  ok(f.x === 10 && f.y === 0 && f.seg === 1 && !f.done, 'reset(1)');
  f.step(DT);
  ok(f.y > 0 && Math.abs(f.x - 10) < 1e-9, 'heads for next waypoint');
  f.reset(2); ok(f.done, 'reset(last) is done');
}
// speedScale 0 => no movement
{
  const f = createPathFollower(pts, { speed: 2 });
  ok(f.step(DT, 0) === false && f.x === 0, 'speedScale 0');
  ok(f.step(DT, 1) === true && f.x > 0, 'speedScale 1 moves');
}
// wait-for-target hysteresis
{
  const f = createPathFollower(pts, { speed: 2, waitFar: 10, resumeNear: 6 });
  ok(f.step(DT, 1, -20, 0) === false && f.waiting, 'player far: wait');
  ok(f.step(DT, 1, -8, 0) === false && f.waiting, 'between thresholds: still waiting');
  ok(f.step(DT, 1, -5, 0) === true && !f.waiting, 'player close: resume');
  ok(f.step(DT, 1, -9, 0) === true, 'under waitFar: keeps walking');
}
// large dt does not skip waypoints; determinism; heap flat
{
  const hits = [];
  const f = createPathFollower(pts, { speed: 100, arriveR: 0.1, onArrive: i => hits.push(i) });
  f.step(1);
  ok(f.done && hits.join() === '1,2', 'big dt crosses corners in order');
  const run = () => { const g = createPathFollower(pts, { speed: 1.7, arriveR: 0.6, turnRate: 200 }); const o = []; for (let i = 0; i < 1500; i++) { g.step(DT, i % 7 ? 1 : 0.5); o.push(g.x, g.y, g.yawDeg); } return o; };
  const a = run(), b = run();
  ok(a.length === b.length && a.every((v, i) => v === b[i]), 'deterministic');
  const loop = Float64Array.from([0, 0, 5, 0, 5, 5, 0, 5]);
  const g = createPathFollower(loop, { speed: 3 });
  for (let i = 0; i < 2000; i++) { g.step(DT, 1, 0, 0); if (g.done) g.reset(0); }
  global.gc && global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) { g.step(DT, 1, 0, 0); if (g.done) g.reset(0); }
  global.gc && global.gc();
  const grow = process.memoryUsage().heapUsed - h0;
  ok(grow < 200000, 'heap flat over 10k steps: ' + grow);
}
console.log(`pathFollow: ${checks} checks ok`);
