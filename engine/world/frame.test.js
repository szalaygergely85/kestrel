// engine/world/frame.test.js (CO-2, docs/coordinates.md 4/11/10 items 3-4 for
// yawSteps = 0, z != 0). Run: node engine/world/frame.test.js
import { World } from './World.js';
import { gridLocal } from './gridLocal.js';
import { makeFrame, worldToLocal, localToWorld } from '../core/transform.js';
import { registerBehaviour, unregisterBehaviour } from '../core/behaviours.js';
import { buildLightSet } from '../render/lighting.js';
import paletteMod from '../../design/palette.js';
import terrainDef from '../../design/levels/overworld_far.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; terrainDef; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; voxelPropsMod;
farTowerMod; ferrumLightsMod;
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- a structure at a non-zero origin with z = -3 (terrain-less world) ------
const OX = 1000, OY = 1000, OZ = -3;
const wz = World.load({
  terrain: null,
  structures: [{ id: 'tw', level: 'tower', origin: { x: OX, y: OY, z: OZ }, yawSteps: 0 }],
  entities: [{ id: 'p1', type: 'player', spawn: { structure: 'tw', from: 'start' } }, { id: 'free', type: 'thing', x: 5, y: 6, z: 1 }],
}, assets, {});
const placed = wz.structures[0];

ok('placed.frame is the authored Frame', placed.frame.x === OX && placed.frame.y === OY && placed.frame.z === OZ && placed.frame.yawSteps === 0);
ok('frameOf(id) returns placed.frame', wz.frameOf('tw') === placed.frame);
ok('frameOf(unknown) is null', wz.frameOf('nope') === null);
ok('placed.bbox = frameBBox (yawSteps 0)', placed.bbox.x0 === OX && placed.bbox.y0 === OY && placed.bbox.x1 === OX + placed.level.width && placed.bbox.y1 === OY + placed.level.height);

// gridLocal vs worldToLocal round trip
const g = { x: 0, y: 0, z: 0 }, wl = { x: 0, y: 0, z: 0 }, back = { x: 0, y: 0, z: 0 };
let same = true;
for (const [lx, ly] of [[0.5, 0.5], [3.25, 7.75], [12, 4], [23.5, 13.5]]) {
  const wx = OX + lx, wy = OY + ly;
  World.gridLocal(placed, wx, wy, g);
  worldToLocal(placed.frame, wx, wy, 0, wl);
  localToWorld(placed.frame, g.x, g.y, 0, back);
  if (g.x !== wl.x || g.y !== wl.y || g.x !== lx || g.y !== ly || back.x !== wx || back.y !== wy) same = false;
}
ok('gridLocal == worldToLocal (x,y) and round-trips through localToWorld', same);
ok('gridLocal out.z is the height base (frame.z)', g.z === OZ && gridLocal(placed, 1, 1, g) === g);

// world queries offset by z = -3
const lvSec = placed.level.sectorAt(16, 6);
ok('sectorAt through gridLocal', wz.sectorAt(OX + 16, OY + 6) === lvSec);
ok('floorAt = level floorH + frame.z', wz.floorAt(OX + 16, OY + 6) === lvSec.floorH + OZ);
ok('ceilAt = level ceilH + frame.z (or sky)', wz.ceilAt(OX + 16, OY + 6) === (lvSec.ceilH === 'sky' ? 'sky' : lvSec.ceilH + OZ));

// content items converted through the frame
const ldef = placed.level.def;
let itemsOk = ldef.interactables.length > 0;
for (const it of ldef.interactables) {
  const rec = wz.interactables.find((r) => r.id === it.id);
  if (!rec || rec.x !== OX + it.x || rec.y !== OY + it.y || rec.z !== it.z + OZ) itemsOk = false;
}
ok('interactables = local + frame (z = -3)', itemsOk);
const circles = wz.triggers.filter((t) => t.structId === 'tw' && t.shape === 'circle');
ok('circle triggers = local + frame (x,y,zMin)', circles.every((t) => t.x === OX + t.def.x && t.y === OY + t.def.y && (typeof t.def.zMin !== 'number' || t.zMin === t.def.zMin + OZ)));
const ls = buildLightSet(wz, paletteMod);
let lightsOk = ldef.lights.length > 0;
for (const ld of ldef.lights) {
  const i = ls.key.indexOf(`tw.${ld.id}`);
  if (i < 0 || ls.pos[4 * i] !== Math.fround(OX + ld.x) || ls.pos[4 * i + 1] !== Math.fround(OY + ld.y) || ls.pos[4 * i + 2] !== Math.fround(ld.z + OZ)) lightsOk = false;
}
ok('lights = local + frame', lightsOk);
const propEnt = ldef.props.map((p) => ({ p, e: wz.entity(`tw.${p.id}`) })).find((r) => r.e && r.p.z !== 'ground' && typeof r.p.z === 'number');
ok('prop transform = local + frame, z offset by -3', !!propEnt && propEnt.e.transform.x === OX + propEnt.p.x && propEnt.e.transform.z === propEnt.p.z + OZ);
const start = placed.level.start;
const pl = wz.entity('p1');
ok('spawn.from start: world position through the frame', pl.transform.x === OX + start.x && pl.transform.y === OY + start.y &&
  pl.transform.z === (placed.level.floorAt(start.x, start.y) ?? 0) + OZ);

// ---- entity.parent ----------------------------------------------------------
ok('prop entity.parent = structId', propEnt.e.parent === 'tw');
ok('spawn.structure entity parent = structId', pl.parent === 'tw');
ok('free world entity parent = null', wz.entity('free').parent === null);
ok('world.spawn default parent = null', wz.entity(wz.spawn('thing', { x: 0, y: 0, z: 0 }).id).parent === null);

// ---- ctx.frame for behaviours ----------------------------------------------
let seen;
registerBehaviour('co2.probe', (ctx) => { seen = ctx.frame; });
wz.fireTrigger('co2.probe', { structId: 'tw' });
ok('ctx.frame = the structure frame when structId is set', seen === placed.frame);
wz.fireTrigger('co2.probe', { structId: null });
ok('ctx.frame = null for a world-level trigger', seen === null);
unregisterBehaviour('co2.probe');

// ---- world.sun ---------------------------------------------------------------
// CO-8 (docs/coordinates.md section 8): real level content no longer carries
// `sun` (moved to the world file) - the level-sun FALLBACK mechanism itself
// (an ephemeral `?level=` world with no world file) is still real engine
// behaviour, exercised here with a synthetic sun temporarily injected into
// the shared `tower` level def (restored immediately after) rather than via
// real content.
const towerLevelDef = assets.level('tower');
const savedTowerSun = towerLevelDef.sun;
towerLevelDef.sun = { preset: 'sun', elevation: 21, azimuth: 99 };
const wzFallback = World.load({ terrain: null, structures: [{ id: 'tw', level: 'tower', origin: { x: 0, y: 0, z: 0 } }], entities: [] }, assets, {});
ok('ephemeral world without sun: level sun fallback', wzFallback.sun === towerLevelDef.sun && wzFallback.sunSource === 'level');
towerLevelDef.sun = savedTowerSun;
ok('ephemeral world, level has no sun (real content, post-CO-8): world.sun null', wz.sun === null && wz.sunSource === null);
const wSun = World.load({ terrain: null, sun: { preset: 'sun', elevation: 33, azimuth: 44 }, structures: [{ id: 'tw', level: 'tower', origin: { x: 0, y: 0, z: 0 } }], entities: [] }, assets, {});
ok('def.sun wins and is world-sourced', wSun.sun.elevation === 33 && wSun.sunSource === 'world');
const lsSun = buildLightSet(wSun, paletteMod);
ok('buildLightSet reads world.sun', lsSun.sun.elevation === 33 && lsSun.sun.azimuth === 44);
const wNone = World.load({ terrain: null, structures: [], entities: [] }, assets, {});
ok('no structures, no sun: world.sun null', wNone.sun === null && wNone.sunSource === null);

// ---- recipe bbox + ringHAt injected by id ------------------------------------
const wm = World.load(assets.world('world_m1'), assets, {});
const tower = wm.structures.find((s) => s.id === 'tower');
const rs = wm.terrain.recipe.structures.find((s) => s.id === 'tower');
ok('recipe structure gets bbox from placed.bbox', rs.bbox && rs.bbox.x0 === tower.bbox.x0 && rs.bbox.y0 === tower.bbox.y0 && rs.bbox.x1 === tower.bbox.x1 && rs.bbox.y1 === tower.bbox.y1);
ok('recipe structure gets ringHAt', typeof rs.ringHAt === 'function' && typeof rs.ringHAt(tower.bbox.x0 - 5, tower.bbox.y0 + 3) === 'number');
// CO-8: world_m1.world.json now carries its own `sun` (moved out of
// content/levels/tower.level.json) - def.sun wins, no level fallback.
ok('world_m1 world: def.sun wins, world-sourced (CO-8 sun move)', wm.sun === assets.world('world_m1').sun && wm.sunSource === 'world');

// ringHAt at z != 0: shifted structure lifts the ring height by frame.z
const wz2 = World.load({ terrain: null, structures: [{ id: 'tw', level: 'tower', origin: { x: 0, y: 0, z: 0 } }, { id: 'tw3', level: 'tower', origin: { x: 500, y: 500, z: OZ } }], entities: [] }, assets, {});
ok('two placements of one level coexist', wz2.frameOf('tw3').z === OZ && wz2.floorAt(500 + 16, 500 + 6) === wz2.floorAt(16, 6) + OZ);

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
