// game/js/quest/sim/waterNav.test.js (BEAST-08a, arch 38.64 item 5): water mask == waterAt depth per nav cell; swimmers stay on mask 1,
// crocs on 1+2; SUBMERGED z = surface - 0.4; deterministic; 0 alloc per step. Run: node --expose-gc game/js/quest/sim/waterNav.test.js
import { NavGrid } from '../../../../engine/index.js';
import { makeOk } from '../../../../engine/test/assert.js';
import { allocProbe, skipNote } from '../../../../tools/allocProbe.mjs';
import { buildWaterNav, buildWaterMask } from './beastNav.js';
import { createSwimmers, spawnSwimmer, stepSwimmers, swimmerMask, KIND_SWIMMER, KIND_CROC, SWIM_SUBMERGE_M } from './brains/water.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// Fixture world: a round lake (centre 60,60; depth 2.5 in the middle falling to 0 at r=30; surface z 5).
let calls = 0;
const fake = {
  waterAt(x, y, out) {
    calls++;
    const d = Math.hypot(x - 60, y - 60);
    if (d >= 30) return false;
    out.depth = 2.5 * (1 - d / 30); out.surfaceZ = 5; out.flatZ = 5; return true;
  },
};
const grid = new NavGrid({ x0: 0, y0: 0, w: 120, h: 120, cell: 1 });
const nav = buildWaterNav(fake, grid);
ok('one waterAt call per cell', calls === 120 * 120, `calls=${calls}`);
const wq = { surfaceZ: 0, flatZ: 0, depth: 0 };
let bad = 0, c1 = 0, c2 = 0, badBand = 0;
for (let cy = 0; cy < 120; cy++) for (let cx = 0; cx < 120; cx++) {
  const i = cy * 120 + cx, wet = fake.waterAt(grid.cellCenterX(cx), grid.cellCenterY(cy), wq);
  const deep = wet && wq.depth >= 0.6;
  if ((nav.mask[i] === 1) !== deep) bad++;
  if (nav.mask[i] === 1) c1++;
  if (nav.mask[i] === 2) { c2++; if (deep) badBand++; }
}
ok('mask 1 == (waterAt depth >= 0.6) on every cell', bad === 0 && c1 > 1000, `bad=${bad} deep=${c1}`);
ok('mask 2 is a non-deep bank band', c2 > 300 && badBand === 0, `band=${c2}`);
let gridOk = true;
for (let i = 0; i < nav.mask.length; i++) {
  if ((nav.swim.grid.cost[i] > 0) !== (nav.mask[i] === 1)) gridOk = false;
  if ((nav.croc.grid.cost[i] > 0) !== (nav.mask[i] === 1 || nav.mask[i] === 2)) gridOk = false;
}
ok('swim grid walkable == mask 1; croc grid == mask 1|2', gridOk);
const m2 = buildWaterMask(fake, grid);
ok('mask build is deterministic', Buffer.compare(Buffer.from(m2.mask), Buffer.from(nav.mask)) === 0);

const makePool = () => {
  const p = createSwimmers(nav, { max: 8, seed: 7, speed: 2.5 });
  for (const [x, y] of [[60, 60], [50, 62], [70, 55], [62, 45]]) spawnSwimmer(p, KIND_SWIMMER, x, y);
  spawnSwimmer(p, KIND_CROC, 60, 33.5); // bank band start (r ~ 26.5)
  spawnSwimmer(p, KIND_CROC, 58, 75);
  return p;
};
const s = makePool();
ok('spawn: 6 slots; a dry cell is refused', s.n === 6 && spawnSwimmer(s, KIND_SWIMMER, 5, 5) === -1);
let leaveSwim = 0, leaveCroc = 0, badZ = 0, moved = 0, crocBank = 0;
const x0 = Float32Array.from(s.x), y0 = Float32Array.from(s.y);
for (let t = 0; t < 10000; t++) {
  stepSwimmers(s);
  for (let i = 0; i < s.n; i++) {
    const m = swimmerMask(s, i);
    if (s.kind[i] === KIND_SWIMMER ? m !== 1 : (m !== 1 && m !== 2)) { if (s.kind[i] === KIND_SWIMMER) leaveSwim++; else leaveCroc++; }
    if (s.kind[i] === KIND_CROC && m === 2) crocBank++;
    if (Math.abs(s.z[i] - (5 - SWIM_SUBMERGE_M)) > 1e-6) badZ++;
  }
}
for (let i = 0; i < s.n; i++) if (Math.hypot(s.x[i] - x0[i], s.y[i] - y0[i]) > 1) moved++;
ok('swimmers never leave mask 1 over 10k steps', leaveSwim === 0, `left=${leaveSwim}`);
ok('crocs never leave mask 1+2 over 10k steps', leaveCroc === 0, `left=${leaveCroc} bankSteps=${crocBank}`);
ok('SUBMERGED z = surface - 0.4 every step', badZ === 0, `bad=${badZ}`);
ok('slots actually swim (wander away from spawn)', moved >= 4, `moved=${moved}/6, snaps=${s.guard}`);
const s2 = makePool(); for (let t = 0; t < 10000; t++) stepSwimmers(s2);
ok('same result every run (10k steps, bytes)', Buffer.compare(Buffer.from(s.x.buffer), Buffer.from(s2.x.buffer)) === 0 && Buffer.compare(Buffer.from(s.y.buffer), Buffer.from(s2.y.buffer)) === 0);

const r = allocProbe((n) => { for (let i = 0; i < n; i++) stepSwimmers(s); }, { n: 5000, warm: 60 });
if (!skipNote(r, 'water brain alloc')) ok('water brain <= 1.5 B/step = probe floor (min of 5 gc windows)', r.perCall < 1.5, `${r.perCall.toFixed(2)} B/step`);

console.log(`waterNav: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
