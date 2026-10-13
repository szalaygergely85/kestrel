// GATE-FLAKY-02a (arch 38.61): river waterAt/riverAt/flowAt through the REAL per-tick consumer (wading.before), alone in its isolate
// (a shared test file feeds the polymorphic body shapes of other tests into the same function and inflates the number).
// Run: node --expose-gc game/js/quest/sim/wading.alloc.test.js
import { createWater, collectWaterDefs, World, integrate, PHYSICS } from '../../../../engine/index.js';
import { allocProbe, skipNote } from '../../../../tools/allocProbe.mjs';
import { createWading } from './wading.js';

const w = new World();
w.water = createWater(collectWaterDefs({ water: [{ id: 'r', shape: 'river', path: Array.from({ length: 11 }, (_, i) => [i * 60, 0, 10, 30, 1]) }] }, []));
w.physicsMode = 'mesh';
const sup = { floorH: 9.6, ceilH: 'sky', terrain: false, slope: false, nx: 0, ny: 0, nz: 1 };
w.supportAt = () => sup; w.floorAt = () => 9.6;
const wd = createWading(w);
const e = { transform: { x: 5, y: 5, z: 9.6 }, components: { body: { radius: 0.3, height: 1.7, eyeH: 1.6 } } };
const r = allocProbe((n) => { for (let i = 0; i < n; i++) wd.before(e); }, { n: 20000 });
if (skipNote(r, 'wading.before river alloc')) process.exit(0);
const imm = e.components.body.wadeImm;
console.log(`wading.before (waterAt + riverAt + flowAt): ${r.perCall.toFixed(2)} B/call, wadeImm ${imm.toFixed(2)}`);
if (!(imm > 0) || !(r.perCall < 8)) { console.log('FAIL wading.before river alloc'); process.exit(1); }
console.log('ok   wading.before river: < 8 B/call');
let bad = 0; const chk = (n, c, x) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n} (${x})`); if (!c) bad++; };
// wading + integrate: the delta over integrate alone (the stub collideCircle boxes its own args), < 16 B/step
w.collideCircle = (x, y, dx, dy, rr, z, g, o, out) => { out.x = x + dx; out.y = y + dy; out.blockedX = false; out.blockedY = false; out.nx = 0; out.ny = 0; return out; };
const e2 = { transform: { x: 5, y: 5, z: 9.6, yawDeg: 90, pitchDeg: 0 }, components: { body: { radius: 0.3, height: 1.7, eyeH: 1.6 } } };
const walkE = { forward: 1, strafe: 0, yawDeg: 90 }, south = { forward: -1, strafe: 0, yawDeg: 0 };
const PX = new Float64Array(100); for (let i = 0; i < 100; i++) PX[i] = 5 + i * 0.5;
let k = 0;
const ri = allocProbe((n) => { for (let i = 0; i < n; i++) { k++; e2.transform.x = PX[k % 100]; integrate(e2, 1 / 60, k % 2 ? walkE : south, w, PHYSICS); } }, { n: 5000, warm: 4 });
const rb = allocProbe((n) => { for (let i = 0; i < n; i++) { k++; e2.transform.x = PX[k % 100]; wd.before(e2); integrate(e2, 1 / 60, k % 2 ? walkE : south, w, PHYSICS); } }, { n: 5000, warm: 4 });
chk('wading.before adds < 16 B/step to integrate', rb.perCall - ri.perCall < 16, `${rb.perCall.toFixed(1)} vs integrate-only ${ri.perCall.toFixed(1)}`);
if (bad) process.exitCode = 1;
