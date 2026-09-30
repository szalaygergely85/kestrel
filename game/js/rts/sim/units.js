// game/js/rts/sim/units.js - RTS-01a sim state (docs/architecture.md 28.8). Struct-of-arrays, typed arrays only
// (so a state hash can be added later without restructuring). Unit id = array index = steer slot = instance source.
// No z and no yaw here: z is read from the terrain at render time, yaw is presentation (ui/unitsView.js).

export const TEAM_OWN = 1;     // selectable by the player
export const TEAM_ENEMY = 2;   // idle, never selectable in the spike
export const STATE_IDLE = 0;
export const STATE_MOVING = 1;
export const UNIT_RADIUS = 0.5;  // m, pick cylinder radius + separation radius
export const UNIT_HEIGHT = 1.6;  // m, pick cylinder height (matches unitModel.js)
export const PATH_SLOTS = 32;    // waypoint slots per unit (A* groups, RTS-01b)

/**
 * @param {number} max capacity
 */
export function createUnits(max) {
  return {
    max,
    count: 0,
    tick: 0,
    x: new Float64Array(max), y: new Float64Array(max),
    prevX: new Float64Array(max), prevY: new Float64Array(max),
    tx: new Float64Array(max), ty: new Float64Array(max),
    team: new Uint8Array(max), state: new Uint8Array(max),
    pathOff: new Int32Array(max), pathLen: new Int32Array(max), pathPos: new Int32Array(max),
    stall: new Uint16Array(max), // ticks in a row moving below 0.3 m/s (arrival by blockage)
    pathPool: new Float64Array(max * PATH_SLOTS * 2), // waypoints (x,y) of A* groups: pathLen of them at pathOff + 2k
  };
}

/** Adds one idle unit; returns its id. */
export function addUnit(u, x, y, team) {
  if (u.count >= u.max) throw new Error('addUnit: capacity exceeded');
  const i = u.count++;
  u.x[i] = x; u.y[i] = y; u.prevX[i] = x; u.prevY[i] = y; u.tx[i] = x; u.ty[i] = y;
  u.team[i] = team; u.state[i] = STATE_IDLE;
  u.pathOff[i] = i * PATH_SLOTS * 2; u.stall[i] = 0; u.pathLen[i] = 0; u.pathPos[i] = 0;
  return i;
}
