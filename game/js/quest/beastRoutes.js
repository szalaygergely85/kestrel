// BEAST-07 (D-083/D-087, arch 38.64 item 8): roaming routes + day/night sets for the spawn-director groups.
// Lives in the quest wire layer: beastSim is untouched, groups walk by its existing sim.setGoal/atGoal/clearGoal (LIFE-08).
// - assignRoutes: seeded 3..6 waypoint loop per group, every waypoint (and every 4 m of each leg) on walkable ground.
// - createRouteFollower: leader walks the loop, the others follow it; the leader holds when one lags > HOLD_DIST (cohesion <= 8 m).
// - Night set: groups with `when: 'night'` are parked by day, unparked at 20:00 and parked again from 05:00, each only while
//   out of view (director.canSpawnAt, the never-in-view rule). NIGHT-PLACEHOLDER: night groups use today's kinds until undead models exist.
import { makeWalkable, REGION_RULES } from './sim/regionalBeasts.js';
import { findPath } from '../../../engine/index.js';
import { hashU } from '../life/schedule.js';

export const HOLD_DIST = 6, COHESION = 8, CHECK_STEPS = 30, NIGHT_FROM = 20, NIGHT_TO = 5;
const REPLAN_M = 1.5, RING = 1.5; // BEAST-07b: ring+arrive (3 m, beastSim GOAL_ARRIVE_R) must stay < HOLD_DIST or the leader waits forever on a follower that "arrived"
// 16 literal unit directions (no trig: deterministic everywhere)
const D16 = [[1, 0], [0.9239, 0.3827], [0.7071, 0.7071], [0.3827, 0.9239], [0, 1], [-0.3827, 0.9239], [-0.7071, 0.7071], [-0.9239, 0.3827],
  [-1, 0], [-0.9239, -0.3827], [-0.7071, -0.7071], [-0.3827, -0.9239], [0, -1], [0.3827, -0.9239], [0.7071, -0.7071], [0.9239, -0.3827]];
function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Walkable predicate from the terrain (water + slope, same rule as the regional generator); no typeAt -> everything is ground. */
export function walkableFor(terrain, bounds) { return terrain && typeof terrain.typeAt === 'function' ? makeWalkable(terrain, bounds || null) : () => true; }

function legWalkable(walkable, ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 4);
  for (let i = 1; i < n; i++) if (!walkable(ax + (bx - ax) * i / n, ay + (by - ay) * i / n)) return false;
  return true;
}

/** BEAST-07b: region rect [x0,y0,x1,y1] of a region id (generator rule override first, e.g. Whitecombs foot), or null. */
export function regionRectOf(geo) {
  return (id) => { const rule = REGION_RULES.find((r) => r.region === id && r.rect); if (rule) return rule.rect; const g = geo && geo.regions && geo.regions.find((r) => r.id === id); return g ? g.r : null; };
}

/**
 * BEAST-07b: reach(ax,ay,bx,by) over the REAL beast nav ({grid, astar} from buildBeastNav / the band tile): an exact A* path (not partial)
 * within the sim's TRAVEL_MAX_NODES. Points outside the grid (a far group while another band tile is live) are trusted: the sim re-plans on tile swap.
 */
export function reachFor(nav) {
  if (!nav || !nav.grid || !nav.astar) return null;
  const grid = nav.grid, buf = new Int32Array(grid.w * grid.h);
  return (ax, ay, bx, by) => {
    const sx = grid.cellX(ax), sy = grid.cellY(ay), gx = grid.cellX(bx), gy = grid.cellY(by);
    if (!grid.inBounds(sx, sy) || !grid.inBounds(gx, gy)) return true;
    if (sx === gx && sy === gy) return true;
    return findPath(nav.astar, sx, sy, gx, gy, buf, { maxNodes: 3000 }) > 0 && !nav.astar.partial;
  };
}

/**
 * Pure + deterministic in (seed, gid, home, walkable, opt). Returns [[x,y] x3..6], first leg starts at home.
 * opt: { rect?: [x0,y0,x1,y1] (waypoints clamped 2 m inside), reach?: (ax,ay,bx,by)=>bool (every leg incl. the closing one must be reachable; an
 * unreachable candidate is replaced by the next seeded retry) }.
 */
export function routeFor(group, seed, walkable, opt) {
  const rect = opt && opt.rect, reach = opt && opt.reach;
  const cl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const gh = strHash(group.gid), home = group.home, np = 3 + (hashU(seed, gh, 7) % 4);
  const radius = group.cls === 'grazer' ? 40 : 90; // arch: grazer loop 40-120 m, packs patrol; keep inside the region
  const route = [];
  let px = home[0], py = home[1];
  for (let p = 0; p < np; p++) {
    let found = null;
    for (let t = 0; t < 24 && !found; t++) { // retries shrink the radius so a lake-side group still finds ground
      const h = hashU(seed ^ 0x51ed, gh + p * 131, t + 1), d = D16[h & 15], r = radius * (0.4 + ((h >>> 4) & 255) / 255 * 0.8) * (1 - t * 0.035);
      let x = Math.round((home[0] + d[0] * r) * 2) / 2, y = Math.round((home[1] + d[1] * r) * 2) / 2;
      if (rect) { x = cl(x, rect[0] + 2, rect[2] - 2); y = cl(y, rect[1] + 2, rect[3] - 2); }
      if (walkable(x, y) && legWalkable(walkable, px, py, x, y) && (!reach || (reach(px, py, x, y) && (p < np - 1 || reach(x, y, route[0] ? route[0][0] : home[0], route[0] ? route[0][1] : home[1]))))) found = [x, y];
    }
    if (found) { route.push(found); px = found[0]; py = found[1]; }
  }
  while (route.length < 3) route.push([home[0], home[1]]); // no ground at all: sit at home (home itself is walkable)
  return route;
}

/** Replace route on every non-parked group (POI fight groups stay put). Returns the groups. */
export function assignRoutes(groups, seed, walkable, opt) {
  for (const g of groups) if (!g.park) g.route = routeFor(g, seed, walkable, opt && { rect: opt.rectOf ? opt.rectOf(g.region) : null, reach: opt.reach || null });
  return groups;
}

export const isNightHour = (h) => h >= NIGHT_FROM || h < NIGHT_TO;

/**
 * o: { sim, groups, dir (spawn director), hour: () => game hour 0..24 }.  step(px,py,fx,fy) per sim tick.
 * sim needs: steer.x/y, state, isDown?, isDormant?, setGoal, atGoal, setDown (night groups).
 */
export function createRouteFollower(o) {
  const { sim, groups, dir } = o, N = groups.length;
  const wp = new Int16Array(N), holdUntil = new Int32Array(N), active = new Uint8Array(N).fill(1), isNightGroup = new Uint8Array(N);
  let tick = 0, hourNow = 12;
  for (let g = 0; g < N; g++) if (groups[g].when === 'night') { isNightGroup[g] = 1; active[g] = 0; }
  // A tile-dormant slot has no live steer agent, so setDown would mark it down=1 and the later unpark would re-add the agent in the WRONG slot (addAgent = lowest free).
  // Wake it first (clears both dormancy reasons, re-activates the agent) so setDown parks it as down=2 and unparking is exact; tile dormancy re-applies on the next tile update.
  const park = (g, on) => { for (const s of groups[g].slots) { if (!sim.parkSlot) continue; if (on) sim.parkSlot(s); else sim.unparkSlot(s); } };
  const usable = (s) => !(sim.isDown && sim.isDown(s)) && !(sim.isDormant && sim.isDormant(s));
  const goalTo = (s, x, y) => { // re-plan only when the target moved: setGoal restarts the path
    if (sim.hasGoal ? sim.hasGoal(s) : true) { const dx = sim.goalTX ? sim.goalTX[s] - x : 99, dy = sim.goalTY ? sim.goalTY[s] - y : 99; if (dx * dx + dy * dy < REPLAN_M * REPLAN_M) return; }
    sim.setGoal(s, x, y);
  };
  const F = {
    active, wp, isNight: () => isNightHour(hourNow),
    /** Start-up: night groups wait parked until 20:00. */
    init() { hourNow = o.hour(); for (let g = 0; g < N; g++) if (isNightGroup[g]) { park(g, true); active[g] = 0; } }, // any hour: step() brings them in (unseen) once it is night
    step(px, py, fx, fy) {
      if (++tick % CHECK_STEPS !== 0 || !sim.steer) return;
      hourNow = o.hour();
      const night = isNightHour(hourNow);
      for (let g = 0; g < N; g++) {
        const gr = groups[g];
        if (gr.park || dir.dead[g]) continue;
        if (isNightGroup[g]) {
          if (night && !active[g]) { if (dir.canSpawnAt(gr.home[0], gr.home[1], px, py, fx, fy)) { park(g, false); active[g] = 1; wp[g] = 0; } continue; }
          if (!night && active[g]) { // dawn: vanish only while unseen (leader position)
            const l = gr.slots.find(usable), x = l === undefined ? gr.home[0] : sim.steer.x[l], y = l === undefined ? gr.home[1] : sim.steer.y[l];
            if (dir.canSpawnAt(x, y, px, py, fx, fy)) { park(g, true); active[g] = 0; }
            continue;
          }
          if (!active[g]) continue;
        }
        F.moveGroup(g);
      }
    },
    moveGroup(g) {
      const gr = groups[g], route = gr.route, slots = gr.slots;
      if (!route || route.length < 2) return;
      let leader = -1;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (!usable(s)) continue;
        if (sim.isEngaged(s)) return; // someone is fighting: combat owns the group
        if (leader < 0) leader = s;
      }
      if (leader < 0) return;
      const lx = sim.steer.x[leader], ly = sim.steer.y[leader];
      let lag = 0, k = 0;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i]; if (s === leader || !usable(s)) continue;
        const d = Math.hypot(sim.steer.x[s] - lx, sim.steer.y[s] - ly); if (d > lag) lag = d;
        const o2 = D16[(k++ * 5) & 15]; goalTo(s, lx + o2[0] * RING, ly + o2[1] * RING);
      }
      if (lag > HOLD_DIST) { goalTo(leader, lx, ly); return; } // wait for the stragglers
      const w = route[wp[g]];
      if (holdUntil[g] === 0) {
        goalTo(leader, w[0], w[1]);
        if (sim.atGoal(leader)) holdUntil[g] = tick + CHECK_STEPS * (8 + (hashU(wp[g], g, 3) % 8)); // graze/rest 8-15 s
      } else if (tick >= holdUntil[g]) { holdUntil[g] = 0; wp[g] = (wp[g] + 1) % route.length; }
    },
  };
  return F;
}
