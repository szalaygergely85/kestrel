// game/js/quest/sim/arrows.js (EQ-08, docs/architecture.md 38.41). Bow arrows: ballistic flight (semi-implicit gravity),
// continuous swept hit (sim/sweep.js) vs world colliders + targetables, `combat:hit` on a target, sticking into surfaces
// (stuck pool, oldest recycled, 30 s, 70 % pickable by a deterministic serial hash), pick-up back into quiver/pack.
// Rule 15 (sim/**): no Math.random, no trig, integer step counters, zero allocation in `step`. Transient: not saved.
import { SIM_STEP } from '../../../../engine/index.js';
import { addItem } from './inventory.js';
import { sweepSegment, TARGET_HIT, NO_HIT } from './sweep.js';

/** Arrow damage from the sword damage and the draw (0..1): round(sword * (1 + 2*draw)), min 1. */
export function arrowDamage(swordDamage, draw) {
  const d = Math.round(swordDamage * (1 + 2 * Math.min(1, Math.max(0, draw))));
  return d < 1 ? 1 : d;
}

/**
 * @param {any} world engine World (`raySegment`)
 * @param {{emit:Function}} events
 * @param {typeof import('../bowConfig.js').BOW_CFG} cfg
 * @param {ReturnType<typeof import('./targetables.js').createTargetables>} targets
 */
export function createArrowSim(world, events, cfg, targets) {
  const dt = SIM_STEP;
  const NF = cfg.maxFlying, NS = cfg.maxStuck;
  let serialNo = 0, tick = 0, flyingCount = 0, stuckCount = 0;

  const flying = {
    n: NF, alive: new Uint8Array(NF), age: new Int32Array(NF), damage: new Float64Array(NF),
    x: new Float64Array(NF), y: new Float64Array(NF), z: new Float64Array(NF),
    vx: new Float64Array(NF), vy: new Float64Array(NF), vz: new Float64Array(NF),
  };
  const stuck = {
    n: NS, alive: new Uint8Array(NS), age: new Int32Array(NS), serial: new Int32Array(NS), pickable: new Uint8Array(NS),
    x: new Float64Array(NS), y: new Float64Array(NS), z: new Float64Array(NS),
    dx: new Float64Array(NS), dy: new Float64Array(NS), dz: new Float64Array(NS), // unit flight direction (the view orients from it)
  };
  const hit = { kind: NO_HIT, t: 0, idx: -1, x: 0, y: 0, z: 0 };
  const payload = { source: 'player', target: null, damage: 0, heavy: 0, cause: 'arrow', dirX: 0, dirY: 0, px: 0, py: 0, pz: 0 };

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
  function kill(s) { flying.alive[s] = 0; flyingCount--; }
  function freeStuck(k) { stuck.alive[k] = 0; stuckCount--; }

  const sim = {
    flying, stuck,
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
          if (hit.kind === NO_HIT) { flying.x[s] = nx; flying.y[s] = ny; flying.z[s] = nz; continue; }
          const sp = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
          const dx = vx / sp, dy = vy / sp, dz = vz / sp;
          if (hit.kind === TARGET_HIT) {
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
    reset() { flying.alive.fill(0); stuck.alive.fill(0); flyingCount = 0; stuckCount = 0; },
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
