// tools/coplanar-lint.test.mjs (OB-053): synthetic coplanar/offset/facing cases + the tower spot on the real world.
import assert from 'node:assert/strict';
import { newSoup, addMesh, findCoplanar, worldSoup, near, TOWER_SPOT } from './coplanar-lint.mjs';

let checks = 0; const ok = (c, m) => { assert.ok(c, m); checks++; };
// one unit quad (2 tris) in the z=0 plane, CCW seen from +z; `flip` reverses the facing
function quad(flip = false, ranges) {
  const v = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0];
  const pos = Float32Array.from(flip ? [0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0] : v);
  return { pos, triCount: 2, layout: 'static', idx: null, ranges: ranges || [{ start: 0, count: 2 }] };
}
const lint = (...placements) => {
  const s = newSoup();
  placements.forEach(([m, p], i) => addMesh(s, m, 'm' + i, p));
  return findCoplanar(s);
};
ok(lint([quad(), {}], [quad(), {}]).length >= 1, 'identical quads (exact duplicate) flagged');
ok(lint([quad(), {}], [quad(), { origin: { x: 0.5, y: 0.5, z: 0.01 } }]).length >= 1, '1 cm offset, partial overlap flagged');
ok(lint([quad(), {}], [quad(), { origin: { x: 0, y: 0, z: 0.05 } }]).length === 0, '5 cm offset not flagged (depth resolves it)');
ok(lint([quad(), {}], [quad(true), {}]).length === 0, 'opposite facing (back to back) not flagged');
ok(lint([quad(), {}], [quad(), { origin: { x: 3, y: 0, z: 0 } }]).length === 0, 'no overlap not flagged');
ok(lint([quad(), {}], [quad(false, [{ start: 0, count: 2, mask: { tex: 'x', cutoff: 0.5 } }]), {}]).length === 0, 'alpha-cutout range skipped');
ok(lint([quad(), {}], [quad(), { yawDeg: 90, origin: { x: 1, y: 0, z: 0 } }]).length >= 1, 'yaw 90 about the origin still overlaps the unit square');
ok(lint([quad(), {}], [quad(), { yawDeg: 90 }]).length === 0, 'yaw 90 about its origin lands in the x<0 half: no overlap');

// real world: the OB-053 tower spot has no coplanar level/mesh pair (and the lint runs on the whole world).
const soup = await worldSoup('world_m1');
const pairs = findCoplanar(soup);
ok(soup.src.length > 100000, 'world soup loaded');
ok(pairs.filter((p) => near(p, TOWER_SPOT, 8)).length === 0, 'tower spot: 0 coplanar pairs');
ok(pairs.every((p) => !soup.srcs[p.sa].level && !soup.srcs[p.sb].level), 'no level mesh (grid faces) is coplanar with anything in the world');
// OB-053b: the generators (sealed gate, outwall) are clean; the budget covers the known leftovers (poi/rs prop clutter, see docs/lanes/pc-b2.md)
const WORLD_MAX = 117;
ok(pairs.filter((p) => /^(sg|ow)[0-9]+[(]/.test(soup.srcs[p.sa].name) && /^(sg|ow)[0-9]+[(]/.test(soup.srcs[p.sb].name)).length <= 1, "sealed gate + outwall: <= 1 coplanar pair (ow175 wall x ow183 roof)");
ok(pairs.length <= WORLD_MAX, `world coplanar pairs ${pairs.length} <= ${WORLD_MAX}`);
console.log(`coplanar-lint.test: ${checks} checks OK (${pairs.length} world pair(s))`);
