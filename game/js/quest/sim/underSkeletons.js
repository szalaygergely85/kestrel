// UNDER-01 (OB-191, arch 38.75 item 4): skeletons that rise at night at the cemetery and idle in one ruin. Pure + deterministic (rule 15: no Math.random,
// trig or wall clock; the caller passes dt and the hour). The skeleton entities are spawned by regionalBeasts.spawnUnderSkeletons as a RESERVE group
// (slots start down); this spawner wakes them (setDown false + `rise` clip window) and sends them back at dawn. The spawn director does NOT own them.
// MAIN SESSION wiring (NEEDS B1-main): once per fixed step `cemetery.step(dt, px, py, pz, fx, fy, hour)` per site in UNDER_SITES (state = world.state),
// after beasts.step. beastView plays `rise` from sim.riseMs[slot] (Float32Array, created here).
import { STATE_DYING, STATE_SINK, STATE_GONE, STATE_EAT } from './beastSim.js';
import { isNightHour } from '../../audio/forestAmbience.js';

/** Cemetery sits in the downs band 2: tier 2 = level 5 (tower-side skeletons 3-5, kinds lv [3,10]); the ruin keeps its own zone band (whitecombs 5). */
export const CEMETERY_TIER = 2;
export const RISE_MS = 1200, WAKE_R = 30, NO_POP_R = 8, SAME_STRUCT_DZ = 3, VIEW_COS = 0.5;
/** Sites. members: [id, species, dx, dy] (home = anchor + d). `night` sites are reserve groups; the ruin pair idles any time. */
export const UNDER_SITES = Object.freeze([
  Object.freeze({ id: 'cemetery', anchor: [1644, 1372], night: true, group: 'under.cemetery', members: Object.freeze([
    ['skelwar.cemetery.1', 'skelwar', -3, 1], ['skelwar.cemetery.2', 'skelwar', 3, 2], ['skelarch.cemetery.1', 'skelarch', 0, -3]]) }),
  // UNDER-02: the crypt under the cemetery (any time of day; z = crypt floor, so the spawner's |dz| < 3 m rule keeps them apart from the surface cemetery)
  Object.freeze({ id: 'crypt', anchor: [1674.5, 1357.5], z: -56.8, night: false, group: '', members: Object.freeze([
    ['skelwar.crypt.1', 'skelwar', -2, 4.5], ['skelarch.crypt.1', 'skelarch', 2, 6], // room 2
    ['skelwar.crypt.2', 'skelwar', -2, -4], ['skelwar.crypt.3', 'skelwar', 2, -6], ['skelarch.crypt.2', 'skelarch', 0, -5]]) }), // room 3
  // UNDER-04 (OB-191): the bear den in the northwood hillside (any time of day; z = chamber floor). ONE black bear 'sleeps' = temperament 'wary' (calm: notices at 5 m only, leash 12 m, full aggro once hit; no sleep state in beastSim)
  Object.freeze({ id: 'bearDen', anchor: [1584, 432], z: 11.76, night: false, group: '', members: Object.freeze([['bear.bearDen.1', 'bear', 0, 0]]) }),
  // UNDER-05 (OB-191): the Long Strand sea cave (any time of day; z = chamber floor). TWO tortoises (wary = calm, no aggro) on the floor of the chamber.
  Object.freeze({ id: 'strandCave', anchor: [1618.5, 1726], z: -95.31, night: false, group: '', members: Object.freeze([['turtle.strandCave.1', 'turtle', -2.5, 0.5], ['turtle.strandCave.2', 'turtle', 2.2, -0.8]]) }),
  // UNDER-06 (OB-191): goblin tunnel stash room between campNorth and campEast (3 goblins, any time of day; z = tunnel stash floor, so the dz < 3 m rule keeps them off the surface)
  Object.freeze({ id: 'goblinTunnel', anchor: [945.5, 946], z: -88.8, night: false, group: '', members: Object.freeze([
    ['archer.goblinTunnel.1', 'archer', -2, 1.5], ['torch.goblinTunnel.1', 'torch', 2, 1.5], ['archer.goblinTunnel.2', 'archer', 0, -1.5]]) }),
  // existing OB-141 ruin POI ob141r06 (whitecombs arch at 1740,200, far side, zone band 5 = level 5)
  Object.freeze({ id: 'ruinWhite', anchor: [1740, 200], night: false, group: '', members: Object.freeze([
    ['skelwar.ruinWhite.1', 'skelwar', -2, 2], ['skelarch.ruinWhite.1', 'skelarch', 2, 3]]) }),
]);

const deadSt = (st) => st >= STATE_DYING && st <= STATE_GONE && st !== STATE_EAT;
export const key = (id, what) => `under.${id}.${what}`;

/**
 * @param {{sim:any, site:typeof UNDER_SITES[number], state:object, structureAt?:(x:number,y:number)=>any}} o
 * Save flags in `state`: under.<id>.night (night counter), under.<id>.dead ({n, ids}) - killed ones stay dead until the next night.
 */
export function createUnderSpawner({ sim, site, state, structureAt }) {
  const slots = [], ids = [], homes = [];
  for (const m of site.members) { const s = sim.slotOf(m[0]); if (s >= 0) { slots.push(s); ids.push(m[0]); homes.push([site.anchor[0] + m[2], site.anchor[1] + m[3]]); } }
  const n = slots.length;
  if (!sim.riseMs || sim.riseMs.length < sim.count) sim.riseMs = new Float32Array(sim.count);
  const awake = new Uint8Array(n), deadNow = new Uint8Array(n), sinking = new Uint8Array(n);
  const siteZ = n ? sim.entities[slots[0]].transform.z : 0;
  const S = { slots, ids, awake, wakes: 0, lastNight: null, siteZ };
  S.nightN = () => state[key(site.id, 'night')] || 0;
  const loadDead = () => { // dead record of THIS night only
    const rec = state[key(site.id, 'dead')], cur = S.nightN();
    for (let k = 0; k < n; k++) deadNow[k] = rec && rec.n === cur && rec.ids.indexOf(ids[k]) >= 0 ? 1 : 0;
  };
  const saveDead = () => { const l = []; for (let k = 0; k < n; k++) if (deadNow[k]) l.push(ids[k]); state[key(site.id, 'dead')] = { n: S.nightN(), ids: l }; };
  loadDead();
  S.inRange = (px, py, pz, hx, hy) => { // arch 38.75: same structure + |dz| < 3 m, never a flat radius alone
    const dx = hx - px, dy = hy - py;
    if (dx * dx + dy * dy > WAKE_R * WAKE_R) return false;
    if (Math.abs(pz - siteZ) >= SAME_STRUCT_DZ) return false;
    return !structureAt || structureAt(px, py) === structureAt(hx, hy);
  };
  S.step = (dt, px, py, pz, fx, fy, hour) => {
    for (let k = 0; k < n; k++) { const s = slots[k]; if (sim.riseMs[s] > 0) { sim.riseMs[s] -= dt * 1000; if (sim.riseMs[s] < 0) sim.riseMs[s] = 0; } }
    if (!site.night || !n) return;
    const night = isNightHour(hour);
    if (S.lastNight === null) { S.lastNight = night; if (night && !S.nightN()) state[key(site.id, 'night')] = 1; loadDead(); }
    else if (night !== S.lastNight) {
      S.lastNight = night;
      if (night) { state[key(site.id, 'night')] = S.nightN() + 1; deadNow.fill(0); awake.fill(0); saveDead(); } // a new night: killed ones come back
    }
    for (let k = 0; k < n; k++) {
      const s = slots[k], st = sim.state[s];
      if (awake[k] && !deadNow[k] && !sinking[k] && !sim.down[s] && deadSt(st) && st !== STATE_GONE) { deadNow[k] = 1; saveDead(); } // killed: stays dead till next night
      if (night) {
        if (awake[k]) continue;
        const hx = homes[k][0], hy = homes[k][1];
        if (deadNow[k] || !S.inRange(px, py, pz, hx, hy)) continue;
        const dx = hx - px, dy = hy - py, d2 = dx * dx + dy * dy;
        if (d2 < NO_POP_R * NO_POP_R && dx * fx + dy * fy > VIEW_COS * Math.sqrt(d2)) continue; // never pop in within 8 m in view: wait until it is out of view
        if (!sim.down[s]) sim.setDown(s, true); // corpse / gone leftovers of an earlier night: park, then wake fresh (hp restored)
        sim.setDown(s, false); sim.riseMs[s] = RISE_MS; awake[k] = 1; sinking[k] = 0; S.wakes++;
      } else if (awake[k] && !deadNow[k]) { // dawn: the living sink back
        if (!sinking[k]) { sinking[k] = 1; if (!sim.down[s] && !deadSt(st)) { sim.state[s] = STATE_SINK; sim.timer[s] = sim.cfgSteps.sink; sim.deathZ[s] = sim.entities[s].transform.z; sim.steer.vx[s] = 0; sim.steer.vy[s] = 0; } }
        else if (st === STATE_GONE && !sim.down[s]) { sim.setDown(s, true); awake[k] = 0; sinking[k] = 0; }
      }
    }
  };
  return S;
}
