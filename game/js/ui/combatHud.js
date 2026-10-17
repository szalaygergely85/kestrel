// HPBAR-02 / DMGNUM-01 host: wires the enemy bars + floating damage numbers to the beast sim, `combat:hit` and the frame camera.
// main.js only calls: createCombatHud (once), hud.sim(beasts) on world load, hud.frame(...) + hud.draw(ui, hidden) per frame.
import { frameMatrix } from '../../../engine/index.js';
import { STATE_WANDER, STATE_EAT, STATE_RETURN, STATE_DYING, STATE_CORPSE } from '../quest/sim/beastSim.js';
import { KINDS, KIND_NAMES } from '../quest/sim/beastKinds.js';
import { createEnemyBarView } from './enemyBarView.js';
import { createDamageNumbers } from './damageNumbers.js';

const PROJ_NEAR = 0.05; // = engine/render/projection.js PROJ_NEAR (not re-exported)
const STEP_HZ = 60; // beastSim hurtT counts 60 Hz steps

/** Fills the reused beast record for slot i (HPBAR-01 contract). Exported for the test. */
export function fillBeastRecord(sim, i, rec, px, py, now, targetId, drawn = null) {
  const e = sim.entities[i], t = e.transform, h = e.components.health, br = e.components.brain || {};
  const st = sim.state[i], dx = t.x - px, dy = t.y - py;
  rec.id = sim.ids[i]; rec.name = KINDS[KIND_NAMES[sim.kindIdx[i]]].name;
  rec.x = t.x; rec.y = t.y; rec.z = t.z + 1.0;
  rec.spawnX = sim.homeX[i]; rec.spawnY = sim.homeY[i];
  rec.hp = h ? h.hp : 0; rec.maxHp = h ? h.max : 0;
  rec.dead = st === STATE_DYING || st === STATE_CORPSE || sim.dormant[i] !== 0;
  rec.dist = Math.sqrt(dx * dx + dy * dy);
  rec.visible = drawn ? drawn(e) === true : true; // GOB-INVIS: an undrawn beast (hidden / unknown model / cut by the voxel cap) gets no bar; on-screen / in-front is decided by project() in the view
  rec.engaged = st !== STATE_WANDER && st !== STATE_EAT && st !== STATE_RETURN;
  rec.targeted = targetId !== null && rec.id === targetId;
  rec.hitAt = now - sim.hurtT[i] / STEP_HZ;
  rec.level = br.level > 0 ? br.level : 0; rec.bossName = br.bossName || '';
  return rec;
}

/** VISQA-22: terrain line of sight from the eye to a point. groundAt(x, y) -> metres or null. Samples the segment (last 10 % skipped: the point may stand on a slope). */
export function terrainSees(groundAt, ex, ey, ez, x, y, z, steps = 14) {
  if (!groundAt) return true;
  for (let k = 1; k < steps; k++) {
    const f = k / steps; if (f > 0.9) break;
    const g = groundAt(ex + (x - ex) * f, ey + (y - ey) * f);
    if (g !== null && g !== undefined && g > ez + (z - ez) * f + 0.2) return false;
  }
  return true;
}

export function createCombatHud({ events, rgb, band = null, hurtAnchor, groundAt = null, drawn = null } = {}) {
  let ex = 0, ey = 0, ez = 0;
  const M = new Float64Array(16);
  let gridCols = 1, gridRows = 1, uiCols = 160, uiRows = 60, ready = false;
  const project = (x, y, z, out) => {
    if (!ready) return false;
    // local twin of engine/render/projection.js projectPoint (not re-exported): column-major world -> clip -> cell
    const w = M[3] * x + M[7] * y + M[11] * z + M[15];
    if (w <= PROJ_NEAR) return false;
    const cx = (gridCols / 2) * ((M[0] * x + M[4] * y + M[8] * z + M[12]) / w) + gridCols / 2, cy = (gridRows / 2) * ((M[1] * x + M[5] * y + M[9] * z + M[13]) / w) + gridRows / 2;
    out.c = cx * uiCols / gridCols; out.r = cy * uiRows / gridRows;
    return true;
  };
  const bars = createEnemyBarView({ rgb, project, band, seen: groundAt ? (x, y, z) => terrainSees(groundAt, ex, ey, ez, x, y, z) : null });
  const nums = createDamageNumbers({ rgb, project, hurtAnchor });
  let lastT = -1, sim = null, px = 0, py = 0, targetId = null, now = 0;
  const fill = (i, rec) => fillBeastRecord(sim, i, rec, px, py, now, targetId, drawn);
  const off = events ? events.on('combat:hit', (p) => nums.onHit(p)) : null;
  return {
    bars, nums,
    /** world:loaded -> the new beast sim (or null) */
    setSim(s) { sim = s; nums.reset(); },
    /** once per rendered frame before draw: camera pose, scene grid {cols, rows}, UI grid, player position, lock-on id, clock (s), dt (s). */
    frame(cam, grid, ui, playerX, playerY, lockId, timeSec) {
      const dt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, timeSec - lastT)); lastT = timeSec;
      frameMatrix(cam, grid, M); ex = cam.x; ey = cam.y; ez = cam.z; gridCols = grid.cols; gridRows = grid.rows; uiCols = ui.cols; uiRows = ui.rows; ready = true;
      px = playerX; py = playerY; targetId = lockId; now = timeSec;
      bars.update(sim ? sim.entities.length : 0, fill, now, dt, band ? band.bandAt(px, py) : 1);
      nums.step(dt);
    },
    draw(ui, hidden) { bars.draw(ui, hidden); nums.draw(ui, hidden); },
    dispose() { if (off) off(); },
  };
}
