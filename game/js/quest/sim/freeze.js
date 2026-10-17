// game/js/quest/sim/freeze.js (SPELL-R2, docs/epics/ep-spells.md Freeze; was Spark). Freeze: a straight, fast ice bolt (no gravity).
// First beast hit: damage + `combat:hit` with `freezeSec` (beastSim.applyFreeze: no move/attack, a grabbing croc lets go); a wall stops it.
// Level 3 also freezes up to `splash` more targets within `splashR` m of the hit (0-damage hits, same time).
// Reuses the shared swept hit test (sim/sweep.js, the fireball/arrow primitive). All numbers come from spellDefs.js (SPELL_DEFS.freeze.tiers).
// Key-slot cast like the fireball tap: requestTap() queues, the next step() fires with the aim. Rule 15 (sim/**): no Math.random, no trig,
// integer step counters, zero allocation in step. Transient (not saved).
import { SIM_STEP } from '../../../../engine/index.js';
import { SPELL_DEFS } from '../spellDefs.js';
import { sweepSegment, NO_HIT, WORLD_HIT, TARGET_HIT } from './sweep.js';

const TIERS = SPELL_DEFS.freeze.tiers, MAXN = TIERS[0].alive;

/**
 * @param {any} world @param {{emit:Function}} events @param {any} targets createTargetables()
 * @param {{spendMana?:(n:number)=>boolean, tier?:()=>number, damageMul?:()=>number, eyeH?:number}} [hooks]
 */
export function createFreezeSim(world, events, targets, hooks) {
  const h = hooks || {};
  const dt = SIM_STEP;
  const slots = { n: MAXN, alive: new Uint8Array(MAXN), serial: new Int32Array(MAXN), age: new Int32Array(MAXN),
    x: new Float64Array(MAXN), y: new Float64Array(MAXN), z: new Float64Array(MAXN),
    dx: new Float64Array(MAXN), dy: new Float64Array(MAXN), dz: new Float64Array(MAXN),
    speed: new Float64Array(MAXN), range: new Float64Array(MAXN), pad: new Float64Array(MAXN), travelled: new Float64Array(MAXN),
    splash: new Uint8Array(MAXN), splashR: new Float64Array(MAXN), damage: new Float64Array(MAXN), stun: new Float64Array(MAXN), knock: new Float64Array(MAXN) };
  let alive = 0, cooldown = 0, pendingTap = false, tick = 0, serialNo = 0, castTick = -1000000, refused = 0;
  const hit = { kind: NO_HIT, t: 0, idx: -1, x: 0, y: 0, z: 0 };
  const hitPayload = { source: 'player', target: null, damage: 0, heavy: 0, cause: 'freeze', knock: 0, freezeSec: 0, dirX: 0, dirY: 0, px: 0, py: 0, pz: 0 };
  const castPayload = { x: 0, y: 0, z: 0, tier: 1 };
  const endPayload = { x: 0, y: 0, z: 0, hitBeast: false };

  const tierNo = () => { const t = h.tier ? h.tier() | 0 : 1; return t < 1 ? 1 : t > 3 ? 3 : t; };

  function finish(s, x, y, z, beast) {
    slots.alive[s] = 0; alive--;
    endPayload.x = x; endPayload.y = y; endPayload.z = z; endPayload.hitBeast = beast;
    events.emit('freeze:end', endPayload);
  }
  function cast(player, ax, ay, az) {
    if (alive >= MAXN) return;
    const t0 = tierNo(), row = TIERS[t0 - 1];
    if (h.spendMana && !h.spendMana(row.mana)) { refused++; return; }
    cooldown = Math.round(row.cd * 60); castTick = tick;
    const t = player.transform, body = player.components && player.components.body;
    const ex = t.x, ey = t.y, ez = t.z + (body && typeof body.eyeH === 'number' ? body.eyeH : (h.eyeH || 1.6));
    let s = 0; while (slots.alive[s] === 1) s++;
    slots.alive[s] = 1; alive++; slots.serial[s] = ++serialNo; slots.age[s] = 0;
    slots.x[s] = ex; slots.y[s] = ey; slots.z[s] = ez; slots.dx[s] = ax; slots.dy[s] = ay; slots.dz[s] = az;
    slots.speed[s] = row.speed; slots.range[s] = row.range; slots.pad[s] = row.pad; slots.travelled[s] = 0;
    const m = h.damageMul ? h.damageMul() : 1;
    slots.damage[s] = Math.max(1, Math.round(row.dmg * (m > 0 ? m : 1))); slots.stun[s] = row.stun; slots.splash[s] = row.splash; slots.splashR[s] = row.splashR; slots.knock[s] = row.knock;
    castPayload.x = ex; castPayload.y = ey; castPayload.z = ez; castPayload.tier = t0;
    events.emit('freeze:cast', castPayload);
  }
  /** Level 3: up to `splash` other targets within `splashR` of the hit (2D, load order = deterministic) get a 0-damage freeze. */
  function splashFreeze(s, primary, hx, hy) {
    const p = hitPayload, r2 = slots.splashR[s] * slots.splashR[s], mx = slots.dx[s], my = slots.dy[s];
    let left = slots.splash[s];
    p.damage = 0; p.px = hx; p.py = hy;
    for (let k = 0; k < targets.count && left > 0; k++) {
      const o = targets.ent[k];
      if (o === primary) continue;
      const dx = o.transform.x - hx, dy = o.transform.y - hy;
      if (dx * dx + dy * dy > r2) continue;
      let hl = Math.sqrt(mx * mx + my * my); if (hl < 1e-6) hl = 1;
      p.target = o.id; p.dirX = mx / hl; p.dirY = my / hl; left--;
      events.emit('combat:hit', p);
    }
  }
  function flight() {
    targets.refresh();
    for (let s = 0; s < MAXN; s++) {
      if (slots.alive[s] === 0) continue;
      slots.age[s]++;
      const x = slots.x[s], y = slots.y[s], z = slots.z[s], dx = slots.dx[s], dy = slots.dy[s], dz = slots.dz[s];
      let d = slots.speed[s] * dt;
      const remain = slots.range[s] - slots.travelled[s], last = d >= remain;
      if (last) d = remain;
      const nx = x + dx * d, ny = y + dy * d, nz = z + dz * d;
      sweepSegment(world, targets, slots.pad[s], x, y, z, nx, ny, nz, hit);
      if (hit.kind === TARGET_HIT) {
        const e = targets.ent[hit.idx], p = hitPayload;
        let hl = Math.sqrt(dx * dx + dy * dy); if (hl < 1e-6) hl = 1;
        p.target = e.id; p.damage = slots.damage[s]; p.knock = 0; p.freezeSec = slots.stun[s];
        p.dirX = dx / hl; p.dirY = dy / hl; p.px = hit.x; p.py = hit.y; p.pz = hit.z;
        finish(s, hit.x, hit.y, hit.z, true);
        events.emit('combat:hit', p);
        if (slots.splash[s] > 0) splashFreeze(s, e, hit.x, hit.y);
        continue;
      }
      if (hit.kind === WORLD_HIT) { finish(s, hit.x, hit.y, hit.z, false); continue; }
      slots.x[s] = nx; slots.y[s] = ny; slots.z[s] = nz; slots.travelled[s] += d;
      if (last) finish(s, nx, ny, nz, false);
    }
  }
  return {
    slots,
    get alive() { return alive; }, get cooldown() { return cooldown; }, get castTick() { return castTick; }, get refused() { return refused; }, get tick() { return tick; },
    /** Quickbar key tap: 'cast' (queued for the next step) or 'busy' (cooldown / already queued). Mana is checked at the cast. */
    requestTap() { if (cooldown > 0 || pendingTap) return 'busy'; pendingTap = true; return 'cast'; },
    /** @param {any} player entity data; (ax,ay,az) = unit 3D aim */
    step(player, ax, ay, az) {
      tick++;
      if (cooldown > 0) cooldown--;
      if (pendingTap) { pendingTap = false; cast(player, ax, ay, az); }
      if (alive > 0) flight();
    },
    dispose() {},
    hashInto(hh) {
      hh.u32(cooldown); hh.u32(pendingTap ? 1 : 0); hh.u32(alive);
      for (let s = 0; s < MAXN; s++) { hh.u32(slots.alive[s]); if (slots.alive[s] === 0) continue; hh.f64(slots.x[s]); hh.f64(slots.y[s]); hh.f64(slots.z[s]); hh.f64(slots.travelled[s]); }
    },
  };
}
