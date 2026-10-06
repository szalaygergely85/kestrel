// ART-01a Node tests for `buildRoofMap`/`outdoorAt` (docs/architecture.md
// 37.18 item 3). Duck-typed world fixtures - no World.load, so the tests pin
// exactly the fields the roof map reads.
import { buildRoofMap, outdoorAt, MAX_ROOF_BOXES } from './roofMap.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL:', name); } }

function makeLevel(w, h, fn) {
  return { width: w, height: h, sectorAt(x, y) { const cx = Math.floor(x), cy = Math.floor(y); return fn(cx, cy); } };
}
function makeStruct(level, origin, packedVersion = 1) {
  return { kind: 'level', level, origin, packed: { version: packedVersion } };
}
function makeWorld(structs, structVersion = 1) {
  return { structVersion, structures: structs };
}

const open = (ceilH) => ({ solid: false, ceilH });
const solidCell = { solid: true, floorH: 2, ceilH: 3 };
const skyCell = { solid: false, ceilH: 'sky' };

// ---- sky / solid / numeric ceil -------------------------------------------
{
  const level = makeLevel(3, 1, (cx) => [skyCell, solidCell, open(3)][cx]);
  const map = buildRoofMap(makeWorld([makeStruct(level, { x: 0, y: 0, z: 0 })]));
  check('single box: count 1, atlasW 3, atlasH 1', map.count === 1 && map.atlasW === 3 && map.atlasH === 1 && map.data.length === 3);
  check('sky ceiling cell -> outdoor', outdoorAt(map, 0.5, 0.5, 1000) === 1);
  check('solid cell -> outdoor', outdoorAt(map, 1.5, 0.5, 1000) === 1);
  check('numeric ceil below ceiling -> indoor', outdoorAt(map, 2.5, 0.5, 2.9) === 0);
  check('numeric ceil above ceiling -> outdoor', outdoorAt(map, 2.5, 0.5, 3.5) === 1);
}
// ---- ceiling face indoor, roof top outdoor ---------------------------------
{
  const level = makeLevel(1, 1, () => ({ solid: false, ceilH: 3, topH: 4 }));
  const map = buildRoofMap(makeWorld([makeStruct(level, { x: 0, y: 0, z: 0 })]));
  check('ceiling face (z == ceilH) is indoor', outdoorAt(map, 0.5, 0.5, 3) === 0);
  check('roof top (z == topH) is outdoor', outdoorAt(map, 0.5, 0.5, 4) === 1);
}
// ---- outer wall via P + N*0.05 outdoor, inner face indoor ------------------
{
  const level = makeLevel(2, 2, () => open(3));
  const map = buildRoofMap(makeWorld([makeStruct(level, { x: 0, y: 0, z: 0 })]));
  // P on the west face (x = 0), normal outwards: sample just outside the box.
  check('outer wall (P + N*0.05, N = -x) is outdoor', outdoorAt(map, 0 - 0.05, 0.5, 1.5) === 1);
  // Inner face sample stays inside the box -> below the 3 m ceiling -> indoor.
  check('inner wall (P + N*0.05, N = +x) is indoor', outdoorAt(map, 0 + 0.05, 0.5, 1.5) === 0);
}
// ---- two boxes --------------------------------------------------------------
{
  const levelA = makeLevel(2, 2, () => open(3));
  const levelB = makeLevel(2, 2, () => open(5));
  const map = buildRoofMap(makeWorld([
    makeStruct(levelA, { x: 0, y: 0, z: 0 }),
    makeStruct(levelB, { x: 10, y: 0, z: 0 }),
  ]));
  check('two boxes: count 2, atlasW max w, atlasH summed', map.count === 2 && map.atlasW === 2 && map.atlasH === 4 && map.data.length === 8);
  check('two boxes: yOff stacks rows', map.yOff[0] === 0 && map.yOff[1] === 2);
  check('box A: above its 3 m ceiling -> outdoor', outdoorAt(map, 0.5, 0.5, 3.5) === 1);
  check('box B: below its 5 m ceiling -> indoor', outdoorAt(map, 10.5, 0.5, 4.0) === 0);
  check('box B: above its 5 m ceiling -> outdoor', outdoorAt(map, 10.5, 0.5, 6.0) === 1);
  check('between boxes (no box) -> outdoor', outdoorAt(map, 5, 0.5, 0) === 1);
}
// ---- rebuild only on version change + no allocation on same size ------------
{
  const level = makeLevel(2, 2, () => open(3));
  const struct = makeStruct(level, { x: 0, y: 0, z: 0 }, 1);
  const world = makeWorld([struct], 1);
  const m1 = buildRoofMap(world);
  const m1again = buildRoofMap(world, m1);
  check('unchanged version -> same map object returned (no rebuild)', m1again === m1);

  struct.packed.version = 2; // sector animation: same geometry, version bump
  const m2 = buildRoofMap(world, m1);
  check('version bump -> rebuilt (new object)', m2 !== m1);
  check('rebuilt version tracks structVersion + packed.version', m2.version === world.structVersion + 2);
  check('same size -> data/buffers reused (no allocation)', m2.data === m1.data && m2.box === m1.box && m2.yOff === m1.yOff);
  check('same size -> data still correct after reuse', outdoorAt(m2, 0.5, 0.5, 3.5) === 1 && outdoorAt(m2, 0.5, 0.5, 2.0) === 0);

  // Size grows (a second, wider structure) -> a fresh, larger data array.
  const wide = makeLevel(5, 1, () => open(4));
  const world2 = makeWorld([struct, makeStruct(wide, { x: 0, y: 10, z: 0 }, 1)], 2);
  const m3 = buildRoofMap(world2, m2);
  check('size growth -> new data array (larger atlas)', m3.data !== m2.data && m3.data.length === 5 * 3);
  check('MAX_ROOF_BOXES exported', MAX_ROOF_BOXES === 8);
}

console.log(`roofMap.test.js: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
