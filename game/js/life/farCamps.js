// game/js/life/farCamps.js (WMP-02, D-072): goblin camps in the far regions, generated (seeded, deterministic) like WM-12 regional beasts.
// Output = camp defs in the same shape as content/life/goblinCamps.json, so goblinCamps.js (dormancy, kill-all save keys
// life.camp.<id>.cleared/.day/.down, respawn, morale) is reused unchanged. Rule 15: pure, no Math.random / clock.
// Slot order (beastSim slots follow entity order): authored beasts + authored camps, regional beasts (WM-12), then these far camps.
import { makeWalkable, inPolygon } from '../quest/sim/regionalBeasts.js';

/** One camp per rule. `pick` = band-fit reason: dead-tree ash country, pine hill, twisted heath coast. */
export const FAR_CAMP_RULES = Object.freeze([
  { region: 'ashMile', key: 'ashMile', roles: ['melee', 'melee', 'melee', 'thrower'] },
  { region: 'signalHill', key: 'signalHill', roles: ['melee', 'melee', 'melee', 'thrower', 'thrower'] },
  { region: 'westHeath', key: 'heath', roles: ['melee', 'melee', 'melee', 'thrower'] },
]);
export const RELAY_GAP = 60, BEAST_GAP = 40, CAMP_GAP = 60, EDGE = 30, LEASH_R = 25, RESPAWN_DAYS = 3, TRIES = 800;

function mulberry32(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Relay sites (t 'L') of world_geo. */
export function relaySites(geo) { return (geo.sites || []).filter((s) => s.t === 'L').map((s) => [s.x, s.y]); }

/**
 * @param {{geo:any, terrain:any, seed?:number, avoid?:Array<[number,number]>}} o  avoid = every beast home (authored + regional + authored camps)
 * @returns camp defs: {id, at, leashR, respawnDays, region, props, members}
 */
export function generateFarCamps(o) {
  const { geo, terrain } = o, seed = o.seed ?? 12, avoid = o.avoid || [];
  const walkable = makeWalkable(terrain, geo.bounds), relays = relaySites(geo);
  const out = [];
  for (const rule of FAR_CAMP_RULES) {
    const reg = geo.regions.find((g) => g.id === rule.region);
    if (!reg) continue;
    const r = reg.r, rng = mulberry32(seed ^ strHash('farcamp.' + rule.key));
    // every member ends up inside bounds + region, so keep the centre EDGE (> leash share) clear of the rect
    const inReg = (x, y) => x > r[0] && x < r[2] && y > r[1] && y < r[3] && inPolygon(geo.bounds.pts, x, y);
    for (let t = 0; t < TRIES; t++) {
      const x = Math.round(r[0] + EDGE + rng() * (r[2] - r[0] - 2 * EDGE)), y = Math.round(r[1] + EDGE + rng() * (r[3] - r[1] - 2 * EDGE));
      if (!walkable(x, y)) continue;
      if (relays.some((p) => Math.hypot(p[0] - x, p[1] - y) < RELAY_GAP)) continue;
      if (avoid.some((p) => Math.hypot(p[0] - x, p[1] - y) < BEAST_GAP)) continue;
      if (out.some((c) => Math.hypot(c.at[0] - x, c.at[1] - y) < CAMP_GAP)) continue;
      const members = []; // 3-7 m ring around the brazier, each on walkable ground in the region
      for (let k = 0; k < rule.roles.length && members.length === k; k++) {
        for (let u = 0; u < 40; u++) {
          const a = rng() * 6.283185307, d = 3 + rng() * 4, ox = Math.round(Math.cos(a) * d * 2) / 2, oy = Math.round(Math.sin(a) * d * 2) / 2;
          if (inReg(x + ox, y + oy) && walkable(x + ox, y + oy)) { members.push({ id: `gobF.${rule.key}.${k + 1}`, role: rule.roles[k], at: [ox, oy] }); break; }
        }
      }
      if (members.length < rule.roles.length) continue;
      out.push({ id: `campFar.${rule.key}`, region: rule.region, at: [x, y], leashR: LEASH_R, respawnDays: RESPAWN_DAYS, props: [{ model: 'brazier', at: [0, 0], yaw: 0 }], members });
      break;
    }
  }
  return out;
}
