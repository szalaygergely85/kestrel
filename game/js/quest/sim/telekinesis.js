// SPELL-R3 (D-115 / EP-SPELLS Telekinesis L1-2, was SPELL-07 Gust): push / pull the NEAREST valid target in a 30 degree half-angle cone
// (cos = COS30) with LOS. Candidates: beasts (combat:hit knock + stagger, dmg 0) and roller props (hooks.forEachProp(fn(entity)) -> applyImpulse <= PROP_MAX).
// Input: requestCast() = key went down (cooldown check only); step(player, fx, fy, down) with the key state: released before HOLD_SEC = push, after = pull
// (toward the player, stops PULL_STOP m short). Mana/cooldown are spent when the cast executes (release); refusals spend nothing.
// Level 2: a pushed beast that reaches a wall within WALL_SEC takes row.wallDmg once (x INT damageMul). Level 3 lift/throw is SPELL-R7.
// Rule 15: no trig, 0 allocation per cast/step. Numbers: spellDefs.js only.
import { SPELL_DEFS } from '../spellDefs.js';
import { applyImpulse, SIM_STEP } from '../../../../engine/index.js';

export const COS30 = 0.8660254037844387;
export const PROP_MAX = 8; // m/s impulse ceiling for props
export const HOLD_SEC = 0.4; // hold >= this on release = pull
export const PULL_STOP = 1.5; // m a pulled target stops short of the player
export const WALL_SEC = 0.5;  // window for the Lv2 wall-impact damage
const BEAST_DECEL = 12, PROP_DECEL = 6; // m/s^2: beast stagger slide (beastSim DEFAULT_ACCEL) / rough roller friction; pull speed = sqrt(2 a (d - stop))
const EYE = 1.2; // m above the feet: cone origin / LOS start
const HOLD_STEPS = Math.round(HOLD_SEC / SIM_STEP), WALL_STEPS = Math.round(WALL_SEC / SIM_STEP);
/** @param {any} world @param {any} events @param {any} targets createTargetables() @param {{spendMana?:(n:number)=>boolean, tier?:()=>number, forEachProp?:(fn:Function)=>void, damageMul?:()=>number}} [hooks] */
export function createTelekinesisSim(world, events, targets, hooks) {
  const tiers = SPELL_DEFS.telekinesis.tiers;
  let cooldown = 0, armed = false, held = 0, castTick = -1000000, tick = 0, hits = 0, propHits = 0, pulls = 0, wallHits = 0;
  const seg = new Float64Array(6), ray = { t: 0, x: 0, y: 0, z: 0 };
  const hitP = { source: 'player', target: null, damage: 0, heavy: 1, cause: 'wind', knock: 0, stunSec: 0, dirX: 0, dirY: 0, px: 0, py: 0, pz: 0 };
  const castP = { x: 0, y: 0, z: 0, fx: 0, fy: 0, range: 0, pull: 0 };
  let row = null, bestProp = null;
  const O = new Float64Array(5); // ox, oy, oz, fx, fy (typed array: a closure-captured double would allocate a HeapNumber per write)
  const B = new Float64Array(2); // best distance: [0] prop, [1] beast
  // Lv2 wall watch (one pushed beast): entity, deadline tick, push dir, INT multiplier
  let wEnt = null, wEnd = 0; const W = new Float64Array(3); // dirX, dirY, dmgMul

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
    if (!b || !e.components.roller) return; // roller props only
    const tr = e.transform;
    if (!inCone(tr.x, tr.y, tr.z, 0.3, 0.6)) return;
    const dx = tr.x - O[0], dy = tr.y - O[1], d = Math.sqrt(dx * dx + dy * dy);
    if (d < B[0]) { B[0] = d; bestProp = e; }
  }
  /** speed for a pull, limited so the slide ends PULL_STOP short of the player; 0 = too close to pull. */
  function pullSpeed(knock, d, decel) {
    const room = d - PULL_STOP;
    if (room <= 0) return 0;
    const v = Math.sqrt(2 * decel * room);
    return v < knock ? v : knock;
  }
  function fire(player, pull) {
    const t = player.transform;
    O[0] = t.x; O[1] = t.y; O[2] = t.z + EYE;
    targets.refresh();
    B[0] = B[1] = 1e9; bestProp = null;
    let bi = -1;
    for (let i = 0; i < targets.count; i++) {
      if (targets.r[i] < 0) continue;
      const e = targets.ent[i];
      if (e === player || e.id === 'player') continue;
      if (!inCone(targets.x[i], targets.y[i], targets.z[i], targets.r[i], targets.h[i])) continue;
      const dx = targets.x[i] - O[0], dy = targets.y[i] - O[1], d = Math.sqrt(dx * dx + dy * dy);
      if (d < B[1]) { B[1] = d; bi = i; }
    }
    if (hooks && typeof hooks.forEachProp === 'function') hooks.forEachProp(propVisit);
    if (bi < 0 && !bestProp) return;
    const dmgMul = hooks && typeof hooks.damageMul === 'function' ? hooks.damageMul() : 1; // INT boosts every damage spell
    if (bi >= 0 && B[1] <= B[0]) { // nearest valid target = a beast
      const dx = targets.x[bi] - O[0], dy = targets.y[bi] - O[1], d = B[1], p = hitP;
      let ux = d > 1e-6 ? dx / d : O[3], uy = d > 1e-6 ? dy / d : O[4], knock = row.knock;
      if (pull) { knock = pullSpeed(knock, d, BEAST_DECEL); ux = -ux; uy = -uy; if (knock < 1) return; } // beastSim: knock < 1 = flinch only
      p.target = targets.ent[bi].id; p.damage = row.dmg * dmgMul; p.heavy = 1; p.knock = knock; p.stunSec = row.stagger;
      p.dirX = ux; p.dirY = uy; p.px = targets.x[bi]; p.py = targets.y[bi]; p.pz = targets.z[bi] + targets.h[bi] * 0.5;
      events.emit('combat:hit', p);
      hits++;
      if (pull) pulls++;
      else if (row.wallDmg > 0) { wEnt = targets.ent[bi]; wEnd = tick + WALL_STEPS; W[0] = ux; W[1] = uy; W[2] = dmgMul; }
    } else { // a roller prop
      const e = bestProp, b = e.components.body, tr = e.transform, d = B[0];
      const dx = tr.x - O[0], dy = tr.y - O[1];
      let ux = d > 1e-6 ? dx / d : O[3], uy = d > 1e-6 ? dy / d : O[4], k = row.knock < PROP_MAX ? row.knock : PROP_MAX;
      if (pull) { k = pullSpeed(k, d, PROP_DECEL); ux = -ux; uy = -uy; if (k <= 0) return; }
      applyImpulse(b, tr.z, ux * k, uy * k, k * 0.25);
      propHits++;
      if (pull) pulls++;
    }
  }
  /** Lv2: a pushed beast with a wall within its radius + 0.4 m along the push direction, inside WALL_SEC -> wallDmg once. */
  function wallWatch() {
    if (!wEnt) return;
    if (tick > wEnd || (wEnt.components.health && wEnt.components.health.hp <= 0)) { wEnt = null; return; }
    const tr = wEnt.transform, tg = wEnt.components.targetable, reach = (tg ? tg.radius : 0.3) + 0.4;
    seg[0] = tr.x; seg[1] = tr.y; seg[2] = tr.z + 0.5; seg[3] = tr.x + W[0] * reach; seg[4] = tr.y + W[1] * reach; seg[5] = seg[2];
    if (!world.raySegmentRay(seg, ray)) return;
    const p = hitP;
    p.target = wEnt.id; p.damage = row.wallDmg * W[2]; p.knock = 0; p.stunSec = 0; p.heavy = 0;
    p.dirX = W[0]; p.dirY = W[1]; p.px = tr.x; p.py = tr.y; p.pz = tr.z + 0.5;
    events.emit('combat:hit', p);
    wEnt = null; wallHits++;
  }
  return {
    get cooldown() { return cooldown; },
    get castTick() { return castTick; },
    get hits() { return hits; },
    get propHits() { return propHits; },
    get pulls() { return pulls; },
    get wallHits() { return wallHits; },
    get holding() { return armed; },
    /** quickbar entry (key went down): -> 'cast' (armed; executes on release) | 'busy'. No mana is spent here. */
    requestCast() { if (cooldown > 0 || armed) return 'busy'; armed = true; held = 0; return 'cast'; },
    /** down = the spell key is still held. Release before HOLD_SEC = push, after = pull. */
    step(player, fx, fy, down) {
      tick++;
      if (cooldown > 0) cooldown--;
      wallWatch();
      if (!armed) return;
      if (down === true) { held++; return; }
      armed = false;
      if (cooldown > 0) return;
      const t = hooks && typeof hooks.tier === 'function' ? hooks.tier() | 0 : 1;
      row = tiers[(t < 1 ? 1 : t > 3 ? 3 : t) - 1];
      if (!(hooks && typeof hooks.spendMana === 'function' ? hooks.spendMana(row.mana) : true)) return;
      cooldown = Math.round(row.cd / SIM_STEP); castTick = tick;
      O[3] = fx; O[4] = fy;
      const pull = held >= HOLD_STEPS;
      const tr = player.transform;
      castP.x = tr.x; castP.y = tr.y; castP.z = tr.z + EYE; castP.fx = fx; castP.fy = fy; castP.range = row.range; castP.pull = pull ? 1 : 0;
      events.emit('telekinesis:cast', castP);
      fire(player, pull);
    },
    hashInto(h) { h.u32(cooldown); h.u32(armed ? 1 : 0); h.u32(held); h.u32(castTick & 0x7fffffff); h.u32(wEnt ? 1 : 0); },
  };
}
