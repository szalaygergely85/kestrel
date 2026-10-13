// tools/step-probe.mjs (STEP-HEIGHT-01). Headless Node. Lists adjacent walkable 1 m cells in and around the tower
// whose floor height delta is > stepUpMax but < 1.2 m (looks climbable, is not), and whether a real mesh capsule
// pushed from the lower to the higher cell is blocked.   node tools/step-probe.mjs
import {
  World, PHYSICS_DEFAULTS,
} from '../engine/index.js';
import paletteMod from '../design/palette.js';
import detailPassMod from '../design/detail-pass.js';
import terrainDef from '../design/levels/overworld_far.js';
import lanternMod from '../design/models/lantern.js';
import leverMod from '../design/models/lever.js';
import voxelPropsMod from '../design/models/voxel_props.js';
import boulderMod from '../design/models/boulder.js';
import rubbleMod from '../design/models/rubble.js';
import wreckageMod from '../design/models/wreckage.js';
import relayMod from '../design/models/relay.js';
import swordMod from '../design/models/sword.js';
import m3PropsMod from '../design/models/m3_props.js';
import farTowerMod from '../design/models/far_tower.js';
import ferrumLightsMod from '../design/models/ferrum_lights.js';
import titleMod from '../design/models/title.js';
import voxelWorldMod from '../design/models/voxel_world.js';
import { raycastColliders } from '../engine/dev.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { registerQuestBehaviours } from '../game/js/quest/index.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; terrainDef; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod; relayMod;
detailPassMod; swordMod; m3PropsMod;
farTowerMod; ferrumLightsMod; titleMod; voxelWorldMod;
const { assets } = await loadTestAssets();
registerQuestBehaviours();
const P = PHYSICS_DEFAULTS, O = { x: 1480, y: 1018 };
const world = World.load(assets.world('world_m1'), assets, { physics: 'mesh' });
const opts = { height: P.height, stepUpMax: P.stepUpMax, walkCos: Math.cos(P.maxSlopeDeg * Math.PI / 180) }, o = {};
const X0 = -8, X1 = 32, Y0 = -8, Y1 = 26, S = 0.5, hit = {};
// real mesh floor height: ray straight down from 1 m above the nominal floor (sector floorH / terrain) at (x, y)
const mz = (wx, wy) => {
  const sec = world.sectorAt(wx, wy); if (sec && sec.solid) return null;
  const f = world.floorAt(wx, wy); if (f == null) return null;
  return raycastColliders(world.colliders, world.colliders.length, wx, wy, f + 1.0, 0, 0, -1, 3, hit) ? f + 1.0 - hit.t : null;
};
const rows = [];
for (let y = Y0; y < Y1; y += S) for (let x = X0; x < X1; x += S) {
  const ax = O.x + x + 0.25, ay = O.y + y + 0.25, a = mz(ax, ay); if (a == null) continue;
  for (const [dx, dy] of [[S, 0], [0, S]]) {
    const b = mz(ax + dx, ay + dy); if (b == null) continue;
    const d = Math.abs(b - a);
    if (d <= P.stepUpMax + 1e-6 || d >= 1.2) continue;
    const loA = a < b, cx = loA ? ax : ax + dx, cy = loA ? ay : ay + dy, lz = Math.min(a, b);
    const ux = (loA ? dx : -dx), uy = (loA ? dy : -dy);
    const q = world.collideCircle(cx, cy, ux, uy, P.radius, lz, true, opts, o);
    const blocked = Math.hypot(q.x - cx - ux, q.y - cy - uy) > 0.05;
    rows.push({ at: [+(x + 0.25).toFixed(2), +(y + 0.25).toFixed(2)], dir: [ux, uy], loZ: +lz.toFixed(2), delta: +d.toFixed(2), blocked });
  }
}
const bl = rows.filter((r) => r.blocked);
console.log('stepUpMax', P.stepUpMax, 'candidate pairs (0.45 < delta < 1.2):', rows.length, 'capsule-blocked:', bl.length);
for (const r of bl) console.log(`local(${r.at}) dir(${r.dir}) lowZ ${r.loZ} delta ${r.delta}`);
