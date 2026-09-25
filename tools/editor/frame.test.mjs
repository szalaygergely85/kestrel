// tools/editor/frame.test.mjs - US-031 (docs/architecture.md 24.13 S4):
// the idle-skip dirty-flag decision (24.1 decision 6 / 24.4), pulled out of
// `frame.js`'s `step()` as `idleSkip()` so it is testable without a real
// RenderTarget/World/canvas. Plain Node ESM, no test framework, no build
// step - matches engine/core/loop.test.js. Run with:
//
//   node tools/editor/frame.test.mjs

import { idleSkip } from './frame.js';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  }
}

// ---- dirty (a camera move / world reload / toggle) -> render once, then idle ----
{
  let dirty = true;
  const r1 = idleSkip(dirty, false, false);
  ok('dirty -> shouldRender', r1.shouldRender === true);
  ok('dirty, not animating, not baking -> nextDirty false (goes idle after this frame)', r1.nextDirty === false);
  dirty = r1.nextDirty;

  const r2 = idleSkip(dirty, false, false);
  ok('idle (dirty false, animate false, baking false) -> shouldRender false (the AC: no re-render while unchanged)', r2.shouldRender === false);
  ok('stays idle: nextDirty stays false', r2.nextDirty === false);
}

// ---- Animate toggle keeps rendering every frame, even with dirty already false ----
{
  const r = idleSkip(false, true, false);
  ok('animate:true renders even when dirty:false', r.shouldRender === true);
  ok('animate:true keeps nextDirty true (renders again next frame too)', r.nextDirty === true);
}

// ---- the far terrain bake keeps rendering until farReady, then stops --------
{
  const baking = idleSkip(false, false, true);
  ok('farBaking:true renders even when dirty/animate are false', baking.shouldRender === true);
  ok('farBaking:true keeps nextDirty true while it runs', baking.nextDirty === true);

  const doneBaking = idleSkip(baking.nextDirty, false, false); // farReady flipped since last frame
  ok('once the bake finishes (farBaking:false) and nothing else is dirty, the NEXT frame renders once more (nextDirty carried true)', doneBaking.shouldRender === true);
  ok('...then goes idle after that', idleSkip(doneBaking.nextDirty, false, false).shouldRender === false);
}

// ---- a dirty frame that arrives while animate is already on stays dirty forever (expected: animate alone drives it) ----
{
  const r = idleSkip(true, true, false);
  ok('dirty + animate both true -> renders', r.shouldRender === true);
  ok('nextDirty follows animate, not the incoming dirty flag', r.nextDirty === true);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
