// game/js/rts/rts01a.test.js - RTS-01a Node checks on the real world_m1 (a3 placement, a4 model + view size).
// Run: node game/js/rts/rts01a.test.js (also by tools/run-tests.mjs).
import { World, validateVoxelModel, createPitchedTerms, pitchedTerms, worldToCell, createRtsCamera, updateRtsCamera } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailMod from '../../../design/detail-pass.js';
import terrainDef from '../../../design/levels/overworld_far.js';
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import voxelPropsMod from '../../../design/models/voxel_props.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
import swordMod from '../../../design/models/sword.js';
import m3PropsMod from '../../../design/models/m3_props.js';
import farTowerMod from '../../../design/models/far_tower.js';
import ferrumLightsMod from '../../../design/models/ferrum_lights.js';
import titleMod from '../../../design/models/title.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeUnitModelDef, teamSurfaceFraction, RTS_TEAM_SPEC, UNIT_SLOT_MAT } from './unitModel.js';
import { createUnits, TEAM_OWN, TEAM_ENEMY, UNIT_HEIGHT } from './sim/units.js';
import { buildNavGrid, PLAY_AREA } from './sim/navSetup.js';
import { placeUnits } from './sim/place.js';
import { simStep, createSim } from "./sim/tick.js";

globalThis.window = globalThis.window || globalThis;
paletteMod; detailMod; terrainDef; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod;
relayMod; swordMod; farTowerMod; ferrumLightsMod; titleMod;
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.error('FAIL', name, extra); } };

// ---- a4: model --------------------------------------------------------------------------------------------------
const def = makeUnitModelDef();
const v = validateVoxelModel(def.voxel, { materialKeys: Object.keys(assets.palette.materials) });
ok('unit model validates', v.errors.length === 0, v.errors.join('; '));
const sizeM = def.voxel.size.map((s) => s * def.voxel.cellM);
ok('unit ~0.8-1.0 m wide, 1.6-2 m tall', sizeM[0] >= 0.8 && sizeM[0] <= 1.0 && sizeM[2] >= 1.6 && sizeM[2] <= 2.0, sizeM.join('x'));
const tf = teamSurfaceFraction(def);
ok('team slot covers >= 40 % of the visible faces', tf.fraction >= 0.4, String(tf.fraction));
ok('team spec uses the slot material', RTS_TEAM_SPEC.slots[0] === UNIT_SLOT_MAT);
for (const t of RTS_TEAM_SPEC.teams) if (t) ok('team colour material exists', !!assets.palette.materials[t[UNIT_SLOT_MAT]]);

// ---- a3: placement on the real hillside -------------------------------------------------------------------------
const world = World.load(assets.world('world_m1'), assets, {});
const nav = buildNavGrid(world);
const PLACE = { cx: 1452, cy: 1040, radius: 40, minDist: 1.1 };
function place(seed, n) { const u = createUnits(n); const k = placeUnits(u, n, seed, nav, PLACE); return { u, k }; }
const { u, k } = place(0x5eed, 200);
ok('200 units placed', k === 200 && u.count === 200, String(k));
let own = 0, enemy = 0, minD = 1e9, badCell = 0, inTower = 0, outside = 0;
for (let i = 0; i < u.count; i++) {
  if (u.team[i] === TEAM_OWN) own++; else if (u.team[i] === TEAM_ENEMY) enemy++;
  const cx = nav.cellX(u.x[i]), cy = nav.cellY(u.y[i]);
  if (!nav.inBounds(cx, cy) || nav.cost[nav.index(cx, cy)] === 0) badCell++;
  if (world.structureAt(u.x[i], u.y[i])) inTower++;
  if (Math.hypot(u.x[i] - PLACE.cx, u.y[i] - PLACE.cy) > PLACE.radius + 1e-9) outside++;
  for (let j = 0; j < i; j++) minD = Math.min(minD, Math.hypot(u.x[i] - u.x[j], u.y[i] - u.y[j]));
}
ok('100 + 100 teams', own === 100 && enemy === 100, `${own}/${enemy}`);
ok('every unit on a walkable cell, none inside the tower, all in the disc', badCell === 0 && inTower === 0 && outside === 0, `${badCell}/${inTower}/${outside}`);
ok('min spacing >= 1.1 m', minD >= 1.1 - 1e-9, String(minD));
const again = place(0x5eed, 200).u;
let same = true;
for (let i = 0; i < 200; i++) if (again.x[i] !== u.x[i] || again.y[i] !== u.y[i]) same = false;
ok('seeded placement is deterministic', same);
const other = place(0x1234, 200).u;
ok('another seed differs', other.x[0] !== u.x[0] || other.y[0] !== u.y[0]);
ok('n = 20 and n = 500 fit', place(1, 20).k === 20 && place(1, 500).k > 0);

// ---- sim step keeps prev = cur (no movement in 01a) -------------------------------------------------------------
simStep(createSim(u, nav));
ok('simStep latches prev and counts ticks', u.tick === 1 && u.prevX[5] === u.x[5] && u.prevY[7] === u.y[7]);

// ---- a1/a4: unit screen size at min / default / max zoom, 400x150 and 240x90 -------------------------------------
// 16:9 window => cell px aspect pxCellH/pxCellW = 1.5 (cells are 4:6 px); measured with the real rtsCamera + pitched terms.
const terrain = world.terrain, groundAt = (x, y) => terrain.groundAt(x, y);
const sizes = {};
for (const [cols, rows] of [[400, 150], [240, 90]]) {
  const grid = { cols, rows, pxCellW: 1, pxCellH: 1.5 };
  const rts = createRtsCamera({ bounds: { x0: PLAY_AREA.x0, y0: PLAY_AREA.y0, x1: PLAY_AREA.x0 + PLAY_AREA.w, y1: PLAY_AREA.y0 + PLAY_AREA.h }, widthM: 30, heightFn: groundAt });
  rts.focusX = PLACE.cx; rts.focusY = PLACE.cy; rts.focusZ = groundAt(PLACE.cx, PLACE.cy);
  const cam = {}, terms = createPitchedTerms(), a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  for (const [label, zoom] of [['min', rts.opts.zoomMin], ['default', 1], ['max', rts.opts.zoomMax]]) {
    rts.zoom = zoom;
    for (let i = 0; i < 40; i++) updateRtsCamera(rts, 1 / 60, {}, grid, cam);
    pitchedTerms(cam, grid, terms);
    const fx = rts.focusX, fy = rts.focusY, fz = groundAt(fx, fy);
    worldToCell(terms, fx, fy, fz, a); worldToCell(terms, fx, fy, fz + UNIT_HEIGHT, b);
    // ground width across the screen at the centre row: columns apart for 1 m on the ground
    worldToCell(terms, fx + 1, fy, fz, c);
    const widthM = cols / Math.abs(c[0] - a[0]);
    sizes[`${cols}x${rows} ${label}`] = { rows: +(a[1] - b[1]).toFixed(2), widthM: +widthM.toFixed(1) };
  }
}
console.log('unit height in cells / ground width m:', JSON.stringify(sizes));
const def400 = sizes['400x150 default'];
ok('a1: ground width 25-35 m at 400x150 default', def400.widthM >= 25 && def400.widthM <= 35, JSON.stringify(def400));
ok('a4: unit 4-8 cells tall at 400x150 default', def400.rows >= 4 && def400.rows <= 8, JSON.stringify(def400));
ok('a4: unit >= 2 cells tall at 240x90 default', sizes['240x90 default'].rows >= 2, JSON.stringify(sizes['240x90 default']));

console.log(`rts01a.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
