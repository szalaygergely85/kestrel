// game/js/quest/targeting.test.js (US-128b, architecture.md 29.2). Headless Node ESM, no framework.
// Run: node game/js/quest/targeting.test.js
//
// Fake world + stub look (29.2's own test note), not the real engine World: targeting.js only ever calls
// `world.forEachEntity`, `world.get(id)` and passes `world` through to `canSee` (which needs `structureAt` +
// `outsideSector` - see engine/world/interaction.js `pointBlocked`). A tiny local `events` stub (same shape as
// engine/core/events.js) drives `entity:added`/`entity:removed`.
import { makeOk } from '../../../engine/test/assert.js';
import { createTargeting } from './targeting.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- fixtures -----------------------------------------------------------------------------------------------------

/** @param {{x?:number,y?:number,z?:number,eyeH?:number}} [opts] */
function makePlayer(opts = {}) {
  return {
    id: 'player',
    transform: { x: opts.x || 0, y: opts.y || 0, z: opts.z || 0, yawDeg: 0, pitchDeg: 0 },
    components: { body: { eyeH: opts.eyeH ?? 1.6 } },
  };
}

function makeTarget(id, x, y, z = 0, { radius = 0.45, height = 0.7, hp } = {}) {
  const e = { id, transform: { x, y, z, yawDeg: 0 }, components: { targetable: { radius, height } } };
  if (typeof hp === 'number') e.components.health = { hp, max: 10 };
  return e;
}

function makeLook(yawDeg = 0, pitchDeg = 0) {
  return {
    yawDeg, pitchDeg,
    locked: false,
    lockActive: false,
    setLockCalls: 0,
    clearCalls: 0,
    lastLockPoint: null,
    setLockPoint(ex, ey, ez, tx, ty, tz) {
      this.lockActive = true; this.setLockCalls++;
      this.lastLockPoint = { ex, ey, ez, tx, ty, tz };
    },
    clearLock() { this.lockActive = false; this.clearCalls++; },
  };
}

/** `isBlockedFn(x, y) -> boolean`, default: never blocked (open outside terrain, no structures). */
function makeFakeWorld(entityList, isBlockedFn) {
  const map = new Map(entityList.map((e) => [e.id, e]));
  return {
    forEachEntity(fn) { for (const e of map.values()) fn(e); },
    get(id) { return map.has(id) ? { data: map.get(id) } : null; },
    structureAt() { return null; },
    outsideSector(x, y) {
      return { solid: !!(isBlockedFn && isBlockedFn(x, y)), floorH: -1000, ceilH: 1000 };
    },
    // test-only helpers (not part of the real World surface), used by the "removed"/"added" sub-tests below.
    _removeById(id) { map.delete(id); },
    _addEntity(e) { map.set(e.id, e); },
  };
}

function makeEvents() {
  const listeners = new Map();
  return {
    on(name, fn) {
      let s = listeners.get(name); if (!s) { s = new Set(); listeners.set(name, s); } s.add(fn);
      return () => s.delete(fn);
    },
    emit(name, payload) {
      const s = listeners.get(name); if (!s) return;
      for (const fn of Array.from(s)) fn(payload);
    },
  };
}

const DT = 1 / 60;

// ---------------------------------------------------------------------------------------------------------------
// 1. Centre-weighting beats a nearer but off-centre target.
// ---------------------------------------------------------------------------------------------------------------
{
  const player = makePlayer();
  const look = makeLook(0, 0); // facing north (-y)
  const nearOffCentre = makeTarget('offCentre', 1.5, -2.598, 0); // ~30 deg off, ~3.25 m to centre
  const farCentred = makeTarget('centre', 0, -6, 0); // dead ahead, ~6.1 m to centre
  const world = makeFakeWorld([nearOffCentre, farCentred]);
  const targeting = createTargeting(world, makeEvents(), {});

  targeting.step(DT, true, 0, player, look);
  ok('centre-weighted target wins over a nearer off-centre one', targeting.targetId === 'centre', `got ${targeting.targetId}`);
  ok('setLockPoint called on the locking step', look.setLockCalls === 1);
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Range 15 m edge (selection) and break-range 20 m edge (maintenance).
// ---------------------------------------------------------------------------------------------------------------
{
  // z chosen so eye z (1.6) - centre z cancel out (height 0): dist3D === the y distance exactly.
  const player = makePlayer();
  const look = makeLook(0, 0);
  const atRange = makeTarget('atRange', 0, -15, 1.6, { height: 0 });
  const world = makeFakeWorld([atRange]);
  const targeting = createTargeting(world, makeEvents(), {});
  targeting.step(DT, true, 0, player, look);
  ok('exactly at range 15 m locks', targeting.targetId === 'atRange');
}
{
  const player = makePlayer();
  const look = makeLook(0, 0);
  const overRange = makeTarget('overRange', 0, -15.01, 1.6, { height: 0 });
  const world = makeFakeWorld([overRange]);
  const targeting = createTargeting(world, makeEvents(), {});
  targeting.step(DT, true, 0, player, look);
  ok('just past range 15 m does not lock', targeting.targetId === null, `got ${targeting.targetId}`);
  ok('noTargetT set when nothing in range', targeting.noTargetT > 0);
}
{
  const player = makePlayer();
  const look = makeLook(0, 0);
  const target = makeTarget('tgt', 0, -10, 1.6, { height: 0 });
  const world = makeFakeWorld([target]);
  const targeting = createTargeting(world, makeEvents(), {});
  targeting.step(DT, true, 0, player, look); // lock at 10 m
  ok('locked at 10 m', targeting.targetId === 'tgt');
  target.transform.y = -20; // exactly at breakRange 20
  targeting.step(DT, false, 0, player, look);
  ok('stays locked exactly at breakRange 20 m', targeting.targetId === 'tgt');
  target.transform.y = -20.01;
  targeting.step(DT, false, 0, player, look);
  ok('breaks just past breakRange 20 m', targeting.targetId === null);
  ok('look.clearLock() called on break', look.clearCalls >= 1);
}

// ---------------------------------------------------------------------------------------------------------------
// 3. A LOS-hidden candidate is skipped at selection; a hidden lock breaks after 60 steps, not 54.
// ---------------------------------------------------------------------------------------------------------------
{
  const player = makePlayer();
  const look = makeLook(0, 0);
  // A: due north (best score), its straight path (x=0) crosses a wall at y in [-3,-2].
  const blocked = makeTarget('blockedCentre', 0, -5, 0);
  // B: off to the east, its path (x: 0->3) never enters the wall's x<0.5 band while y in [-3,-2].
  const visible = makeTarget('visibleSide', 3, -5, 0);
  const world = makeFakeWorld([blocked, visible], (x, y) => Math.abs(x) < 0.5 && y <= -2 && y >= -3);
  const targeting = createTargeting(world, makeEvents(), {});
  targeting.step(DT, true, 0, player, look);
  ok('a LOS-hidden (better-scored) candidate is skipped for a visible one', targeting.targetId === 'visibleSide',
    `got ${targeting.targetId}`);
}
{
  const player = makePlayer();
  const look = makeLook(0, 0);
  const target = makeTarget('hideable', 0, -5, 0);
  let hidden = false;
  const world = makeFakeWorld([target], () => hidden);
  const targeting = createTargeting(world, makeEvents(), {});
  targeting.step(DT, true, 0, player, look); // locks while visible (lockSteps -> 1)
  ok('locked while visible', targeting.targetId === 'hideable');
  hidden = true;
  // lockSteps goes 1 -> 2 -> ... ; LOS re-checked every losEvery(6) steps; at lockSteps 54 -> lostSteps 54 (< 60).
  for (let i = 0; i < 53; i++) targeting.step(DT, false, 0, player, look); // lockSteps now 54
  ok('still locked at step 54 (lostSteps 54 < losLostSteps 60)', targeting.targetId === 'hideable');
  for (let i = 0; i < 6; i++) targeting.step(DT, false, 0, player, look); // lockSteps now 60
  ok('breaks at step 60 (lostSteps 60 >= losLostSteps 60)', targeting.targetId === null);
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Cycle order right/left with wrap (4 mutually visible candidates at known yaw offsets from the eye).
// ---------------------------------------------------------------------------------------------------------------
function cycleFixture() {
  const player = makePlayer();
  const look = makeLook(0, 0);
  const deg = Math.PI / 180;
  const at = (yawDeg, id) => makeTarget(id, 5 * Math.sin(yawDeg * deg), -5 * Math.cos(yawDeg * deg), 0);
  const cur = at(0, 'cur');
  const p10 = at(10, 'p10');
  const p20 = at(20, 'p20');
  const n15 = at(-15, 'n15');
  const world = makeFakeWorld([cur, p10, p20, n15]);
  const targeting = createTargeting(world, makeEvents(), {});
  targeting.step(DT, true, 0, player, look); // locks 'cur' (closest to screen centre: offset 0)
  return { player, look, targeting };
}
{
  const { player, look, targeting } = cycleFixture();
  ok('cycle fixture locks cur first', targeting.targetId === 'cur');
  targeting.step(DT, false, 1, player, look); // Tab (right)
  ok('right: 0 -> +10', targeting.targetId === 'p10', `got ${targeting.targetId}`);
  targeting.step(DT, false, 1, player, look);
  ok('right: +10 -> +20', targeting.targetId === 'p20', `got ${targeting.targetId}`);
  targeting.step(DT, false, 1, player, look);
  ok('right: +20 -> -15 (wraps past 0, smallest offset)', targeting.targetId === 'n15', `got ${targeting.targetId}`);
  targeting.step(DT, false, 1, player, look);
  ok('right: -15 -> 0 (wraps back to cur)', targeting.targetId === 'cur', `got ${targeting.targetId}`);
}
{
  const { player, look, targeting } = cycleFixture();
  targeting.step(DT, false, -1, player, look); // Shift+Tab (left)
  ok('left: 0 -> -15 (only negative offset)', targeting.targetId === 'n15', `got ${targeting.targetId}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 5. A dead or removed target breaks the lock.
// ---------------------------------------------------------------------------------------------------------------
{
  const player = makePlayer();
  const look = makeLook(0, 0);
  const target = makeTarget('mortal', 0, -5, 0, { hp: 5 });
  const world = makeFakeWorld([target]);
  const targeting = createTargeting(world, makeEvents(), {});
  targeting.step(DT, true, 0, player, look);
  ok('locked onto an alive (hp>0) target', targeting.targetId === 'mortal');
  target.components.health.hp = 0;
  targeting.step(DT, false, 0, player, look);
  ok('lock breaks once hp hits 0', targeting.targetId === null);
}
{
  const player = makePlayer();
  const look = makeLook(0, 0);
  const target = makeTarget('removable', 0, -5, 0);
  const world = makeFakeWorld([target]);
  const targeting = createTargeting(world, makeEvents(), {});
  targeting.step(DT, true, 0, player, look);
  ok('locked onto a present target', targeting.targetId === 'removable');
  world._removeById('removable'); // world.get(id) now returns null, same as a real World after remove()
  targeting.step(DT, false, 0, player, look);
  ok('lock breaks once the entity is gone', targeting.targetId === null);
}

// ---------------------------------------------------------------------------------------------------------------
// 6. present(): ring+bar while locked, fading ring after a break, "no target" tick with nothing in range.
// ---------------------------------------------------------------------------------------------------------------
function makeFakeOverlay() {
  return {
    cols: 160, rows: 60,
    calls: [],
    ring(x, y, z, r, style) { this.calls.push(['ring', x, y, z, r, style]); },
    bar(x, y, z, frac, width, style, emptyStyle) { this.calls.push(['bar', x, y, z, frac, width, style, emptyStyle]); },
    rect(c0, r0, c1, r1, style) { this.calls.push(['rect', c0, r0, c1, r1, style]); },
  };
}
const IDS = { target: 1, targetFade: 2, targetNone: 3, targetBarFill: 4, targetBarEmpty: 5 };
{
  const player = makePlayer();
  const look = makeLook(0, 0);
  const target = makeTarget('presented', 0, -5, 0, { hp: 6 });
  target.components.health.max = 10;
  const world = makeFakeWorld([target]);
  const targeting = createTargeting(world, makeEvents(), {});
  targeting.step(DT, true, 0, player, look);
  const overlay = makeFakeOverlay();
  targeting.present(overlay, IDS);
  const ringCall = overlay.calls.find((c) => c[0] === 'ring');
  const barCall = overlay.calls.find((c) => c[0] === 'bar');
  ok('present() draws a ring at the target with style ids.target', !!ringCall && ringCall[5] === IDS.target);
  ok('present() ring radius = target radius + 0.2', !!ringCall && Math.abs(ringCall[4] - 0.65) < 1e-9, String(ringCall && ringCall[4]));
  ok('present() draws an hp bar at 0.6 frac (6/10)', !!barCall && Math.abs(barCall[4] - 0.6) < 1e-9);

  target.transform.y = -30; // past breakRange -> breaks + starts the fade
  targeting.step(DT, false, 0, player, look);
  const overlay2 = makeFakeOverlay();
  targeting.present(overlay2, IDS);
  const fadeCall = overlay2.calls.find((c) => c[0] === 'ring' && c[5] === IDS.targetFade);
  ok('present() draws the fading ring with ids.targetFade right after a break', !!fadeCall);
}
{
  const player = makePlayer();
  const look = makeLook(0, 0);
  const world = makeFakeWorld([]); // nothing to target at all
  const targeting = createTargeting(world, makeEvents(), {});
  targeting.step(DT, true, 0, player, look);
  ok('noTargetT set with no candidates', targeting.noTargetT > 0);
  const overlay = makeFakeOverlay();
  targeting.present(overlay, IDS);
  const rects = overlay.calls.filter((c) => c[0] === 'rect');
  ok('present() draws two 1-cell rects at crosshair +-2 cols', rects.length === 2);
  ok('both rects use ids.targetNone', rects.every((c) => c[5] === IDS.targetNone));
  ok('rects straddle the crosshair column', rects[0][1] === 78 && rects[1][1] === 82, JSON.stringify(rects));
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Q while locked unlocks (toggle) - and starts the fade.
// ---------------------------------------------------------------------------------------------------------------
{
  const player = makePlayer();
  const look = makeLook(0, 0);
  const target = makeTarget('toggle', 0, -5, 0);
  const world = makeFakeWorld([target]);
  const targeting = createTargeting(world, makeEvents(), {});
  targeting.step(DT, true, 0, player, look);
  ok('locked', targeting.locked === true);
  targeting.step(DT, true, 0, player, look); // Q again
  ok('Q while locked toggles the lock off', targeting.locked === false);
  ok('fade starts on a manual unlock too', targeting.fadeT > 0);
}

// ---------------------------------------------------------------------------------------------------------------
// 8. clear() (US-080a1 respawn hook): drops the lock immediately, no fade, releases `look`.
// ---------------------------------------------------------------------------------------------------------------
{
  const player = makePlayer();
  const look = makeLook(0, 0);
  const target = makeTarget('respawnDrop', 0, -5, 0);
  const world = makeFakeWorld([target]);
  const targeting = createTargeting(world, makeEvents(), {});
  targeting.step(DT, true, 0, player, look);
  ok('locked before clear()', targeting.locked === true);
  targeting.clear();
  ok('clear() drops the lock', targeting.locked === false);
  ok('clear() leaves no fade behind', targeting.fadeT === 0);
  ok('clear() releases the look lock', look.lockActive === false);
}

// ---------------------------------------------------------------------------------------------------------------
// 9. entity:added/entity:removed rebuild the candidate list (never per step).
// ---------------------------------------------------------------------------------------------------------------
{
  const player = makePlayer();
  const look = makeLook(0, 0);
  const world = makeFakeWorld([]);
  const events = makeEvents();
  const targeting = createTargeting(world, events, {});
  targeting.step(DT, true, 0, player, look);
  ok('no candidates yet -> no lock', targeting.targetId === null);

  const late = makeTarget('lateAdd', 0, -5, 0);
  world._addEntity(late); // simulate the entity now existing in the world
  events.emit('entity:added', { id: 'lateAdd' });
  targeting.step(DT, true, 0, player, look);
  ok('entity:added rebuilds the candidate list', targeting.targetId === 'lateAdd');

  world._removeById('lateAdd'); // simulate removal
  events.emit('entity:removed', { id: 'lateAdd' });
  targeting.step(DT, true, 0, player, look); // Q while locked -> unlock (toggle), not a reselect
  targeting.step(DT, true, 0, player, look); // Q again, now unlocked -> tries to select, nothing left
  ok('entity:removed rebuilds the candidate list (nothing left to select)', targeting.targetId === null);
}

// ---------------------------------------------------------------------------------------------------------------
// 10. Perf: selection query over 16 entities <= 0.05 ms, zero allocation over 10k steps (warn-only unless
//     PERF_STRICT=1, same convention as beastSim.test.js/sword.test.js).
// ---------------------------------------------------------------------------------------------------------------
{
  const player = makePlayer();
  const look = makeLook(0, 0);
  const deg = Math.PI / 180;
  const targets = [];
  for (let k = 0; k < 16; k++) {
    const yawDeg = -35 + k * 4; // spread across the hfov (75 deg -> +-37.5)
    const dist = 4 + (k % 5);
    targets.push(makeTarget(`perf${k}`, dist * Math.sin(yawDeg * deg), -dist * Math.cos(yawDeg * deg), 0));
  }
  const world = makeFakeWorld(targets);
  const targeting = createTargeting(world, makeEvents(), {});

  const N = 2000;
  const times = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint();
    targeting.step(DT, true, 0, player, look);  // select (locks)
    targeting.step(DT, true, 0, player, look);  // Q again -> unlock
    const t1 = process.hrtime.bigint();
    times[i] = Number(t1 - t0) / 1e6 / 2; // per selection-ish call pair, halved
  }
  const sorted = Array.from(times).sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / N;
  const p95 = sorted[Math.floor(N * 0.95)];
  const strict = process.env.PERF_STRICT === '1';
  const okMean = mean <= 0.05;
  if (!okMean) console.warn(`[perf] targeting step mean=${mean.toFixed(4)}ms (budget 0.05ms) p95=${p95.toFixed(4)}ms`);
  ok('perf: 16-entity selection mean within budget (or PERF_STRICT unset)', strict ? okMean : true, `mean=${mean}`);

  if (global.gc) {
    const heapBefore = process.memoryUsage().heapUsed;
    for (let i = 0; i < 10000; i++) {
      targeting.step(DT, true, 0, player, look);
      targeting.step(DT, true, 0, player, look);
    }
    global.gc();
    const heapAfter = process.memoryUsage().heapUsed;
    ok('zero allocation over 10k steps (--expose-gc heap check)', heapAfter <= heapBefore + 1e6,
      `before=${heapBefore} after=${heapAfter}`);
  } else {
    console.log('(skip) zero-allocation heap check needs --expose-gc');
  }
}

// ---------------------------------------------------------------------------------------------------------------
console.log(`targeting.test.js: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const m of failures) console.log(`  FAIL: ${m}`);
  process.exitCode = 1;
}
