// game/js/quest/handFireView.js (HAND-WIRE-01). The realistic first-person casting hand (design/models/hand.js, README 22) with
// its ALWAYS-ON fire, as one view-model handle. Replaces the spell glove (spellHandView.js) when the hand asset is loaded.
// Presentation only, driven by the fireball sim: idle = `fireIdle`; press -> `charge` (400 ms) then `chargeHold`; release that
// cast -> `fireCast` from 300 ms (the fling); release/cancel without a cast -> `chargeOut`. Each clip key names the model variant
// to show (`k.v`, '@cycle' = flicker frames from simTime); the variant is swapped with vm.setVariant. Returns the carried-light
// glow multiplier (def.glow). No allocation per frame after `loadHandFireView`.
import { FB_IDLE } from './sim/fireball.js';

export const HAND_FIRE_ITEM = 'spell.fireball';

const STEP_MS = 1000 / 60;
const K_IDLE = 0, K_CHARGE = 1, K_HOLD = 2, K_CAST = 3, K_OUT = 4;
const CAST_FROM_MS = 300; // fireCast: charge part [0,300] is skipped (the real charge happened on press)
const TAP_RAMP_MS = 100;  // quick tap (charged < 300 ms): fireCast starts at the matching charge pose and catches up to 300 ms in <= this long
const FLAME_MIN_DEPTH = 0.72; // sprite near cull is 0.6 m (engine/render/sprites.js SPRITE_NEAR_DEPTH)
const ROLES = ['idle', 'charge', 'hold', 'cast', 'out'];

/** Clip state machine memory (one for the render frames, one for the sim-step particles; both read the same sim). */
function newClock() { return { prevState: FB_IDLE, prevCastTick: -1, outTick: -1e9, holdMs: 0, kind: K_IDLE, role: 'idle', tMs: 0, bob: 0 }; }

/** Resolves handles/clips/variants once (boot). `def` = ASSETS.viewModels.hand; every variant model must be in `pool`. */
export function loadHandFireView(vm, def, pool) {
  const h = vm.load('hand', def, pool);
  vm.setHand(h, 'left');
  vm.hide(h);
  const ao = def.alwaysOn || {};
  const clipOf = (role, fallback) => ao[role] || fallback;
  const names = { idle: clipOf('idle', 'idle'), charge: clipOf('charge', 'charge'), hold: clipOf('chargeHold', 'chargeHold'),
                  cast: clipOf('cast', 'cast'), out: clipOf('chargeOut', 'chargeOut') };
  const clip = {}, dur = {}, keyV = {}, keyT = {}, glowOf = {};
  for (const role of Object.keys(names)) {
    const n = names[role], c = def.clips[n];
    clip[role] = vm.clipId(h, n);
    const keys = c.keys;
    dur[role] = keys[keys.length - 1].t;
    // per key: variant id (-1 = cycle start marker handled below) - precomputed so the frame loop does no string work
    keyT[role] = keys.map((k) => k.t);
    keyV[role] = keys.map((k) => (k.v === undefined ? null : k.v));
    glowOf[role] = def.glow[n];
  }
  // variant id table: plain names -> index; cycles -> arrays of indices + fps
  const vid = (n) => vm.variantId(h, n);
  const cycles = {};
  for (const cn of Object.keys(def.cycles || {})) cycles['@' + cn] = { ids: def.cycles[cn].variants.map(vid), fps: def.cycles[cn].fps };
  const plain = {};
  for (const role of Object.keys(keyV)) for (const v of keyV[role]) if (v && v[0] !== '@' && plain[v] === undefined) plain[v] = vid(v);
  const defaultId = vid(def.defaultVariant || 'open');
  return { vm, h, def, clip, dur, keyT, keyV, glowOf, cycles, plain, defaultId, cap: def.glowCap || 9,
           kind: K_IDLE, clock: newClock(), fxClock: newClock(), names, fx: null, glow: 1, variant: defaultId,
           flame: { on: false, x: 0, y: 0, z: 0, charged: false, t: 0 } };
}

/** Variant shown at clip time t: the last key (<= t) carrying `v`, else the default. */
function variantAt(vmh, role, t, simTime) {
  const kt = vmh.keyT[role], kv = vmh.keyV[role];
  let v = null;
  for (let i = 0; i < kt.length && kt[i] <= t; i++) if (kv[i]) v = kv[i];
  if (v === null) return vmh.defaultId;
  if (v[0] === '@') {
    const cy = vmh.cycles[v];
    let fi = Math.floor(simTime * cy.fps) % cy.ids.length;
    if (fi < 0) fi += cy.ids.length;
    return cy.ids[fi];
  }
  return vmh.plain[v];
}

/** Glow multiplier of a clip at time t (mirrors ASSETS.handFx.util.glowAt: keys lerp, or mul with optional pulse, capped). */
function glowAt(vmh, role, t, simTime) {
  const g = vmh.glowOf[role];
  if (!g) return 0;
  if (g.keys) {
    const ks = g.keys;
    if (t <= ks[0][0]) return ks[0][1];
    for (let i = 1; i < ks.length; i++) {
      if (t <= ks[i][0]) { const a = ks[i - 1], b = ks[i]; return a[1] + (b[1] - a[1]) * ((t - a[0]) / ((b[0] - a[0]) || 1)); }
    }
    return ks[ks.length - 1][1];
  }
  let m = g.mul || 0;
  if (g.pulse) m *= 1 + g.pulse.amp * Math.sin(2 * Math.PI * g.pulse.hz * simTime);
  return Math.min(m, vmh.cap);
}

/**
 * Which clip plays and at what clip time, from the fireball sim alone (no render state). Fills clock.kind/role/tMs/bob.
 * idleMs = time driving the idle loop (render: simTime*1000, sim-side particles: tick*STEP_MS).
 */
function classify(vmh, c, sim, idleMs, moving) {
  let kind = K_IDLE, role = 'idle', tMs = idleMs, bob = moving ? 1 : 0;
  if (sim) {
    const state = sim.state, tick = sim.tick;
    if (state !== FB_IDLE) {
      const ms = sim.holdSteps * STEP_MS;
      c.holdMs = ms;
      if (ms < vmh.dur.charge) { kind = K_CHARGE; role = 'charge'; tMs = ms; } else { kind = K_HOLD; role = 'hold'; tMs = ms - vmh.dur.charge; }
      bob = 0.2;
    } else {
      if (c.prevState !== FB_IDLE && sim.castTick === c.prevCastTick) c.outTick = tick; // released / cancelled without a cast
      const castMs = (tick - sim.castTick) * STEP_MS, outMs = (tick - c.outTick) * STEP_MS;
      if (castMs >= 0) {
        // Tap blend: a hold shorter than 300 ms starts fireCast at the matching charge pose (its [0,300] mirrors `charge`) and
        // catches up to 300 ms within R ms, instead of jumping the pose. Full holds (>= 300 ms) have R = 0 = the plain 300 ms start.
        const from = c.holdMs < CAST_FROM_MS ? c.holdMs : CAST_FROM_MS;
        const R = (CAST_FROM_MS - from) / CAST_FROM_MS * TAP_RAMP_MS;
        const t = castMs < R ? from + (CAST_FROM_MS - from) * (castMs / R) : CAST_FROM_MS + castMs - R;
        if (t < vmh.dur.cast) { kind = K_CAST; role = 'cast'; tMs = t; bob = 0.3; }
      }
      if (kind === K_IDLE && outMs >= 0 && outMs < vmh.dur.out) { kind = K_OUT; role = 'out'; tMs = outMs; bob = 0.3; }
    }
    c.prevState = state; c.prevCastTick = sim.castTick;
  }
  c.kind = kind; c.role = role; c.tMs = tMs; c.bob = bob;
}

/**
 * Per frame. `hand` = hands.handOf('spell.fireball') ('left' | 'right' | null). `sim` = the fireball sim (optional: idle only).
 * @returns {number} the carried-light glow multiplier for this frame
 */
export function presentHandFire(vmh, hand, simTime, bobPhase, moving, sim) {
  if (!vmh) return 1;
  const { vm, h, clip } = vmh;
  if (hand !== 'left' && hand !== 'right') { vm.hide(h); vmh.glow = 1; return 1; }
  if (vm.handOf(h) !== hand) vm.setHand(h, hand);
  const c = vmh.clock;
  classify(vmh, c, sim, simTime * 1000, moving);
  const kind = c.kind, role = c.role, tMs = c.tMs, bob = c.bob;
  if (kind !== vmh.kind) { vm.capture(h); vmh.kind = kind; }
  const vid = variantAt(vmh, role, role === 'idle' ? tMs % vmh.dur.idle : tMs, simTime);
  vm.setVariant(h, vid);
  vmh.variant = vid;
  vm.show(h, clip[role], tMs, false);
  vm.setBob(bobPhase, bob, h);
  const gt = role === 'idle' ? tMs % vmh.dur.idle : tMs;
  vmh.glow = glowAt(vmh, role, gt, simTime);
  return vmh.glow;
}

/**
 * HAND-FIRE-FX-01: the translucent flame body over the hand = the fireball's core sprite art at hand scale (`handFlame`, or
 * `handFlameCharged` while the fist gathers). Render side: main.js stores the world position of the core mount each frame
 * (`setHandFlame`), the sprite pool's `extra` callback pushes it (`pushHandFlame`). 0 alloc.
 */
export function setHandFlame(vmh, on, x, y, z, simTime, cx, cy, cz) {
  const f = vmh.flame;
  // the sprite pass culls anything nearer than 0.6 m: slide the point out along the eye ray to >= 0.72 m (art is sized for that)
  const dx = x - cx, dy = y - cy, dz = z - cz, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, k = d < FLAME_MIN_DEPTH ? FLAME_MIN_DEPTH / d : 1;
  f.on = on; f.x = cx + dx * k; f.y = cy + dy * k; f.z = cz + dz * k; f.t = simTime;
  f.charged = vmh.kind === K_CHARGE || vmh.kind === K_HOLD;
}
export function pushHandFlame(vmh, pool) {
  const f = vmh && vmh.flame;
  if (!f || !f.on) return;
  pool.push(f.charged ? 'handFlameCharged' : 'handFlame', 'fly', Math.floor(f.t * 12) & 3, f.x, f.y, f.z);
}

// ---- particles (HAND-WIRE-02): def.particles[clip] rules -> persistent burst emitters, sim side (hashed, 37.8: origin from the
// eye + the cast offset, never the render pose). One persistent emitter per preset (setEmitterPos + burst), recreated if a
// world reload cleared it. No attractor. 0 alloc per step.

/** `particles` = engine.particles (presets must already be defined). `castOffset` = FIREBALL_CFG.castOffset {right,fwd,down}. */
export function bindHandFx(vmh, particles, castOffset) {
  const def = vmh.def, rulesOf = {}, ids = {};
  for (const role of ROLES) {
    const list = (def.particles && def.particles[vmh.names[role]]) || [];
    rulesOf[role] = list.map((r) => {
      if (ids[r.preset] === undefined) ids[r.preset] = particles.defIdOf(r.preset);
      return { preset: r.preset, def: ids[r.preset], every: r.everySteps || 0, n: r.n || 1, from: r.fromMs || 0,
               to: r.toMs === undefined ? Infinity : r.toMs, at: r.atMs === undefined ? -1 : r.atMs, aim: r.dir === 'aim', last: -1 };
    });
  }
  const handles = {};
  for (const k of Object.keys(ids)) if (ids[k] >= 0) handles[k] = -1;
  vmh.fx = { particles, rulesOf, handles, off: castOffset, stats: { bursts: 0 }, lastRole: '', prevT: -1, lastIdx: null };
  return vmh.fx;
}

/**
 * Once per sim step after fireball.step. (ex,ey,ez) = player eye, (fx,fy) = horizontal forward unit, (ax,ay,az) = aim unit.
 * `hand` null = item not in a hand (no particles).
 */
export function stepHandFx(vmh, hand, sim, ex, ey, ez, fx, fy, ax, ay, az) {
  const f = vmh && vmh.fx;
  if (!f || !sim || (hand !== 'left' && hand !== 'right')) { if (f) f.lastRole = ''; return; }
  const c = vmh.fxClock;
  classify(vmh, c, sim, sim.tick * STEP_MS, false);
  const role = c.role, t = c.tMs, rules = f.rulesOf[role];
  if (role !== f.lastRole) { f.lastRole = role; f.prevT = -1; for (let i = 0; i < rules.length; i++) rules[i].last = -1; }
  const prev = f.prevT;
  f.prevT = t;
  if (rules.length === 0) return;
  const sg = hand === 'left' ? -1 : 1, o = f.off;
  // same maths as the fireball cast point (sim/fireball.js): engine right = (-fy, fx) for forward (fx, fy) = (sinY, -cosY)
  const x = ex - fy * sg * o.right + fx * o.fwd, y = ey + fx * sg * o.right + fy * o.fwd, z = ez - o.down;
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (r.def < 0) continue;
    let fire = false;
    if (r.at >= 0) fire = prev < r.at && r.at <= t;
    else if (r.every > 0 && t >= r.from && t <= r.to) {
      const idx = Math.floor((t - r.from) / STEP_MS + 1e-6);
      if (idx !== r.last) { r.last = idx; fire = idx % r.every === 0; }
    }
    if (!fire) continue;
    let h = f.handles[r.preset];
    if (h === undefined) continue;
    if (h < 0 || !f.particles.isValid(h)) { h = f.handles[r.preset] = f.particles.createEmitter(r.def, x, y, z); if (h < 0) continue; }
    f.particles.setEmitterPos(h, x, y, z);
    if (r.aim) f.particles.setEmitterDir(h, ax, ay, az); else f.particles.setEmitterDir(h, 0, 0, 1);
    f.particles.burst(h, r.n);
    f.stats.bursts++;
  }
}
