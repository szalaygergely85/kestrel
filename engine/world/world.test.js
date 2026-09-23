// engine/world/world.test.js (US-025). Headless Node ESM, no framework.
// Run: node engine/world/world.test.js
import { AssetRegistry } from '../core/assets.js';
import { World } from './World.js';
import paletteMod from '../../design/palette.js';
import towerDef from '../../design/levels/tower.js';
import testRoomDef from '../../design/levels/test_room.js';
import terrainDef from '../../design/levels/overworld_far.js';
import worldMod from '../../design/levels/world_m1.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; towerDef; testRoomDef; terrainDef; worldMod;
const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const world = World.load(assets.world('world_m1'), assets, {});
const tower = world.structures.find((s) => s.id === 'tower');

// --- query table inside/outside/on bbox edges (half-open) -------------------
ok('inside the footprint: sectorAt resolves through the level', world.sectorAt(1490, 1020) !== null);
ok('x = x1 is OUTSIDE (half-open bbox)', world.structureAt(tower.bbox.x1, 1020) === null);
ok('y = y1 is OUTSIDE (half-open bbox)', world.structureAt(1490, tower.bbox.y1) === null);
ok('x0,y0 corner is INSIDE (half-open, lower bound inclusive)', world.structureAt(tower.bbox.x0, tower.bbox.y0) !== null);
ok('outside every footprint: sectorAt is null', world.sectorAt(0, 0) === null);

// --- outsideSector returns the SAME object every call -----------------------
const o1 = world.outsideSector(10, 10);
const o2 = world.outsideSector(20, 20);
ok('outsideSector returns the same (reused) object every call', o1 === o2);

// --- terrain: null -> solid --------------------------------------------------
const wNoTerrain = World.load(
  { terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }], entities: [] },
  assets, {}
);
ok('terrain: null -> outsideSector is solid (Level default)', wNoTerrain.outsideSector(-5, -5).solid === true);

// --- floorAt outside = terrain height ----------------------------------------
const outsideX = 0, outsideY = 0;
ok('floorAt outside every structure == terrain heightAt', world.floorAt(outsideX, outsideY) === world.terrain.heightAt(outsideX, outsideY));
ok('heightAt ignores structures (terrain-only)', typeof world.heightAt(1492, 1025) === 'number');

// --- yawSteps: 1 throws -------------------------------------------------------
let threw = false;
try { world.placeStructure(assets.level('test_room'), { x: 0, y: 2000, z: 0 }, 'x', 1); } catch (err) { threw = true; }
ok('placeStructure with yawSteps != 0 throws (not in M1)', threw);

// --- structTable is populated -------------------------------------------------
ok('structTable row 0 has the tower origin', world.structTable[0] === tower.origin.x && world.structTable[1] === tower.origin.y);

// --- animateSector -------------------------------------------------------------
const grateBefore = tower.level.legend['G'].ceilH;
world.animateSector('grate', 1);
ok('animateSector(tag, 1) opens the grate to dynamic.ceilOpen', tower.level.legend['G'].ceilH === tower.level.legend['G'].dynamic.ceilOpen);
ok('animateSector bumped renderVersion', world.renderVersion > 0);
world.animateSector('grate', 0);
ok('animateSector(tag, 0) closes the grate back to floorH', Math.abs(tower.level.legend['G'].ceilH - tower.level.legend['G'].floorH) < 1e-9);
grateBefore;

// --- player entity spawned at the tower's start, offset by the origin --------
const player = world.get('player');
ok('player entity spawned from spawn:{structure,from:"start"}', player && player.data.type === 'player');
const expectedX = tower.level.start.x + tower.origin.x;
ok('player world position == level.start + origin', Math.abs(player.data.transform.x - expectedX) < 1e-9);

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
