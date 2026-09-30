// game/js/rts/ui/unitsView.js - RTS-01a render-side unit view (28.8). Per rendered frame: interpolate sim x/y with
// `alpha`, stand on the terrain (z = groundAt at render time, never read by the sim), smooth the facing (yaw is
// presentation: atan2 lives here, not in sim/), write `engine.instances` (one group per team, id order) and the
// pick arrays. Zero allocation per frame.
import { writeUnitInstance, UNIT_OBJECT_BASE, shortestArcDeg, yawFromDelta } from '../../../../engine/index.js';
import { TEAM_OWN, TEAM_ENEMY, UNIT_RADIUS, UNIT_HEIGHT } from '../sim/units.js';

const TURN_DEG_PER_S = 720; // 180 deg in 0.25 s (RTS-01b b2)
const BODY_MID = UNIT_HEIGHT * 0.5;

/**
 * @param {any} engine
 * @param {{terrain:{groundAt:(x:number,y:number)=>number}}} world
 * @param {ReturnType<import('../sim/units.js').createUnits>} units
 * @param {string} modelKey
 */
export function createUnitsView(engine, world, units, modelKey) {
  const max = units.max;
  const groups = [null, engine.instances.group(modelKey, max), engine.instances.group(modelKey, max)]; // by team 1, 2
  const view = {
    groups,
    /** interpolated base points (stride 3) - `pickNearest` input */
    pos: new Float64Array(max * 3),
    /** body-centre points (stride 3, z + half height) - `selectInRect` input */
    posBody: new Float64Array(max * 3),
    radii: new Float64Array(max).fill(UNIT_RADIUS),
    heights: new Float64Array(max).fill(UNIT_HEIGHT),
    yaw: new Float64Array(max),
    onScreen: 0,
    /** @param {number} alpha sim interpolation factor  @param {number} dtSec frame dt (yaw smoothing only) */
    update(alpha, dtSec) {
      const n = units.count, X = units.x, Y = units.y, PX = units.prevX, PY = units.prevY, T = units.team;
      const g = world.terrain, pos = view.pos, body = view.posBody, yaw = view.yaw;
      const maxTurn = TURN_DEG_PER_S * dtSec;
      let c1 = 0, c2 = 0;
      for (let i = 0; i < n; i++) {
        const dx = X[i] - PX[i], dy = Y[i] - PY[i];
        const x = PX[i] + dx * alpha, y = PY[i] + dy * alpha;
        const z = g.groundAt(x, y);
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        body[i * 3] = x; body[i * 3 + 1] = y; body[i * 3 + 2] = z + BODY_MID;
        if (dx * dx + dy * dy > 1e-8) { // moving: turn towards the step direction (compass yaw, 0 = -y)
          const d = shortestArcDeg(yaw[i], yawFromDelta(dx, dy));
          yaw[i] += d > maxTurn ? maxTurn : d < -maxTurn ? -maxTurn : d;
        }
        const team = T[i];
        const grp = groups[team];
        const slot = team === TEAM_OWN ? c1++ : c2++;
        writeUnitInstance(grp.ib, slot, x, y, z, yaw[i], UNIT_OBJECT_BASE | i, team);
      }
      groups[TEAM_OWN].count = c1;
      groups[TEAM_ENEMY].count = c2;
    },
    dispose() { engine.instances.remove(groups[1]); engine.instances.remove(groups[2]); },
  };
  // deterministic initial facing from the id (presentation only)
  for (let i = 0; i < max; i++) view.yaw[i] = (i * 137.508) % 360;
  return view;
}
