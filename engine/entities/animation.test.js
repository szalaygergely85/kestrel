// engine/entities/animation.test.js (US-011, docs/architecture.md 10.1/7.5
// item 7). Headless Node ESM, no framework. Run:
//   node engine/entities/animation.test.js
//
// A synthetic model (not design content) with a durations clip [100, 50]
// (tag on frame 1), so the frame/tag/animEnd sequence is exact and doesn't
// depend on any real asset's fps. Uses a bare `World` (no `World.load`) with
// `world.assets` set by hand, exactly what a bare-World test needs per the
// "assets stays null unless load sets it" rule (World.js constructor note).
import { World } from '../world/World.js';
import { AssetRegistry } from '../core/assets.js';
import { stepAnimations, compileClip, compileVoxelClip, animComponent } from './animation.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const palette = { rgb: { x: [1, 1, 1] }, util: { validate: () => [] } };
const model = {
  name: 'blinker', billboard: true, size: { w: 1, h: 1 }, anchor: { x: 0, y: 0 }, world: { w: 0.1, h: 0.1 },
  keys: { x: { c: 'x' } },
  animations: {
    // durations [100, 50] ms; frame 1 tagged 'mid'. loop: false -> holds on
    // the last frame and fires 'animEnd' exactly once.
    blink: { loop: false, durations: [100, 50], events: { mid: 1 }, frames: [
      { S: { glyphs: ['x'], fg: ['x'] } }, { S: { glyphs: ['x'], fg: ['x'] } },
    ] },
    idle: { loop: true, durations: [40], frames: [{ S: { glyphs: ['x'], fg: ['x'] } }] },
    roll: { fps: 0, loop: true, frames: [{ S: { glyphs: ['x'], fg: ['x'] } }, { S: { glyphs: ['x'], fg: ['x'] } }] },
  },
};
// US-041a (15.3 item 1): a synthetic voxel-model fixture - `components.voxel`
// resolves animations through `model.voxel.animations` (a VoxelClipDef,
// not a sprite frame list), same durations/loop/events shape as `blinker`
// above so `compileVoxelClip` can be exercised the same way `compileClip` is.
const voxelModel = {
  name: 'lever_fixture', voxel: {
    animations: {
      idle: { loop: true, durations: [1000], frames: [{}] },
      pull: { loop: false, durations: [100, 50], events: { clunk: 1 }, frames: [{}, {}] },
    },
  },
};
const assets = new AssetRegistry({ palette, models: { blinker: model, lever_fixture: voxelModel } });

// ---- compileClip -----------------------------------------------------------
{
  const clip = compileClip(model.animations.blink);
  ok('compileClip: durMs from `durations`', clip.durMs[0] === 100 && clip.durMs[1] === 50);
  ok('compileClip: loop carried through', clip.loop === false);
  ok('compileClip: tagCodes has "mid" on frame 1, null elsewhere', clip.tagCodes[0] === null && clip.tagCodes[1] === 'mid');
  ok('compileClip: count == frames.length', clip.count === 2);
  ok('compileClip: fps:0 clip is marked fps0 and never advanced', compileClip(model.animations.roll).fps0 === true);
  ok('compileClip caches on the anim def (same object back)', compileClip(model.animations.blink) === clip);
}

// ---- stepAnimations: frame/tag/animEnd sequence, 60 Hz steps --------------
{
  const world = new World();
  world.assets = assets;
  const events = [];
  const h = world.spawn('prop', { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 },
    { sprite: { model: 'blinker', anim: 'blink' } }, 'blinker1');
  h.on('mid', () => events.push('mid'));
  h.onAnimEnd((handle, name, anim) => events.push(`end:${anim}`));

  // The event ring is only dispatched by `world.flushEvents()` (10.1: "the
  // ring is flushed after the sim step") - a helper so every loop below
  // does the same step+flush a real sim step does.
  const DT = 1000 / 60; // ms
  function stepAndFlush(n) { for (let i = 0; i < n; i++) { stepAnimations(world, DT); world.flushEvents(); } }

  // 100 ms / (1000/60) ~= 6 steps to clear frame 0's duration.
  stepAndFlush(6);
  const s1 = h.getComponent('sprite');
  ok('after ~100 ms the clip advanced to frame 1', s1.frame === 1, JSON.stringify(s1));
  ok('frame 1\'s "mid" tag fired exactly once', events.filter((e) => e === 'mid').length === 1, events.join(','));
  ok('still playing (frame 1 has not finished its own 50 ms yet - t just rolled over)', s1.playing === true);

  // Another ~50 ms clears frame 1 -> non-loop holds on the last frame, fires animEnd once.
  stepAndFlush(4);
  const s2 = h.getComponent('sprite');
  ok('non-loop clip holds on the last frame (1) once finished', s2.frame === 1 && s2.playing === false, JSON.stringify(s2));
  ok('animEnd fired exactly once, naming the anim', events.filter((e) => e === 'end:blink').length === 1, events.join(','));

  // Further steps: playing === false -> stepAnimations skips it (no more events, no throw).
  stepAndFlush(20);
  ok('no further events once stopped', events.filter((e) => e === 'end:blink').length === 1);

  // fps:0 clip (boulder roll / lever gear): never advanced by stepAnimations,
  // even though it is "playing".
  const r = world.spawn('prop', { x: 1, y: 1, z: 0, yawDeg: 0, pitchDeg: 0 }, { sprite: { model: 'blinker', anim: 'roll' } }, 'roller1');
  r.data.components.sprite.frame = 1;
  stepAndFlush(120); // 2 s, would be many "frames" at any real fps
  ok('fps:0 clip is untouched by stepAnimations (gameplay-driven)', r.getComponent('sprite').frame === 1);

  // Allocation-free per the "no allocation once compiled" rule: 300 steps
  // over both entities produce no thrown error and no growth of the warn
  // Set (already-compiled clips, no unknown anims here).
  if (typeof global.gc === 'function') {
    stepAndFlush(30);
    global.gc();
    const before = process.memoryUsage().heapUsed;
    stepAndFlush(300);
    global.gc();
    const grew = process.memoryUsage().heapUsed - before;
    ok('300 steps of stepAnimations: no significant heap growth', grew < 256 * 1024, `grew by ${grew} bytes`);
  } else {
    ok('300 steps of stepAnimations run (use --expose-gc for the heap check)', true);
  }
}

// ---- play()/stop()/onAnimEnd() via EntityHandle ----------------------------
{
  const world = new World();
  world.assets = assets;
  const h = world.spawn('prop', { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 }, { sprite: { model: 'blinker', anim: 'idle' } }, 'p1');
  h.play('blink');
  ok('play() resets frame/t and sets anim/loop from the clip', () => true);
  const s = h.getComponent('sprite');
  ok('play("blink"): anim/frame/t/loop/playing set from the clip', s.anim === 'blink' && s.frame === 0 && s.t === 0 && s.loop === false && s.playing === true);

  // calling play() again with the SAME anim while already playing is a no-op (safe every frame)
  s.frame = 1;
  h.play('blink');
  ok('play(sameAnim) while already playing is a no-op (frame untouched)', h.getComponent('sprite').frame === 1);

  // restart: true forces it even if already playing the same anim
  h.play('blink', { restart: true });
  ok('play(sameAnim, {restart:true}) resets the frame', h.getComponent('sprite').frame === 0);

  h.stop();
  ok('stop() holds the current frame (playing=false)', h.getComponent('sprite').playing === false);

  // unknown anim: console.error once, no throw, no state change
  const savedFrame = h.getComponent('sprite').frame;
  let errored = 0;
  const origErr = console.error;
  console.error = () => { errored++; };
  h.play('no-such-anim');
  console.error = origErr;
  ok('play(unknownAnim) logs once and does not change sprite state', errored === 1 && h.getComponent('sprite').frame === savedFrame);

  let ended = null;
  h.onAnimEnd((handle, name, anim) => { ended = anim; });
  h.play('blink', { restart: true });
  const DT = 1000 / 60;
  for (let i = 0; i < 10; i++) { stepAnimations(world, DT); world.flushEvents(); } // >150ms clears both frames
  ok('onAnimEnd fires after play() + stepAnimations run the clip to completion', ended === 'blink');
}

// ---- US-041a: components.voxel (15.3 item 1) --------------------------------
{
  const clip = compileVoxelClip(voxelModel.voxel.animations.pull);
  ok('compileVoxelClip: durMs from `durations`', clip.durMs[0] === 100 && clip.durMs[1] === 50);
  ok('compileVoxelClip: loop carried through', clip.loop === false);
  ok('compileVoxelClip: tagCodes has "clunk" on frame 1', clip.tagCodes[0] === null && clip.tagCodes[1] === 'clunk');
  ok('compileVoxelClip: count == frames.length', clip.count === 2);
  ok('compileVoxelClip caches on the anim def (same object back)', compileVoxelClip(voxelModel.voxel.animations.pull) === clip);

  const world = new World();
  world.assets = assets;

  // World.spawn throws on an entity with BOTH sprite and voxel (15.3 item 1).
  let threw = false;
  try {
    world.spawn('prop', { x: 0, y: 0, z: 0 }, { sprite: { model: 'blinker', anim: 'idle' }, voxel: { model: 'lever_fixture', anim: 'idle' } }, 'both1');
  } catch (e) { threw = true; }
  ok('World.spawn throws when both sprite and voxel are given', threw);

  const h = world.spawn('prop', { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 }, { voxel: { model: 'lever_fixture', anim: 'idle' } }, 'lever1');
  ok('animComponent(e) returns the voxel component (no sprite present)', animComponent(h.data) === h.data.components.voxel);
  ok('components.voxel gets the same default shape as sprite (t/frame/speed/playing)',
    h.data.components.voxel.t === 0 && h.data.components.voxel.frame === 0 && h.data.components.voxel.speed === 1 && h.data.components.voxel.playing === true);

  const events = [];
  h.on('clunk', () => events.push('clunk'));
  let ended = null;
  h.onAnimEnd((handle, name, arg) => { ended = arg; });

  h.play('pull'); // EntityHandle.play must resolve through model.voxel.animations, not model.animations
  const v = h.getComponent('voxel');
  ok('play("pull") on a voxel component: anim/frame/t/loop/playing set from the VoxelClipDef', v.anim === 'pull' && v.frame === 0 && v.t === 0 && v.loop === false && v.playing === true);

  const DT = 1000 / 60;
  function stepAndFlush(n) { for (let i = 0; i < n; i++) { stepAnimations(world, DT); world.flushEvents(); } }
  // ~100 ms clears frame 0 -> frame 1, firing the "clunk" tag.
  stepAndFlush(6);
  const v1 = h.getComponent('voxel');
  ok('stepAnimations advances a voxel component exactly like a sprite one (frame -> 1)', v1.frame === 1, JSON.stringify(v1));
  ok('frame 1\'s "clunk" tag fired exactly once', events.filter((e) => e === 'clunk').length === 1, events.join(','));
  // Another ~50 ms clears frame 1 -> non-loop holds on the last frame, fires animEnd once (US-014/15.3 item 4: "lever.pull still calls play('pull')").
  stepAndFlush(4);
  const v2 = h.getComponent('voxel');
  ok('non-loop voxel clip holds on the last frame once finished', v2.frame === 1 && v2.playing === false, JSON.stringify(v2));
  ok('voxel.anim stays "pull" after the clip finishes (survives save/load like a sprite\'s anim)', v2.anim === 'pull');
  ok('animEnd fired exactly once for the voxel component', ended === 'pull');
  stepAndFlush(20);
  ok('no further animEnd once stopped', events.length === 1 && ended === 'pull');
}

console.log(`\n[animation.test.js] ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error('  FAIL: ' + f); process.exit(1); }
