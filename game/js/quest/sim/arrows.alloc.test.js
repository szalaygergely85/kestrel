// GATE-FLAKY-02a (arch 38.61): arrow-sim floater step (real consumer of waterAt/riverAt), alone in its isolate (see wading.alloc.test.js).
// Run: node --expose-gc game/js/quest/sim/arrows.alloc.test.js
import { createWater, collectWaterDefs, World } from '../../../../engine/index.js';
import { allocProbe, skipNote } from '../../../../tools/allocProbe.mjs';
import { BOW_CFG } from '../bowConfig.js';
import { createTargetables } from './targetables.js';
import { createArrowSim } from './arrows.js';

const w = new World();
w.water = createWater(collectWaterDefs({ water: [{ id: 'r', shape: 'river', path: Array.from({ length: 11 }, (_, i) => [i * 60, 0, 10, 30, 1]) }] }, []));
w.physicsMode = 'mesh';
const sup = { floorH: 9.6, ceilH: 'sky', terrain: false, slope: false, nx: 0, ny: 0, nz: 1 };
w.supportAt = () => sup; w.floorAt = () => 9.6;
let bad = 0; const chk = (n, c, x) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n} (${x})`); if (!c) bad++; };
// arrow sim with a floater (real consumer of waterAt/flowAt): armed once, floater outlives all windows (~14000 steps x ~0.02 m stay inside the 600 m river)
w.raySegment = (ax, ay, az, bx, by, bz, out) => { if (bz > 9.6) return false; const t = (az - 9.6) / (az - bz); out.t = t; out.x = ax + (bx - ax) * t; out.y = ay + (by - ay) * t; out.z = 9.6; return true; };
w.state = {}; w.forEachEntity = () => {};
const events = { on() { return () => {}; }, emit() {} };
const sim = createArrowSim(w, events, { ...BOW_CFG, floatSteps: 1e7 }, createTargetables(w, events));
sim.fire(5, 0, 12, 0, 0, -1, 0, 1); for (let i = 0; i < 40; i++) sim.step();
const ra = allocProbe((n) => { for (let i = 0; i < n; i++) sim.step(); }, { n: 5000, warm: 2 });
chk('arrow sim with a floater < 16 B/step', sim.floatCount === 1 && ra.perCall < 16, `${ra.perCall.toFixed(1)} B/step, floaters ${sim.floatCount}`);
if (bad) process.exitCode = 1;
