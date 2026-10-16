// FOOTIK-WIRE-FIX: the wire's ground comes from the world support query (floors), not bare terrain. Run: node game/js/dev/footIkWire.test.js
import { createFootIk, packVoxelModel, voxelPointWorld } from '../../../engine/index.js';
import { quadruped16 } from '../../../engine/dev.js';
import { createFootIkWire, createSupportGround } from '../look/footIkWire.js';

let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else { fail++; console.log('FAIL', m, x === undefined ? '' : x); } };
const def = { ...quadruped16, legRig: { body: 'body', legs: quadruped16.legRig.legs.slice(0, 2), gaits: { walk: { tunedMps: 1, duty: 0.6, phase: [0, 0.5], liftM: 0.1 } }, stand: ['idle'] } };
const pm = packVoxelModel(def, () => 1);
const footCells = def.legRig.legs.map((l) => l.foot);
const TERRAIN = 0, FLOOR = 0.2; // a placed floor 0.2 m above the terrain
// fake world: supportAtOut mirrors World (io in x,y,footZ; floorH at [3]) -> floor wins when it is within step-up reach of the probe z
const world = { supportAtOut(grounded, opts, io) { io[3] = io[2] >= FLOOR - opts.stepUpMax ? Math.max(TERRAIN, FLOOR) : TERRAIN; } };
const ground = createSupportGround(world);
ground.refZ = FLOOR;
ok('adapter returns the floor height under the player', ground.groundAt(1, 2) === FLOOR);
ground.refZ = -50; world.supportAtOut = () => {}; // NaN-ish io -> null
ground.refZ = FLOOR; world.supportAtOut = (g, o, io) => { io[3] = NaN; };
ok('no support -> null', ground.groundAt(0, 0) === null);
world.supportAtOut = (g, o, io) => { io[3] = io[2] >= FLOOR - o.stepUpMax ? FLOOR : TERRAIN; };

function run(g) {
  const poses = []; const ent = {};
  const inst = { model: pm, entity: ent, x: 1, y: 2, z: FLOOR, yawDeg: 0, clip: 0, frame: 0, tMs: 0, scale: 1, addPart: -1, legs: null };
  const pool = { _rawCount: 1, raw: [inst], legInstance: (i, p) => poses.push(p[0]) };
  const wire = createFootIkWire({ pool, createFootIk, voxelPointWorld, footCells, ground: g, offFor: () => false });
  for (let i = 0; i < 90; i++) wire.step(16.667);
  return wire.drv.poseOf(0)[0];
}
ok('floor 0.2 m above terrain: correction w stays 0', run(createSupportGround(world)) === 0);
ok('control: bare terrain ground would pull the feet down (w > 0)', run({ groundAt: () => TERRAIN }) > 0);
console.log(`${pass} passed, ${fail} failed.`); if (fail) process.exit(1);
