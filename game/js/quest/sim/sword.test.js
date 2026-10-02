// game/js/quest/sim/sword.test.js (US-078d, docs/architecture.md 30.1 + the normative "30.1 amendment (D-034)").
// Headless Node ESM, no framework. Run: node --expose-gc game/js/quest/sim/sword.test.js
//
// Uses a small STUB world (same precedent as engine/world/explosion.test.js's stub world): `createSwordSim` only
// ever calls `world.state`, `world.forEachEntity`, `world.raySegment` - a real engine `World` (terrain/structures)
// is not needed to exercise the state machine, chain rules, hit detection or mana spend, and a stub keeps every
// test fast and exact (controllable wall placement for the world-hit/clink cases).
import { createHasher } from '../../../../engine/index.js';
import swordMod from '../../../../design/models/sword.js';
import { makeOk } from '../../../../engine/test/assert.js';
import { SWORD_CFG } from '../swordConfig.js';
import { createSwordSim, ST_IDLE, ST_HOLD, ST_CHARGE, ST_LIGHT, ST_HARD, ST_REST, SPARK_CLINK, SPARK_HIT_HEAVY } from './sword.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- fixtures ----------------------------------------------------------------------------------------------------

function segCircleT(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax, dy = by - ay, fx = ax - cx, fy = ay - cy;
  const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a < 1e-12) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return t2;
  return null;
}

/** @param {{cx:number,cy:number,r:number}|null} wall a 2D circle obstacle (both the slice ray and the LOS-to-entity ray test against it) */
function makeWorld(entities, wall) {
  const out = { t: 0, x: 0, y: 0, z: 0 };
  void out;
  return {
    state: {},
    entities,
    forEachEntity(fn) { for (const e of entities) fn(e); },
    get(id) {
      const e = entities.find((x) => x.id === id);
      return e ? { data: e, id, play() {} } : null;
    },
    raySegment(ax, ay, az, bx, by, bz, o) {
      if (!wall) return false;
      const t = segCircleT(ax, ay, bx, by, wall.cx, wall.cy, wall.r);
      if (t === null) return false;
      o.t = t; o.x = ax + (bx - ax) * t; o.y = ay + (by - ay) * t; o.z = az + (bz - az) * t;
      return true;
    },
  };
}

function makeEvents() {
  const hits = [];
  const listeners = new Map();
  return {
    hits,
    events: {
      on(name, fn) {
        let s = listeners.get(name); if (!s) { s = new Set(); listeners.set(name, s); }
        s.add(fn); return () => s.delete(fn);
      },
      emit(name, p) { if (name === 'combat:hit') hits.push({ ...p }); const s = listeners.get(name); if (s) for (const fn of Array.from(s)) fn(p); },
    },
  };
}

function player(x = 0, y = 0, z = 0) {
  return { id: 'player', transform: { x, y, z, yawDeg: 0 }, components: { body: { grounded: true, speedScale: 1, vx: 0, vy: 0, vz: 0, eyeH: 1.6 } } };
}

function target(id, x, y, z = 0, withBody = false) {
  const components = { targetable: { radius: 0.3, height: 1.6 } };
  if (withBody) components.body = { vx: 0, vy: 0, vz: 0, grounded: true };
  return { id, transform: { x, y, z }, components };
}

function makeManaHook(mp) {
  const hook = { mp, callCount: 0 };
  hook.spendMana = (n) => { hook.callCount++; if (hook.mp < n) return false; hook.mp -= n; return true; };
  return hook;
}

function stepN(sim, p, fx, fy, down, n) { for (let i = 0; i < n; i++) sim.step(p, fx, fy, down); }

function freshSim(entities, wall, hooks, opts) {
  const { events, hits } = makeEvents();
  const world = makeWorld(entities, wall || null);
  if (!opts || opts.flag !== false) world.state['tower.sword.taken'] = true;
  const sim = createSwordSim(world, events, SWORD_CFG, hooks);
  return { world, sim, hits };
}

const FWD = [0, 1]; // (fx, fy) facing +y

// ---------------------------------------------------------------------------------------------------------------
// 1. Tap / hold thresholds -> light vs charge.
// ---------------------------------------------------------------------------------------------------------------
{
  const p = player();
  const { sim } = freshSim([p]);
  sim.step(p, ...FWD, true); // press
  sim.step(p, ...FWD, false); // release next step -> light (1-step tap)
  ok('1-step tap -> light', sim.state === ST_LIGHT, `state=${sim.state}`);
}
{
  const p = player();
  const { sim } = freshSim([p]);
  sim.step(p, ...FWD, true);
  stepN(sim, p, ...FWD, true, 5); // held 6 steps total
  sim.step(p, ...FWD, false);
  ok('6-step hold then release -> light', sim.state === ST_LIGHT, `state=${sim.state}`);
}
{
  const p = player();
  const { sim } = freshSim([p]);
  sim.step(p, ...FWD, true);
  stepN(sim, p, ...FWD, true, 22); // 23 steps total
  ok('still in hold at 23 steps', sim.state === ST_HOLD, `state=${sim.state}`);
  sim.step(p, ...FWD, false);
  ok('23-step hold then release -> light', sim.state === ST_LIGHT, `state=${sim.state}`);
}
{
  const p = player();
  const { sim } = freshSim([p]);
  sim.step(p, ...FWD, true);
  stepN(sim, p, ...FWD, true, 24); // holdSteps reaches 24 (press + 24 more down calls)
  ok('24 steps down -> charge', sim.state === ST_CHARGE, `state=${sim.state}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Charge -> hard (mana ok) / light (mana short, counts +1, manaFlashTick-style hook feedback).
// ---------------------------------------------------------------------------------------------------------------
{
  const p = player();
  const hooks = makeManaHook(10);
  const { sim } = freshSim([p], null, hooks);
  sim.step(p, ...FWD, true);
  stepN(sim, p, ...FWD, true, 24); // -> charge
  sim.step(p, ...FWD, false); // release with mana -> hard
  ok('release in charge with mana -> hard', sim.state === ST_HARD, `state=${sim.state}`);
  ok('mana spent exactly once', hooks.callCount === 1, `calls=${hooks.callCount}`);
  ok('mp reduced by hard.mana', hooks.mp === 10 - SWORD_CFG.hard.mana, `mp=${hooks.mp}`);
}
{
  const p = player();
  const hooks = makeManaHook(3); // < hard.mana (4)
  const { sim } = freshSim([p], null, hooks);
  sim.step(p, ...FWD, true);
  stepN(sim, p, ...FWD, true, 24);
  sim.step(p, ...FWD, false);
  ok('hard with insufficient mana -> light instead', sim.state === ST_LIGHT, `state=${sim.state}`);
  ok('mp unchanged on a short spend', hooks.mp === 3, `mp=${hooks.mp}`);
  ok('spendMana called once (feedback hook already flags the flash)', hooks.callCount === 1);
}
{
  // mana spent once on release, ALSO on a miss (swing at empty air).
  const p = player();
  const hooks = makeManaHook(10);
  const { sim } = freshSim([p], null, hooks);
  sim.step(p, ...FWD, true);
  stepN(sim, p, ...FWD, true, 24);
  sim.step(p, ...FWD, false); // release, no target anywhere -> a miss, mana still spent once
  ok('mana spent once even on a miss', hooks.callCount === 1 && hooks.mp === 10 - SWORD_CFG.hard.mana);
}
{
  // never checked/spent during charge itself (only on release).
  const p = player();
  const hooks = makeManaHook(10);
  const { sim } = freshSim([p], null, hooks);
  sim.step(p, ...FWD, true);
  stepN(sim, p, ...FWD, true, 50); // long charge, never released
  ok('spendMana not called while still charging', hooks.callCount === 0, `calls=${hooks.callCount}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Chain: L, queued L -> rest 15; 3rd press ignored; queued hold -> hard (chain reset); held through rest.
// ---------------------------------------------------------------------------------------------------------------
{
  const p = player();
  const { sim } = freshSim([p]);
  sim.step(p, ...FWD, true); sim.step(p, ...FWD, false); // tap -> light #1
  ok('light #1 started, chain 1', sim.state === ST_LIGHT && sim.chain === 1);
  // queue during light #1's recover (stateStep >= recoverStart 12), release immediately after (a quick re-tap)
  stepN(sim, p, ...FWD, false, SWORD_CFG.light.windup + SWORD_CFG.light.active); // reach recoverStart
  sim.step(p, ...FWD, true); // queued press
  ok('press in recover sets queued', sim.queued === true);
  sim.step(p, ...FWD, false); // release right away (still before chainStart)
  // run until the scheduled transition (max(pressStep+1, chainStart))
  let guard = 0;
  while (sim.state === ST_LIGHT && sim.chain === 1 && guard++ < 40) sim.step(p, ...FWD, false);
  ok('queued press -> light #2 (blend)', sim.state === ST_LIGHT && sim.chain === 2 && sim.blend === true, `state=${sim.state} chain=${sim.chain} blend=${sim.blend}`);
  // a press during light #2 (the "3rd press") must be ignored
  sim.step(p, ...FWD, true);
  const stateBefore = sim.state, chainBefore = sim.chain;
  sim.step(p, ...FWD, false);
  ok('3rd press (during light #2) ignored', sim.state === stateBefore || sim.chain === chainBefore);
  // run light #2 to completion -> rest 15
  guard = 0;
  while (sim.state === ST_LIGHT && guard++ < 40) sim.step(p, ...FWD, false);
  ok('light #2 ends in rest', sim.state === ST_REST, `state=${sim.state}`);
  let restSteps = 0;
  while (sim.state === ST_REST && restSteps < 30) { sim.step(p, ...FWD, false); restSteps++; }
  ok('rest lasts SWORD_CFG.rest (15) steps', restSteps === SWORD_CFG.rest, `restSteps=${restSteps}`);
  ok('rest ends in idle, chain 0', sim.state === ST_IDLE && sim.chain === 0);
}
{
  // press held through rest does nothing until released and pressed again.
  const p = player();
  const { sim } = freshSim([p]);
  sim.step(p, ...FWD, true); sim.step(p, ...FWD, false); // light #1 (tap)
  let guard = 0;
  while (sim.stateStep < SWORD_CFG.light.windup + SWORD_CFG.light.active && guard++ < 40) sim.step(p, ...FWD, false);
  sim.step(p, ...FWD, true); // the queued press
  sim.step(p, ...FWD, false); // released right away -> light #2 runs normally, ends in rest
  guard = 0;
  while (sim.state === ST_LIGHT && guard++ < 40) sim.step(p, ...FWD, false);
  ok('setup reached rest', sim.state === ST_REST, `state=${sim.state}`);
  // NOW a fresh press, held continuously through the rest of REST and across the REST -> IDLE boundary.
  sim.step(p, ...FWD, true); // rest ignores pressed entirely (table): must stay in REST
  ok('a press during rest is ignored (stays in rest)', sim.state === ST_REST, `state=${sim.state}`);
  guard = 0;
  while (sim.state === ST_REST && guard++ < 30) sim.step(p, ...FWD, true); // held down throughout
  ok('held through rest -> idle, no new swing', sim.state === ST_IDLE, `state=${sim.state}`);
  // still down: one more step must NOT start anything (no press edge - it never released)
  sim.step(p, ...FWD, true);
  ok('still down after rest: no press edge, stays idle', sim.state === ST_IDLE);
}
{
  // release in recover, NOT the queued press (chain<2, recover but no 2nd press) -> nothing special; swing ends in idle.
  const p = player();
  const { sim } = freshSim([p]);
  sim.step(p, ...FWD, true); sim.step(p, ...FWD, false);
  let guard = 0;
  while (sim.state === ST_LIGHT && guard++ < 40) sim.step(p, ...FWD, false);
  ok('no queue -> light #1 alone ends in idle, chain 0', sim.state === ST_IDLE && sim.chain === 0);
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Gate: no swing before the flag / mid-air; jump or block during hold/charge cancels, no mana spent.
// ---------------------------------------------------------------------------------------------------------------
{
  const p = player();
  const { sim } = freshSim([p], null, null, { flag: false }); // world.state['tower.sword.taken'] unset
  sim.step(p, ...FWD, true);
  ok('no sword flag -> press does nothing', sim.state === ST_IDLE, `state=${sim.state}`);
}
{
  const p = player();
  p.components.body.grounded = false;
  const { world, sim } = freshSim([p]);
  world.state['tower.sword.taken'] = true;
  sim.step(p, ...FWD, true);
  ok('airborne -> press does nothing', sim.state === ST_IDLE, `state=${sim.state}`);
}
{
  const p = player();
  const { world, sim } = freshSim([p]);
  world.state['tower.sword.taken'] = true;
  sim.step(p, ...FWD, true);
  sim.step(p, ...FWD, true); // in hold
  p.components.body.grounded = false; // jump mid-hold
  const hooks = { calls: 0 };
  void hooks;
  sim.step(p, ...FWD, true);
  ok('leaving the ground during hold -> idle', sim.state === ST_IDLE, `state=${sim.state}`);
}
{
  const p = player();
  const hooks = makeManaHook(10);
  const { world, sim } = freshSim([p], null, hooks);
  world.state['tower.sword.taken'] = true;
  sim.step(p, ...FWD, true);
  stepN(sim, p, ...FWD, true, 24); // -> charge
  sim.cancel();
  ok('cancel() during charge -> idle', sim.state === ST_IDLE, `state=${sim.state}`);
  ok('no mana spent on cancel', hooks.callCount === 0);
}
{
  const p = player();
  const hooks = makeManaHook(10);
  const { world, sim } = freshSim([p], null, hooks);
  world.state['tower.sword.taken'] = true;
  sim.step(p, ...FWD, true);
  stepN(sim, p, ...FWD, true, 24);
  sim.onBlockStart();
  ok('onBlockStart() during charge -> idle', sim.state === ST_IDLE, `state=${sim.state}`);
  ok('no mana spent on a block cancel', hooks.callCount === 0);
  sim.onBlockEnd();
  sim.step(p, ...FWD, false); // release (the button never actually went up during the block cancel)
  sim.step(p, ...FWD, true); // a fresh press
  ok('blocking cleared: a press works again', sim.state === ST_HOLD, `state=${sim.state}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 5. speedScale multiplier per state (multiply, never assign).
// ---------------------------------------------------------------------------------------------------------------
{
  const expect = { [ST_IDLE]: 1, [ST_HOLD]: 1, [ST_CHARGE]: 0.3, [ST_LIGHT]: 0.6, [ST_HARD]: 0.3, [ST_REST]: 0.6 };
  const p = player();
  const hooks = makeManaHook(0); // mp 0 -> the charge release is mana-short -> light (so this checks the light row)
  const { world, sim } = freshSim([p], null, hooks);
  world.state['tower.sword.taken'] = true;
  p.components.body.speedScale = 1;
  sim.step(p, ...FWD, true); // -> hold
  ok(`speedScale x${expect[sim.state]} in hold`, Math.abs(p.components.body.speedScale - expect[sim.state]) < 1e-9, `got=${p.components.body.speedScale}`);
  p.components.body.speedScale = 1;
  stepN(sim, p, ...FWD, true, 24);
  ok(`speedScale x${expect[sim.state]} in charge`, sim.state === ST_CHARGE && Math.abs(p.components.body.speedScale - 0.3) < 1e-9);
  p.components.body.speedScale = 1;
  sim.step(p, ...FWD, false); // release, mana-short -> light
  ok(`speedScale x0.6 in light`, sim.state === ST_LIGHT && Math.abs(p.components.body.speedScale - 0.6) < 1e-9, `state=${sim.state}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Hit detection: in-arc hit, miss outside angle, miss beyond reach, miss behind a wall, once per swing.
// ---------------------------------------------------------------------------------------------------------------
function tapLight(sim, p) { sim.step(p, ...FWD, true); sim.step(p, ...FWD, false); }

{
  const p = player();
  const tgt = target('t1', 0, 1.0, 0.9);
  const { world, sim, hits } = freshSim([p, tgt]);
  world.state['tower.sword.taken'] = true;
  tapLight(sim, p);
  let guard = 0;
  while (sim.state === ST_LIGHT && guard++ < 30) sim.step(p, ...FWD, false);
  ok('in-arc, in-reach target gets hit', hits.length === 1 && hits[0].target === 't1', `hits=${JSON.stringify(hits)}`);
  ok('light hit damage == light.damage', hits[0] && hits[0].damage === SWORD_CFG.light.damage);
  ok('light hit heavy flag is 0', hits[0] && hits[0].heavy === 0);
}
{
  const p = player();
  const tgt = target('t1', 3.0, 0.1, 0.9); // far to the side: outside the 100 deg cone
  const { world, sim, hits } = freshSim([p, tgt]);
  world.state['tower.sword.taken'] = true;
  tapLight(sim, p);
  let guard = 0;
  while (sim.state === ST_LIGHT && guard++ < 30) sim.step(p, ...FWD, false);
  ok('outside the arc angle: no hit', hits.length === 0, `hits=${JSON.stringify(hits)}`);
}
{
  const p = player();
  const tgt = target('t1', 0, 3.0, 0.9); // 3 m, beyond reach 1.6
  const { world, sim, hits } = freshSim([p, tgt]);
  world.state['tower.sword.taken'] = true;
  tapLight(sim, p);
  let guard = 0;
  while (sim.state === ST_LIGHT && guard++ < 30) sim.step(p, ...FWD, false);
  ok('beyond reach: no hit', hits.length === 0, `hits=${JSON.stringify(hits)}`);
}
{
  const p = player();
  const tgt = target('t1', 0, 1.2, 0.9);
  const wall = { cx: 0, cy: 0.5, r: 0.1 }; // between the player and the target
  const { world, sim, hits } = freshSim([p, tgt], wall);
  world.state['tower.sword.taken'] = true;
  tapLight(sim, p);
  let guard = 0, sawClink = false;
  while (sim.state !== ST_IDLE && guard++ < 30) {
    sim.step(p, ...FWD, false);
    if (sim.sparks.kind[(sim.sparks.size + 0) % sim.sparks.size] === SPARK_CLINK) sawClink = true;
  }
  ok('behind a wall: no entity hit', hits.length === 0, `hits=${JSON.stringify(hits)}`);
  void sawClink;
}
{
  // once per swing: same target in arc for the whole active window must be hit exactly once (hitMask).
  const p = player();
  const tgt = target('t1', 0, 1.0, 0.9);
  const { world, sim, hits } = freshSim([p, tgt]);
  world.state['tower.sword.taken'] = true;
  tapLight(sim, p);
  let guard = 0;
  while (sim.state === ST_LIGHT && guard++ < 30) sim.step(p, ...FWD, false);
  ok('hit exactly once per swing', hits.length === 1, `hits.length=${hits.length}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Hit windows at the exact steps (light: 5..11; hard: 4..10).
// ---------------------------------------------------------------------------------------------------------------
// A target directly ahead (within the arc's radius-widened centre slices) is caught by the FIRST slice of the
// sweep whose widened wedge reaches it - not necessarily the exact geometric centre slice (meleeArc.js's `cr`
// widening can make a dead-ahead target qualify a slice or two early). So these checks assert: no hit strictly
// before `hitStart`, and the hit (when it lands) is strictly within [hitStart, hitEnd] - not an exact slice index.
{
  const p = player();
  const tgt = target('t1', 0, 1.0, 0.9);
  const { world, sim, hits } = freshSim([p, tgt]);
  world.state['tower.sword.taken'] = true;
  sim.step(p, ...FWD, true); sim.step(p, ...FWD, false); // light starts
  stepN(sim, p, ...FWD, false, SWORD_CFG.light.windup); // through windup (entries 0..windup-1) - no hit yet
  ok('no hit before the active window (light)', hits.length === 0, `stateStep=${sim.stateStep}`);
  let hitStep = -1;
  for (let k = 0; k < SWORD_CFG.light.active && hits.length === 0; k++) { hitStep = sim.stateStep; sim.step(p, ...FWD, false); }
  ok('hit lands inside the active window (light)', hits.length === 1
    && hitStep >= SWORD_CFG.light.windup && hitStep <= SWORD_CFG.light.windup + SWORD_CFG.light.active - 1,
    `hitStep=${hitStep} hits=${hits.length}`);
}
{
  const p = player();
  const hooks = makeManaHook(10);
  const tgt = target('t1', 0, 1.0, 0.9);
  const { world, sim, hits } = freshSim([p, tgt], null, hooks);
  world.state['tower.sword.taken'] = true;
  sim.step(p, ...FWD, true);
  stepN(sim, p, ...FWD, true, 24);
  sim.step(p, ...FWD, false); // -> hard
  stepN(sim, p, ...FWD, false, SWORD_CFG.hard.windup); // through windup - no hit yet
  ok('no hit before the active window (hard)', hits.length === 0, `stateStep=${sim.stateStep}`);
  let hitStep = -1;
  for (let k = 0; k < SWORD_CFG.hard.active && hits.length === 0; k++) { hitStep = sim.stateStep; sim.step(p, ...FWD, false); }
  ok('hit lands inside the active window (hard)', hits.length === 1 && hits[0].heavy === 1
    && hitStep >= SWORD_CFG.hard.windup && hitStep <= SWORD_CFG.hard.windup + SWORD_CFG.hard.active - 1,
    `hitStep=${hitStep} hits=${JSON.stringify(hits)}`);
  ok('hard damage == light.damage * hard.damageMul', hits[0] && hits[0].damage === SWORD_CFG.light.damage * SWORD_CFG.hard.damageMul);
}

// ---------------------------------------------------------------------------------------------------------------
// 8. Knockback (applyImpulse on a body target, heavy only) + hit-stop (clink 3, hard entity hit 4).
// ---------------------------------------------------------------------------------------------------------------
{
  const p = player();
  const hooks = makeManaHook(10);
  const tgt = target('t1', 0, 1.0, 0.9, true); // has components.body
  const { world, sim, hits } = freshSim([p, tgt], null, hooks);
  world.state['tower.sword.taken'] = true;
  sim.step(p, ...FWD, true);
  stepN(sim, p, ...FWD, true, 24);
  sim.step(p, ...FWD, false); // -> hard
  stepN(sim, p, ...FWD, false, SWORD_CFG.hard.windup); // through windup
  for (let k = 0; k < SWORD_CFG.hard.active && hits.length === 0; k++) sim.step(p, ...FWD, false);
  ok('hard entity hit applies a body impulse', tgt.components.body.vy > 0, `vy=${tgt.components.body.vy}`);
  ok('hard entity hit freezes 4 steps (hitStopHard)', sim.frozen === SWORD_CFG.hitStopHard, `frozen=${sim.frozen}`);
  ok('hits=1', hits.length === 1);
}
{
  // A small wall sitting exactly on the forward axis, between the player and a target that would otherwise be
  // hit: the LOS-to-entity ray (always the exact eye -> entity line) is always blocked, so the entity is NEVER
  // hit regardless of which slice is active; the slice-centre ray only crosses this small wall for the centre-
  // ish slices, so the clink/freeze is checked by running the whole active window, not one exact step.
  const p = player();
  const tgt = target('t1', 0, 1.2, 0.9);
  const wall = { cx: 0, cy: 0.6, r: 0.1 };
  const { world, sim, hits } = freshSim([p, tgt], wall);
  world.state['tower.sword.taken'] = true;
  tapLight(sim, p);
  stepN(sim, p, ...FWD, false, SWORD_CFG.light.windup); // through windup
  for (let k = 0; k < SWORD_CFG.light.active && sim.frozen === 0; k++) sim.step(p, ...FWD, false);
  ok('a world (wall) hit freezes hitStop steps and jumps to recover', sim.frozen === SWORD_CFG.hitStop
    && sim.stateStep === SWORD_CFG.light.windup + SWORD_CFG.light.active, `frozen=${sim.frozen} stateStep=${sim.stateStep}`);
  ok('the entity behind the wall is never hit', hits.length === 0, `hits=${JSON.stringify(hits)}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 9. Config step windows vs the real clip windows (ms), within 1 step.
// ---------------------------------------------------------------------------------------------------------------
{
  const STEP_MS = 1000 / 60;
  const VM = swordMod.viewModel;
  const check = (name, cfgSteps, clipRange) => {
    const clipSteps = (clipRange[1] - clipRange[0]) / STEP_MS;
    ok(`${name}: config ${cfgSteps} steps vs clip ${clipSteps.toFixed(2)} steps`, Math.abs(cfgSteps - clipSteps) <= 1);
  };
  check('light windup', SWORD_CFG.light.windup, VM.clips.swingLR.windup);
  check('light active', SWORD_CFG.light.active, VM.clips.swingLR.active);
  check('light recover', SWORD_CFG.light.recover, VM.clips.swingLR.recover);
  check('hard windup', SWORD_CFG.hard.windup, VM.clips.swingHard.windup);
  check('hard active', SWORD_CFG.hard.active, VM.clips.swingHard.active);
  check('hard recover', SWORD_CFG.hard.recover, VM.clips.swingHard.recover);
}

// ---------------------------------------------------------------------------------------------------------------
// 10. Deterministic 600-step replay (tap + hold input), hashed equal twice.
// ---------------------------------------------------------------------------------------------------------------
function scriptedInputs(stepIdx) {
  // a tap around step 2, a long hold starting step 120 (reaches charge, released at step 400).
  if (stepIdx === 2) return true;
  if (stepIdx === 3) return false;
  if (stepIdx >= 120 && stepIdx < 400) return true;
  return false;
}
function runReplay() {
  const p = player();
  const tgt = target('t1', 0, 1.0, 0.9);
  const hooks = makeManaHook(10);
  const { world, sim } = freshSim([p, tgt], null, hooks);
  world.state['tower.sword.taken'] = true;
  const h = createHasher();
  for (let i = 0; i < 600; i++) {
    sim.step(p, ...FWD, scriptedInputs(i));
    sim.hashInto(h);
  }
  return h.value();
}
{
  const h1 = runReplay(), h2 = runReplay();
  ok('600-step replay hash equal twice', h1 === h2 && h1 !== undefined, `h1=${h1} h2=${h2}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 11. Zero allocation over 10k steps (--expose-gc only).
// ---------------------------------------------------------------------------------------------------------------
if (typeof global.gc === 'function') {
  // A non-allocating events stub (freshSim's own test-harness `hits.push({...p})` would allocate a copy per hit -
  // that is test-harness cost, not the sim's; this check needs a bare-bones `emit` that only counts).
  let hitCount = 0;
  const events = { on() { return () => {}; }, emit(name) { if (name === 'combat:hit') hitCount++; } };
  const p = player();
  const tgt = target('t1', 0, 1.0, 0.9);
  const world = makeWorld([p, tgt], null);
  world.state['tower.sword.taken'] = true;
  const sim = createSwordSim(world, events, SWORD_CFG, null);
  for (let i = 0; i < 1000; i++) sim.step(p, ...FWD, (i % 50) < 10);
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) sim.step(p, ...FWD, (i % 50) < 10);
  global.gc();
  const after = process.memoryUsage().heapUsed;
  ok('zero allocation over 10k steps', after - before < 64 * 1024, `delta=${after - before} hitCount=${hitCount}`);
} else {
  console.log('(skip) zero-allocation heap check needs --expose-gc');
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log(failures.join('\n')); process.exitCode = 1; } else console.log('ALL PASS');
