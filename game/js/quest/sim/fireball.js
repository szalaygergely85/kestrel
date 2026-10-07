// game/js/quest/sim/fireball.js (SPELL-01a, docs/architecture.md 37.14, D-040/D-042). The fireball: tap/hold cast
// state machine on the spell hand's button, swept flight (World.raySegment + cylinder test vs targetables), the US-136
// burst (explosionHits), `combat:hit` damage + knockback for beasts, knockback only (no damage) for the player.
// Rule 15 (sim/**): no Math.random, no trig, no wall clock, integer step counters, zero allocation in `step`.
// The sim is transient (like the sword): not saved; a reload has no balls in flight.
import { explosionHits, applyImpulse, PHYSICS, SIM_STEP } from '../../../../engine/index.js';
import { MAX_TARGETABLES } from './targetables.js';

export const FB_IDLE = 0, FB_HOLD = 1, FB_CHARGE = 2;
const NO_HIT = 0, WORLD_HIT = 1, TARGET_HIT = 2;
const MAXC = MAX_TARGETABLES + 1; // targets + the player

/**
 * @param {any} world engine World (`raySegment`)
 * @param {{emit:Function}} events
 * @param {typeof import('../spellConfig.js').FIREBALL_CFG} cfg
 * @param {ReturnType<typeof import('./targetables.js').createTargetables>} targets
 * @param {{spendMana?: (n:number)=>boolean}} [hooks]
 */
export function createFireballSim(world, events, cfg, targets, hooks) {
  const spendMana = (n) => (hooks && typeof hooks.spendMana === 'function' ? hooks.spendMana(n) : true);
  const N = cfg.maxAlive;
  const dt = SIM_STEP;

  let hand = 'right';
  let state = FB_IDLE, holdSteps = 0, prevDown = 0, cooldown = 0, castTick = -1000000, tick = 0, serialNo = 0;
  let lastCharged = 0;
  let curPlayer = null;

  // slot SoA (the view reads it)
  const slots = {
    n: N, alive: new Uint8Array(N), serial: new Int32Array(N), age: new Int32Array(N),
    x: new Float64Array(N), y: new Float64Array(N), z: new Float64Array(N),
    dx: new Float64Array(N), dy: new Float64Array(N), dz: new Float64Array(N),
    speed: new Float64Array(N), radius: new Float64Array(N), damage: new Float64Array(N), knock: new Float64Array(N),
    travelled: new Float64Array(N), charged: new Uint8Array(N), hand: new Uint8Array(N), // hand 0 left 1 right
  };
  let aliveCount = 0;

  // scratch
  const _ray = { t: 0, x: 0, y: 0, z: 0 };
  const _aim = { t: 0, x: 0, y: 0, z: 0 };
  const hit = { kind: NO_HIT, t: 0, idx: -1, x: 0, y: 0, z: 0 };
  const cand = { count: 0, x: new Float64Array(MAXC), y: new Float64Array(MAXC), z: new Float64Array(MAXC), r: new Float64Array(MAXC), h: new Float64Array(MAXC) };
  const outIdx = new Int32Array(MAXC), outF = new Float64Array(MAXC), outDir = new Float64Array(MAXC * 3);
  const hitPayload = { source: 'player', target: null, damage: 0, heavy: 1, cause: 'fire', knock: 0, dirX: 0, dirY: 0, px: 0, py: 0, pz: 0 };
  const castPayload = { hand: 'right', charged: false, x: 0, y: 0, z: 0 };
  const burstPayload = { x: 0, y: 0, z: 0, radius: 0, charged: false };

  /** Segment p0 -> p1 vs world + targets. Fills `hit` (kind, fraction t, target idx, point). Ties go to the target. */
  function sweep(x0, y0, z0, x1, y1, z1) {
    hit.kind = NO_HIT; hit.idx = -1; hit.t = 1;
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    let tw = 2;
    if (dx * dx + dy * dy + dz * dz > 1e-12 && world.raySegment(x0, y0, z0, x1, y1, z1, _ray)) tw = _ray.t;
    let tt = 2, ti = -1;
    const pad = cfg.hitPad, a = dx * dx + dy * dy;
    for (let i = 0; i < targets.count; i++) {
      const R = targets.r[i];
      if (R < 0) continue;
      const Rp = R + pad, fx = x0 - targets.x[i], fy = y0 - targets.y[i];
      let lo, hi;
      if (a < 1e-12) {
        if (fx * fx + fy * fy > Rp * Rp) continue;
        lo = 0; hi = 1;
      } else {
        const b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - Rp * Rp;
        const disc = b * b - 4 * a * c;
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        lo = (-b - sq) / (2 * a); hi = (-b + sq) / (2 * a);
        if (lo < 0) lo = 0;
        if (hi > 1) hi = 1;
        if (lo > hi) continue;
      }
      const zl = targets.z[i] - pad, zh = targets.z[i] + targets.h[i] + pad;
      if (dz > -1e-12 && dz < 1e-12) {
        if (z0 < zl || z0 > zh) continue;
      } else {
        let s1 = (zl - z0) / dz, s2 = (zh - z0) / dz;
        if (s1 > s2) { const s = s1; s1 = s2; s2 = s; }
        if (s1 > lo) lo = s1;
        if (s2 < hi) hi = s2;
        if (lo > hi) continue;
      }
      if (lo < tt) { tt = lo; ti = i; }
    }
    if (ti >= 0 && tt <= tw) {
      hit.kind = TARGET_HIT; hit.t = tt; hit.idx = ti;
    } else if (tw <= 1) {
      hit.kind = WORLD_HIT; hit.t = tw;
    } else return;
    hit.x = x0 + dx * hit.t; hit.y = y0 + dy * hit.t; hit.z = z0 + dz * hit.t;
  }

  function burst(cx, cy, cz, radius, damage, knock, charged, direct, ddx, ddy, player) {
    targets.refresh(); // cheap; keeps a cast-time (point-blank) burst exact
    const tc = targets.count;
    for (let i = 0; i < tc; i++) {
      const dead = targets.r[i] < 0;
      cand.x[i] = dead ? 1e9 : targets.x[i]; cand.y[i] = targets.y[i]; cand.z[i] = targets.z[i];
      cand.r[i] = dead ? 0 : targets.r[i]; cand.h[i] = targets.h[i];
    }
    let pt = null, body = null;
    cand.count = tc;
    if (player && player.transform) {
      pt = player.transform; body = player.components && player.components.body;
      cand.x[tc] = pt.x; cand.y[tc] = pt.y; cand.z[tc] = pt.z; cand.r[tc] = PHYSICS.radius; cand.h[tc] = PHYSICS.height;
      cand.count = tc + 1;
    }
    const n = explosionHits(world, cx, cy, cz, radius, cand, outIdx, outF, outDir, _ray);
    for (let k = 0; k < n; k++) {
      const i = outIdx[k], f = outF[k], o = k * 3;
      let hx = outDir[o], hy = outDir[o + 1];
      const hl = Math.sqrt(hx * hx + hy * hy);
      if (hl > 1e-6) { hx /= hl; hy /= hl; } else { hx = 0; hy = 0; }
      if (i < tc) {
        let dmg = Math.round(damage * f);
        if (i === direct && dmg < 1) dmg = 1;
        if (dmg < 1) continue;
        const e = targets.ent[i];
        const p = hitPayload;
        p.target = e.id; p.damage = dmg; p.knock = knock * f;
        p.dirX = hl > 1e-6 ? hx : ddx; p.dirY = hl > 1e-6 ? hy : ddy;
        p.px = targets.x[i]; p.py = targets.y[i]; p.pz = targets.z[i] + targets.h[i] * 0.5;
        events.emit('combat:hit', p);
        const eb = e.components && e.components.body;
        if (eb) applyImpulse(eb, e.transform.z, p.dirX * p.knock, p.dirY * p.knock, 0);
      } else if (body) {
        // the player: knockback only, never a combat:hit (owner answer 3)
        applyImpulse(body, pt.z, hx * cfg.self.knockH * f, hy * cfg.self.knockH * f, cfg.self.knockV * f);
      }
    }
    const bp = burstPayload;
    bp.x = cx; bp.y = cy; bp.z = cz; bp.radius = radius; bp.charged = !!charged;
    events.emit('fireball:burst', bp);
  }

  function burstSlot(s, x, y, z, direct) {
    const dx = slots.dx[s], dy = slots.dy[s];
    const r = slots.radius[s], dmg = slots.damage[s], kn = slots.knock[s], ch = slots.charged[s] === 1;
    slots.alive[s] = 0; aliveCount--;
    burst(x, y, z, r, dmg, kn, ch, direct, dx, dy, curPlayer);
  }

  function cast(player, charged, fx, fy, ax, ay, az) {
    if (aliveCount >= cfg.maxAlive) return; // refused at the cap, no mana
    let C = cfg.tap;
    if (charged) {
      if (spendMana(cfg.charged.mana)) C = cfg.charged;
      else if (!spendMana(cfg.tap.mana)) return;
    } else if (!spendMana(cfg.tap.mana)) return;
    const isCharged = C === cfg.charged;
    cooldown = cfg.cooldown; castTick = tick; lastCharged = isCharged ? 1 : 0;

    const t = player.transform, body = player.components && player.components.body;
    const ex = t.x, ey = t.y, ez = t.z + (body && typeof body.eyeH === 'number' ? body.eyeH : PHYSICS.eyeHeight);
    const sgn = hand === 'left' ? -1 : 1, off = cfg.castOffset;
    const ox = ex - fy * sgn * off.right + fx * off.fwd, oy = ey + fx * sgn * off.right + fy * off.fwd, oz = ez - off.down;

    // aim point under the crosshair
    const R = cfg.maxRange;
    let px = ex + ax * R, py = ey + ay * R, pz = ez + az * R;
    if (world.raySegment(ex, ey, ez, px, py, pz, _aim)) { px = _aim.x; py = _aim.y; pz = _aim.z; }
    let dx = px - ox, dy = py - oy, dz = pz - oz;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl < cfg.aimMin) { dx = ax; dy = ay; dz = az; } else { dx /= dl; dy /= dl; dz /= dl; }

    castPayload.hand = hand; castPayload.charged = isCharged; castPayload.x = ox; castPayload.y = oy; castPayload.z = oz;
    events.emit('fireball:cast', castPayload);

    let s = 0;
    while (s < N && slots.alive[s] === 1) s++;
    slots.alive[s] = 1; aliveCount++;
    slots.serial[s] = ++serialNo; slots.age[s] = 0;
    slots.x[s] = ox; slots.y[s] = oy; slots.z[s] = oz;
    slots.dx[s] = dx; slots.dy[s] = dy; slots.dz[s] = dz;
    slots.speed[s] = C.speed; slots.radius[s] = C.radius; slots.damage[s] = C.damage; slots.knock[s] = C.knock;
    slots.travelled[s] = 0; slots.charged[s] = isCharged ? 1 : 0; slots.hand[s] = hand === 'left' ? 0 : 1;

    // point-blank sweep eye -> origin: a wall/boar in the way bursts at once
    targets.refresh();
    sweep(ex, ey, ez, ox, oy, oz);
    if (hit.kind !== NO_HIT) {
      const back = hit.kind === WORLD_HIT ? cfg.wallBack : 0;
      burstSlot(s, hit.x - dx * back, hit.y - dy * back, hit.z - dz * back, hit.kind === TARGET_HIT ? hit.idx : -1);
    }
  }

  function flight() {
    targets.refresh();
    for (let s = 0; s < N; s++) {
      if (slots.alive[s] === 0) continue;
      slots.age[s]++;
      const x = slots.x[s], y = slots.y[s], z = slots.z[s];
      const dx = slots.dx[s], dy = slots.dy[s], dz = slots.dz[s];
      let d = slots.speed[s] * dt;
      const remain = cfg.maxRange - slots.travelled[s];
      const last = d >= remain;
      if (last) d = remain;
      const nx = x + dx * d, ny = y + dy * d, nz = z + dz * d;
      sweep(x, y, z, nx, ny, nz);
      if (hit.kind === TARGET_HIT) { burstSlot(s, hit.x, hit.y, hit.z, hit.idx); continue; }
      if (hit.kind === WORLD_HIT) {
        burstSlot(s, hit.x - dx * cfg.wallBack, hit.y - dy * cfg.wallBack, hit.z - dz * cfg.wallBack, -1);
        continue;
      }
      slots.x[s] = nx; slots.y[s] = ny; slots.z[s] = nz; slots.travelled[s] += d;
      if (last) burstSlot(s, nx, ny, nz, -1);
    }
  }

  const sim = {
    slots,
    get state() { return state; },
    get holdSteps() { return holdSteps; },
    get castTick() { return castTick; },
    get lastCharged() { return lastCharged; },
    get cooldown() { return cooldown; },
    get alive() { return aliveCount; },
    get tick() { return tick; },
    get hand() { return hand; },
    setHand(h) {
      if (h !== 'left' && h !== 'right') throw new Error('fireball.setHand: hand must be left or right');
      hand = h;
    },
    cancel() { state = FB_IDLE; holdSteps = 0; },
    /**
     * @param {any} player entity data @param {boolean} down raw button
     * @param {number} fx @param {number} fy horizontal unit forward
     * @param {number} ax @param {number} ay @param {number} az unit 3D aim
     */
    step(player, down, fx, fy, ax, ay, az) {
      tick++;
      curPlayer = player;
      if (cooldown > 0) cooldown--;
      const d = down ? 1 : 0;
      const pressed = d === 1 && prevDown === 0, released = d === 0 && prevDown === 1;
      prevDown = d;
      if (state === FB_IDLE) {
        if (pressed && cooldown === 0) { state = FB_HOLD; holdSteps = 1; } // holdSteps = steps the button was down, press included
      } else if (released) {
        const charged = state === FB_CHARGE;
        state = FB_IDLE; holdSteps = 0;
        cast(player, charged, fx, fy, ax, ay, az);
      } else if (d === 1) {
        if (holdSteps < 9999) holdSteps++;
        if (state === FB_HOLD && holdSteps >= cfg.holdSteps) state = FB_CHARGE;
      }
      if (aliveCount > 0) flight();
    },
    dispose() {},
    hashInto(h) {
      h.u32(state); h.u32(holdSteps); h.u32(prevDown); h.u32(cooldown); h.u32(castTick & 0x7fffffff); h.u32(hand === 'left' ? 0 : 1);
      h.u32(aliveCount);
      for (let s = 0; s < N; s++) {
        h.u32(slots.alive[s]);
        if (slots.alive[s] === 0) continue;
        h.f64(slots.x[s]); h.f64(slots.y[s]); h.f64(slots.z[s]); h.f64(slots.travelled[s]); h.u32(slots.charged[s]);
      }
    },
  };
  return sim;
}
