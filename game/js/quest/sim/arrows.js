// game/js/quest/sim/arrows.js (EQ-08, docs/architecture.md 38.41). Bow arrows: ballistic flight (semi-implicit gravity),
// continuous swept hit (sim/sweep.js) vs world colliders + targetables, `combat:hit` on a target, sticking into surfaces
// (stuck pool, oldest recycled, 30 s, 70 % pickable by a deterministic serial hash), pick-up back into quiver/pack.
// Rule 15 (sim/**): no Math.random, no trig, integer step counters, zero allocation in `step`. Transient: not saved.
import { SIM_STEP } from '../../../../engine/index.js';
import { addItem } from './inventory.js';
import { riverWaterAt } from './wading.js';
import { sweepSegment, TARGET_HIT, NO_HIT } from './sweep.js';

/** Arrow damage from the sword damage and the draw (0..1): round(sword * (1 + 2*draw)), min 1. */
export function arrowDamage(swordDamage, draw) {
  const d = Math.round(swordDamage * (1 + 2 * Math.min(1, Math.max(0, draw))));
  return d < 1 ? 1 : d;
}

const _lobNone = { vx: 0, vy: 0, vz: 0 };
/**
 * GOB-03 (38.57): pure, trig-free lob. Horizontal speed `speedH` toward (tx,ty), flight time t = dH / speedH, vz chosen so the
 * ballistic arc under gravity `g` passes through (tx,ty,tz). Writes out.vx/vy/vz (out defaults to a shared scratch).
 */
export function lobVelocity(x0, y0, z0, tx, ty, tz, speedH, g, out = _lobNone) {
  const dx = tx - x0, dy = ty - y0, dz = tz - z0;
  const dH = Math.sqrt(dx * dx + dy * dy);
  let t = dH / speedH;
  if (t < 1 / 60) t = 1 / 60; // point blank: avoid a divide by ~0
  out.vx = dx / t; out.vy = dy / t; out.vz = dz / t + 0.5 * g * t;
  return out;
}

/**
 * GOB-03: a one-entry target list (the player only) for the enemy projectile sim: same SoA shape as createTargetables.
 * r = -1 while the player is dead. Goblins are not in it, so a spear can never hit one.
 * @param {any} world
 */
export function createPlayerTarget(world) {
  const t = {
    count: 1, x: new Float64Array(1), y: new Float64Array(1), z: new Float64Array(1),
    r: new Float64Array(1), h: new Float64Array(1), ent: [{ id: 'player' }],
    refresh() {
      const hd = world.get('player');
      const d = hd && hd.data, tr = d && d.transform;
      if (!tr) { t.r[0] = -1; return; }
      const hp = d.components && d.components.health;
      t.x[0] = tr.x; t.y[0] = tr.y; t.z[0] = tr.z; t.h[0] = 1.7;
      t.r[0] = hp && hp.hp <= 0 ? -1 : 0.35;
    },
    dispose() {},
  };
  t.refresh();
  return t;
}

/**
 * @param {any} world engine World (`raySegment`)
 * @param {{emit:Function}} events
 * @param {typeof import('../bowConfig.js').BOW_CFG} cfg
 * @param {ReturnType<typeof import('./targetables.js').createTargetables>} targets
 * @param {((x:number,y:number,z:number)=>void)|null} [onWaterHit] US-055a: called where an arrow lands in river water (splash fx)
 * @param {{owner?:'player'|'enemy'}} [opts] GOB-03: owner 'enemy' = goblin spear (hits only `targets` = createPlayerTarget,
 *   payload target 'player' + ranged 1 + source from fireVel, a blocked spear drops, never pickable). Default 'player' = unchanged.
 */
export function createArrowSim(world, events, cfg, targets, onWaterHit = null, opts = null) {
  const enemy = !!(opts && opts.owner === 'enemy');
  const dt = SIM_STEP;
  const NF = cfg.maxFlying, NS = cfg.maxStuck;
  const fp = { x: 0, y: 0 }, fn = { x: 0, y: 0 }; // floater query scratch (0 alloc)
  let serialNo = 0, tick = 0, flyingCount = 0, stuckCount = 0, floatCount = 0;
  const NW = cfg.maxFloat | 0;
  // RIVER-01b (38.45): arrows that land in river water float and drift with the current for cfg.floatSteps, then vanish
  // (at the bank, where water ends, they stick). Rect/circle water keeps today's behaviour.
  const floaters = { n: NW, alive: new Uint8Array(NW), age: new Int32Array(NW), x: new Float64Array(NW), y: new Float64Array(NW), z: new Float64Array(NW), fx: new Float64Array(NW), fy: new Float64Array(NW) };
  const wq = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: -1, look: 0 };
  const fv = [0, 0], rk = { lat: 0, hw: 0, tx: 0, ty: 0, v: 0, z: 0 };

  const flying = {
    n: NF, alive: new Uint8Array(NF), age: new Int32Array(NF), damage: new Float64Array(NF),
    x: new Float64Array(NF), y: new Float64Array(NF), z: new Float64Array(NF),
    vx: new Float64Array(NF), vy: new Float64Array(NF), vz: new Float64Array(NF),
    src: new Array(NF).fill(null), // GOB-03: the thrower id (enemy mode)
  };
  const stuck = {
    n: NS, alive: new Uint8Array(NS), age: new Int32Array(NS), serial: new Int32Array(NS), pickable: new Uint8Array(NS),
    x: new Float64Array(NS), y: new Float64Array(NS), z: new Float64Array(NS),
    dx: new Float64Array(NS), dy: new Float64Array(NS), dz: new Float64Array(NS), // unit flight direction (the view orients from it)
  };
  const hit = { kind: NO_HIT, t: 0, idx: -1, x: 0, y: 0, z: 0 };
  const payload = { source: 'player', target: null, damage: 0, heavy: 0, cause: 'arrow', dirX: 0, dirY: 0, px: 0, py: 0, pz: 0 };

  const ePayload = { source: null, target: 'player', damage: 0, heavy: 0, cause: 'spear', ranged: 1, blocked: 0, dirX: 0, dirY: 0, px: 0, py: 0, pz: 0 };

  function stickAt(x, y, z, dx, dy, dz) {
    let k = 0;
    if (stuckCount < NS) { while (stuck.alive[k] === 1) k++; stuckCount++; }
    else { // pool full: recycle the oldest (ties: lowest index)
      for (let i = 1; i < NS; i++) if (stuck.age[i] > stuck.age[k]) k = i;
    }
    const sn = ++serialNo;
    stuck.alive[k] = 1; stuck.age[k] = 0; stuck.serial[k] = sn;
    stuck.pickable[k] = ((Math.imul(sn, 2654435761) >>> 0) % 100) < cfg.survivePct ? 1 : 0;
    stuck.x[k] = x; stuck.y[k] = y; stuck.z[k] = z; stuck.dx[k] = dx; stuck.dy[k] = dy; stuck.dz[k] = dz;
  }
  /** Put the arrow at (x, y, z) onto the river surface if that point is under it. true = became a floater. */
  function tryFloat(x, y, z) {
    if (NW === 0 || floatCount >= NW || !riverWaterAt(world, x, y, wq) || z > wq.surfaceZ + 0.02) return false;
    let k = 0;
    while (floaters.alive[k] === 1) k++;
    floaters.alive[k] = 1; floaters.age[k] = 0; floaters.x[k] = x; floaters.y[k] = y; floaters.z[k] = rk.z - cfg.floatDraft;
    world.flowAt(x, y, fv); floaters.fx[k] = fv[0]; floaters.fy[k] = fv[1];
    floatCount++;
    if (onWaterHit) onWaterHit(x, y, wq.surfaceZ);
    return true;
  }
  /** Drift every floater one step (own small function: stays optimisable and the world queries inline, 0 alloc). */
  function stepFloaters() {
    for (let k = 0; k < NW; k++) {
      if (floaters.alive[k] === 0) continue;
      if (++floaters.age[k] > cfg.floatSteps) { floaters.alive[k] = 0; floatCount--; continue; }
      // the current at the floater is cached from the last accepted position (fx/fy); fp/fn are hoisted scratch for the world queries
      fp.x = floaters.x[k]; fp.y = floaters.y[k];
      const nx = fp.x + floaters.fx[k] * dt, ny = fp.y + floaters.fy[k] * dt; // locals: one box per coordinate shared by both queries
      fn.x = nx; fn.y = ny;
      if (world.riverAt(nx, ny, rk)) { // riverAt = highest water region is a river (surfaceZ = rk.z, rivers have no waves): no waterAt call (a big non-inlined call boxes the doubles) // = riverWaterAt spelled out (and no flowAt): two inlinable queries, no boxed doubles
        floaters.x[k] = fn.x; floaters.y[k] = fn.y; floaters.z[k] = rk.z - cfg.floatDraft;
        const q = rk.lat / rk.hw, fl = rk.v * (1 - 0.5 * q * q); // = World#flowAt river formula
        floaters.fx[k] = rk.tx * fl; floaters.fy[k] = rk.ty * fl;
      } else { floaters.alive[k] = 0; floatCount--; stickAt(fp.x, fp.y, floaters.z[k], 0, 0, -1); } // reached the bank: stays
    }
  }
  function kill(s) { flying.alive[s] = 0; flyingCount--; }
  function freeStuck(k) { stuck.alive[k] = 0; stuckCount--; }

  const sim = {
    flying, stuck, floaters,
    get floatCount() { return floatCount; },
    get flyingCount() { return flyingCount; },
    get stuckCount() { return stuckCount; },
    get tick() { return tick; },
    /** Launch an arrow along the unit direction (fx,fy,fz). false = flying pool full (caller keeps the arrow). */
    fire(x, y, z, fx, fy, fz, draw, damage) {
      if (flyingCount >= NF) return false;
      let s = 0;
      while (flying.alive[s] === 1) s++;
      const d = draw < 0 ? 0 : draw > 1 ? 1 : draw;
      const v = cfg.vMin + (cfg.vMax - cfg.vMin) * d;
      flying.alive[s] = 1; flyingCount++; flying.age[s] = 0; flying.damage[s] = damage;
      flying.x[s] = x; flying.y[s] = y; flying.z[s] = z;
      flying.vx[s] = fx * v; flying.vy[s] = fy * v; flying.vz[s] = fz * v;
      return true;
    },
    /** GOB-03: launch with an explicit velocity (enemy spear; lobVelocity gives it). false = pool full. */
    fireVel(x, y, z, vx, vy, vz, damage, srcId) {
      if (flyingCount >= NF) return false;
      let s = 0;
      while (flying.alive[s] === 1) s++;
      flying.alive[s] = 1; flyingCount++; flying.age[s] = 0; flying.damage[s] = damage; flying.src[s] = srcId;
      flying.x[s] = x; flying.y[s] = y; flying.z[s] = z;
      flying.vx[s] = vx; flying.vy[s] = vy; flying.vz[s] = vz;
      return true;
    },
    /** Quiver-aware shot: refuses at 0 arrows, takes one only when the arrow really flew. eq = equipment {quiver:{id,n}|null}. */
    shoot(eq, x, y, z, fx, fy, fz, draw, damage) {
      const q = eq && eq.quiver;
      if (!q || !(q.n > 0)) return false;
      if (!sim.fire(x, y, z, fx, fy, fz, draw, damage)) return false;
      q.n--;
      return true;
    },
    step() {
      tick++;
      if (flyingCount > 0) {
        targets.refresh();
        for (let s = 0; s < NF; s++) {
          if (flying.alive[s] === 0) continue;
          if (++flying.age[s] > cfg.maxFlightSteps) { kill(s); continue; }
          flying.vz[s] -= cfg.g * dt;
          const x = flying.x[s], y = flying.y[s], z = flying.z[s];
          const vx = flying.vx[s], vy = flying.vy[s], vz = flying.vz[s];
          const nx = x + vx * dt, ny = y + vy * dt, nz = z + vz * dt;
          sweepSegment(world, targets, cfg.hitPad, x, y, z, nx, ny, nz, hit);
          if (hit.kind !== TARGET_HIT && (hit.kind === NO_HIT ? tryFloat(nx, ny, nz) : tryFloat(hit.x, hit.y, hit.z))) { kill(s); continue; }
          if (hit.kind === NO_HIT) { flying.x[s] = nx; flying.y[s] = ny; flying.z[s] = nz; continue; }
          const sp = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
          const dx = vx / sp, dy = vy / sp, dz = vz / sp;
          if (hit.kind === TARGET_HIT && enemy) {
            const hl = Math.sqrt(vx * vx + vy * vy) || 1;
            const p = ePayload;
            p.source = flying.src[s]; p.damage = flying.damage[s]; p.dirX = vx / hl; p.dirY = vy / hl; p.blocked = 0;
            p.px = hit.x; p.py = hit.y; p.pz = hit.z;
            kill(s);
            events.emit('combat:hit', p);
            if (p.blocked === 1) { // EQ-06: the shield took it, the spear drops at the hit point pointing down
              stickAt(hit.x, hit.y, hit.z, 0, 0, -1);
              events.emit('beast:spearBlocked', p);
            }
          } else if (hit.kind === TARGET_HIT) {
            const e = targets.ent[hit.idx];
            const hl = Math.sqrt(vx * vx + vy * vy) || 1;
            const p = payload;
            p.target = e.id; p.damage = flying.damage[s]; p.dirX = vx / hl; p.dirY = vy / hl;
            p.px = hit.x; p.py = hit.y; p.pz = hit.z;
            kill(s);
            events.emit('combat:hit', p); // v1: the arrow is gone (none stuck in beasts)
          } else {
            const hx = hit.x - dx * cfg.stuckBack, hy = hit.y - dy * cfg.stuckBack, hz = hit.z - dz * cfg.stuckBack;
            kill(s);
            stickAt(hx, hy, hz, dx, dy, dz);
          }
        }
      }
      if (floatCount > 0) stepFloaters();
      if (stuckCount > 0) {
        for (let k = 0; k < NS; k++) {
          if (stuck.alive[k] === 0) continue;
          if (++stuck.age[k] >= cfg.stickSteps) freeStuck(k);
        }
      }
    },
    /** Nearest pickable stuck arrow within maxR (3D), or -1. */
    nearestPickable(px, py, pz, maxR) {
      let best = -1, bd = maxR * maxR;
      for (let k = 0; k < NS; k++) {
        if (stuck.alive[k] === 0 || stuck.pickable[k] === 0) continue;
        const dx = stuck.x[k] - px, dy = stuck.y[k] - py, dz = stuck.z[k] - pz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d <= bd) { bd = d; best = k; }
      }
      return best;
    },
    /** Frees stuck slot k (the E key). false if it is not a live pickable arrow. */
    take(k) {
      if (k < 0 || k >= NS || stuck.alive[k] === 0 || stuck.pickable[k] === 0) return false;
      freeStuck(k);
      return true;
    },
    /**
     * Walk-over pick-up of every pickable stuck arrow within `radius`. With `bag` ({inv, eq, defs}) each arrow goes to the
     * equipped quiver while it is below its cap (defs[quiver.id].stackMax: 30, 50 for the big quiver), else into the pack
     * (inventory API); one that fits nowhere stays stuck. Without `bag` the arrows are just freed. Returns the number taken.
     */
    pickup(px, py, pz, radius, bag) {
      let n = 0;
      const r2 = radius * radius;
      for (let k = 0; k < NS; k++) {
        if (stuck.alive[k] === 0 || stuck.pickable[k] === 0) continue;
        const dx = stuck.x[k] - px, dy = stuck.y[k] - py, dz = stuck.z[k] - pz;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        if (bag) {
          const q = bag.eq && bag.eq.quiver;
          if (q && q.n < bag.defs[q.id].stackMax) q.n++;
          else if (addItem(bag.inv, bag.defs, q ? q.id : 'arrow', 1) < 1) continue;
        }
        freeStuck(k); n++;
      }
      return n;
    },
    reset() { flying.alive.fill(0); flying.src.fill(null); stuck.alive.fill(0); flyingCount = 0; stuckCount = 0; },
    dispose() {},
    hashInto(h) {
      h.u32(flyingCount); h.u32(stuckCount); h.u32(serialNo);
      for (let s = 0; s < NF; s++) {
        h.u32(flying.alive[s]);
        if (flying.alive[s] === 0) continue;
        h.f64(flying.x[s]); h.f64(flying.y[s]); h.f64(flying.z[s]); h.f64(flying.vz[s]);
      }
      for (let k = 0; k < NS; k++) {
        h.u32(stuck.alive[k]);
        if (stuck.alive[k] === 0) continue;
        h.f64(stuck.x[k]); h.f64(stuck.y[k]); h.f64(stuck.z[k]); h.u32(stuck.age[k]); h.u32(stuck.pickable[k]);
      }
    },
  };
  return sim;
}
