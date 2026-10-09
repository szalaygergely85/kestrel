// MESH-QA-01 test: exact counts on a tiny fixture world (3 trees, 1 species, hand-made 1 m box meshes), plus determinism.
//   node tools/mesh-tri-budget.test.mjs
import { computeBudget, pickVariant, VARIANT_WEIGHTS } from './mesh-tri-budget.mjs';

let fails = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } else console.log(`ok - ${name}`);
};

const box = [-1, -1, 0, 1, 1, 2];
const meshes = {
  Pine_1: { family: 'Pine', tri0: 1000, tri1: 350, bbox0: box, bbox1: box },
  TwistedTree_1: { family: 'TwistedTree', tri0: 9000, tri1: null, bbox0: box, bbox1: null },
};
// camera at the origin looking -y (yaw 0, level). near (y -6), far (y -60), behind (y 10, frustum-culled), twisted (y 60, no LOD1)
const placements = {
  count: 4, x: [0, 0, 0, 0], y: [-6, -60, 10, -60], z: [0, 0, 0, 0], yawDeg: [0, 0, 0, 0],
  family: ['Pine', 'Pine', 'Pine', 'TwistedTree'],
};
const run = (lodCells, lod0Cap = 0) => computeBudget({
  placements, meshes, variantOf: () => 1, cam: { x: 0, y: 0, z: 1.7, yawDeg: 0, pitchDeg: 0 }, lodCells, lod0Cap,
});

const r = run(40);
const pine = r.groups.find((g) => g.mesh === 'Pine_1'), tw = r.groups.find((g) => g.mesh === 'TwistedTree_1');
eq('pine placed/inRange', [pine.placed, pine.inRange], [3, 2]);        // behind-camera tree culled
eq('pine lod0/lod1 (near LOD0, far LOD1)', [pine.lod0, pine.lod1], [1, 1]);
eq('pine tris = 1*1000 + 1*350', pine.tris, 1350);
eq('twisted stays LOD0 (no LOD1 asset)', [tw.inRange, tw.lod0, tw.lod1, tw.tris], [1, 1, 0, 9000]);
eq('total tris', r.total.tris, 10350);
eq('all-LOD0 tris', r.total.trisIfAllLod0, 2 * 1000 + 9000);
eq('family flags', [r.families.Pine.hasLod1, r.families.TwistedTree.hasLod1], [true, false]);

const off = run(0);
eq('lodCells 0 -> everything LOD0', [off.total.lod0, off.total.lod1, off.total.tris], [3, 0, 11000]);
eq('deterministic', JSON.stringify(run(40)), JSON.stringify(run(40)));

// variant pick: deterministic, in range, honours weights roughly
const counts = [0, 0, 0, 0, 0];
for (let i = 0; i < 5000; i++) counts[pickVariant(i, VARIANT_WEIGHTS.CommonTree) - 1]++;
eq('pickVariant repeatable', pickVariant(123, VARIANT_WEIGHTS.Pine), pickVariant(123, VARIANT_WEIGHTS.Pine));
eq('pickVariant weights (14>=10 variants)', counts[0] > counts[4] && counts.every((c) => c > 0), true);

if (fails) { console.error(`${fails} failed`); process.exitCode = 1; } else console.log('all mesh-tri-budget tests passed');
