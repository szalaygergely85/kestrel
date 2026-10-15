// SPELL-07: Gust. 60 degree cone (half angle: cos = COS30) in front of the player: beasts get a heavy `combat:hit` (knock + damage per tier;
// the beast sim staggers on a heavy hit), loose physics props (hooks.forEachProp(fn(entity))) get an impulse <= PROP_MAX m/s via applyImpulse.
// LOS: a wall between the player and the target blocks it. The cast is queued and consumed by the next step(player, fx, fy) (facing lives there).
// Rule 15: no trig (cos 30 deg is a constant), 0 allocation per cast/step. Numbers: spellDefs.js only.
import { SPELL_DEFS } from '../spellDefs.js';
import { applyImpulse, SIM_STEP } from '../../../../engine/index.js';

export const COS30 = 0.8660254037844387;
export const PROP_MAX = 8; // m/s impulse ceiling for props
const EYE = 1.2; // m above the feet: cone origin / LOS start
/** @param {any} world @param {any} events @param {any} targets createTargetables() @param {{spendMana?:(n:number)=>boolean, tier?:()=>number, forEachProp?:(fn:Function)=>void}} [hooks] */
export function createGustSim(world, events, targets, hooks) {
  const tiers = SPELL_DEFS.gust.tiers;
  let cooldown = 0, pending = false, castTick = -1000000, tick = 0, hits = 0, propHits = 0;
  const seg = new Float64Array(6), ray = { t: 0, x: 0, y: 0, z: 0 };
  const hitP = { source: 'player', target: null, damage: 0, heavy: 1, cause: 'wind', knock: 0, dirX: 0, dirY: 0, px: 0, py: 0, pz: 0 };
  const castP = { x: 0, y: 0, z: 0, fx: 0, fy: 0, range: 0 };
  let row = null;
  const O = new Float64Array(5); // ox, oy, oz, fx, fy (typed array: a closure-captured double would allocate a HeapNumber per write)

  /** true if the cylinder (x,y,z..z+h, radius r) is inside the cone, in range and in line of sight. */
  function inCone(x, y, z, r, h) {
    const dx = x - O[0], dy = y - O[1], d = Math.sqrt(dx * dx + dy * dy);
    if (d - r > row.range) return false;
    if (d > 1e-6 && (dx * O[3] + dy * O[4]) < COS30 * d) return false; // outside the 60 degree cone
    if (d > 1e-6) {
      seg[0] = O[0]; seg[1] = O[1]; seg[2] = O[2]; seg[3] = x; seg[4] = y; seg[5] = z + h * 0.5;
      const ddz = seg[5] - O[2], L = Math.sqrt(d * d + ddz * ddz);
      if (world.raySegmentRay(seg, ray) && ray.t * L < L - r - 0.05) return false; // a wall in between
    }
    return true;
  }
  function propVisit(e) {
    const b = e.components && e.components.body;
    if (!b) return;
    const tr = e.transform;
    if (!inCone(tr.x, tr.y, tr.z, 0.3, 0.6)) return;
    const dx = tr.x - O[0], dy = tr.y - O[1], d = Math.sqrt(dx * dx + dy * dy), k = row.knock < PROP_MAX ? row.knock : PROP_MAX;
    applyImpulse(b, tr.z, (d > 1e-6 ? dx / d : O[3]) * k, (d > 1e-6 ? dy / d : O[4]) * k, k * 0.25);
    propHits++;
  }
  function fire(player) {
    const t = player.transform;
    O[0] = t.x; O[1] = t.y; O[2] = t.z + EYE;
    targets.refresh();
    for (let i = 0; i < targets.count; i++) {
      if (targets.r[i] < 0) continue;
      const e = targets.ent[i];
      if (e === player || e.id === 'player') continue;
      if (!inCone(targets.x[i], targets.y[i], targets.z[i], targets.r[i], targets.h[i])) continue;
      const dx = targets.x[i] - O[0], dy = targets.y[i] - O[1], d = Math.sqrt(dx * dx + dy * dy), p = hitP;
      p.target = e.id; p.damage = row.dmg; p.knock = row.knock;
      p.dirX = d > 1e-6 ? dx / d : O[3]; p.dirY = d > 1e-6 ? dy / d : O[4];
      p.px = targets.x[i]; p.py = targets.y[i]; p.pz = targets.z[i] + targets.h[i] * 0.5;
      events.emit('combat:hit', p);
      hits++;
    }
    if (hooks && typeof hooks.forEachProp === 'function') hooks.forEachProp(propVisit);
  }
  return {
    get cooldown() { return cooldown; },
    get castTick() { return castTick; },
    get hits() { return hits; },
    get propHits() { return propHits; },
    /** quickbar entry: -> 'cast' (queued) | 'busy'. Mana is spent when the cast executes (next step); no mana = nothing happens. */
    requestCast() { if (cooldown > 0 || pending) return 'busy'; pending = true; return 'cast'; },
    step(player, fx, fy) {
      tick++;
      if (cooldown > 0) cooldown--;
      if (!pending) return;
      pending = false;
      if (cooldown > 0) return;
      const t = hooks && typeof hooks.tier === 'function' ? hooks.tier() | 0 : 1;
      row = tiers[(t < 1 ? 1 : t > 3 ? 3 : t) - 1];
      if (!(hooks && typeof hooks.spendMana === 'function' ? hooks.spendMana(row.mana) : true)) return;
      cooldown = Math.round(row.cd / SIM_STEP); castTick = tick;
      O[3] = fx; O[4] = fy;
      const tr = player.transform;
      castP.x = tr.x; castP.y = tr.y; castP.z = tr.z + EYE; castP.fx = fx; castP.fy = fy; castP.range = row.range;
      events.emit('gust:cast', castP);
      fire(player);
    },
    hashInto(h) { h.u32(cooldown); h.u32(pending ? 1 : 0); h.u32(castTick & 0x7fffffff); },
  };
}
