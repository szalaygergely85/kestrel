// BEAST-07b (routes half): the REAL regional generator + group builder + seeded routes on a real A* nav per region (no sim, no stepping).
// Routes stay inside their region rect, 3..6 waypoints, every leg (incl. the closing one) is reachable (exact A*); night groups are the
// placeholder wolf packs (REGION_RULES `placeholderFor: 'undead'`) and fit the MAX_BEASTS headroom. Roaming lives in beastRoutes.roam.e2e.test.js.
import assert from 'node:assert/strict';
import { MAX_BEASTS } from './sim/beastSim.js';
import { REGION_RULES } from './sim/regionalBeasts.js';
import { reachFor } from './beastRoutes.js';
import { loadScene, routesFor, rectOf } from './beastRoutesKit.js';

const { w, list } = loadScene();
const regions = [...new Set(list.map((m) => m.region))];
let legs = 0, nGroups = 0; const groups = [];
for (const region of regions) {
  const r = rectOf(region); assert.ok(r, 'rect for ' + region);
  for (const { g, nav } of routesFor(w, list.filter((m) => m.region === region))) {
    const reach = reachFor(nav);
    assert.ok(g.route.length >= 3 && g.route.length <= 6, g.gid + ' len');
    let p = g.home;
    for (const q of g.route.concat([g.route[0]])) {
      assert.ok(q[0] >= r[0] && q[0] <= r[2] && q[1] >= r[1] && q[1] <= r[3], g.gid + ' waypoint in rect ' + q);
      assert.ok(reach(p[0], p[1], q[0], q[1]), g.gid + ' leg reachable ' + p + ' -> ' + q);
      p = q; legs++;
    }
    groups.push(g); nGroups++;
  }
}
assert.ok(nGroups >= 15 && legs >= nGroups * 4, `routes built: ${nGroups} groups, ${legs} legs`);
// night groups = placeholder wolves, headroom
const nightRules = REGION_RULES.filter((r) => r.when === 'night');
assert.ok(nightRules.length >= 2 && new Set(nightRules.map((r) => r.region)).size >= 2, 'night groups in >= 2 regions');
assert.ok(nightRules.every((r) => r.placeholderFor === 'undead' && r.species === 'wolf'), 'placeholders marked');
const nightGroups = groups.filter((g) => g.when === 'night'), nightSlots = nightGroups.reduce((n, g) => n + g.slots.length, 0);
assert.ok(nightGroups.length >= 2 && nightGroups.length <= 3, 'night groups 2-3: ' + nightGroups.length);
assert.ok(list.length < MAX_BEASTS && MAX_BEASTS - list.length >= 20, `MAX_BEASTS headroom ${list.length}/${MAX_BEASTS} (night slots ${nightSlots})`);
console.log(`beastRoutes.e2e.test: PASS (${nGroups} groups, ${legs} legs)`);
