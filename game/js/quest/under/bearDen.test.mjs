// UNDER-04 / OB-191: bear den (real world_m1, mesh physics). Run: node game/js/quest/under/bearDen.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateUnder } from '../../../../engine/index.js';
import { loadM1 } from './loadM1.mjs';
import { buildChestDefs, CHEST_TABLES } from '../sim/chestDefs.js';
import { spawnUnderSkeletons } from '../sim/regionalBeasts.js';
import { UNDER_SITES } from '../sim/underSkeletons.js';
import { UNDERGROUND_Z } from '../../../../tools/chest-enemy-density.mjs';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const { world, groundAt } = await loadM1('mesh');
const st = world.structures.find((s) => s.id === 'bearDen');
ok(st && st.keepMask, 'site bearDen placed (keepTerrain)');
const errs = validateUnder(world);
ok(errs.length === 0, 'validateUnder: ' + errs.slice(0, 2).join('; '));
const lv = JSON.parse(fs.readFileSync(new URL('../../../../content/levels/bear_den.level.json', import.meta.url), 'utf8'));
ok(lv.ambience === 'cave' && lv.lights.length === 0, 'dark cave: ambience cave, no torches');
const FL = UNDER_SITES.find((s) => s.id === 'bearDen').z;
ok(Math.abs(st.origin.z + 3.2 - FL) < 0.02, 'site z = chamber floor ' + FL);

// chamber 10 x 8 m: floor support everywhere inside, terrain above it never lifts the player
const opts = { height: 1.6, stepUpMax: 0.5, walkCos: 0.7 };
let cells = 0;
for (let x = 1579.5; x < 1589; x += 1) for (let y = 429.5; y < 437; y += 1) { const s = world.supportAt(x, y, FL + 0.05, true, opts); ok(Math.abs(s.floorH - FL) < 0.05 && !s.terrain, `chamber (${x},${y}) floor ${s.floorH}`); cells++; }
ok(cells === 80, '10 x 8 chamber cells: ' + cells);
ok(world.supportAt(1584, 433, groundAt(1584, 433) + 0.2, false, opts).terrain, 'hill above the chamber is terrain');

// walk-in slope: surface -> chamber, continuous support along the middle (x 1584.5), steps <= 0.5
let prev = null;
for (let y = 453; y >= 437.6; y -= 0.25) {
  const s = world.supportAt(1584.5, y, prev === null ? groundAt(1584.5, y) + 0.05 : prev + 0.05, prev !== null, opts);
  ok(s.floorH > -1e8, 'slope support at y=' + y);
  if (prev !== null) ok(Math.abs(s.floorH - prev) <= 0.5, `slope step ${(s.floorH - prev).toFixed(2)} at y=${y}`);
  prev = s.floorH;
}
ok(Math.abs(prev - FL) < 0.45, 'slope ends at the chamber floor: ' + prev.toFixed(2) + ' vs ' + FL);
// no square walls reachable from outside: outside the slope columns (x 1582.5 / 1586.5) the wall blocks, terrain above the tunnel is solid ground
ok(world.supportAt(1584.5, 441, groundAt(1584.5, 441) + 0.2, false, opts).terrain, 'hill over the covered slope is terrain');

// bear: one, home inside the chamber, any time of day, wary = calm until hit
const site = UNDER_SITES.find((s) => s.id === 'bearDen');
ok(site && site.members.length === 1 && !site.night && site.members[0][1] === 'bear', 'one bear, any time of day');
const bx = site.anchor[0] + site.members[0][2], by = site.anchor[1] + site.members[0][3];
ok(bx > 1580 && bx < 1588 && by > 429.5 && by < 437, `bear home inside the chamber (${bx},${by})`);
spawnUnderSkeletons(world);
const be = world.entity('bear.bearDen.1'), tr = be && be.transform, br = be && be.components.brain;
ok(tr && Math.abs(tr.z - FL) < 0.01 && tr.x > 1580 && tr.x < 1588 && tr.y > 429.5 && tr.y < 437, 'bear spawns inside the structure at the chamber floor');
ok(br.species === 'bear' && br.temperament === 'wary' && !br.reserve, 'legacy black bear brain, wary (calm until hit)');
ok(world.structureAt(tr.x, tr.y) === world.structureAt(1584.5, 436.5) && world.structureAt(tr.x, tr.y), 'bear is in the bearDen structure');
const cd = buildChestDefs(world).find((d) => d.id === 'chestBearDen');
ok(cd && Math.abs(cd.z - FL) < 0.05, 'chestBearDen def on the chamber floor');
ok(cd.x > 1580 && cd.x < 1588 && cd.y < by && cd.y > 429.2, 'chest behind the bear (north wall)');
ok(Math.hypot(cd.x - bx, cd.y - by) <= 15, 'chest within 15 m of the bear home (guarded: chest-enemy-density RADIUS)');
ok(cd.z > UNDERGROUND_Z, 'note: z is above -20, so the earned rule here = bear guard, not depth');
const t = CHEST_TABLES.chestBearDen;
ok(t.fixed.length === 3 && t.fixed.some((f) => f.item === 'scroll.spell') && t.gear.tier === 'sturdy' && t.fixed.some((f) => f.item === 'potion.hp') && t.fixed.some((f) => f.item === 'arrow'), 'modest stash: arrows + potion + sturdy gear');
// shell rocks exist (outside + inside), all existing meshes
const rocks = world.structures.filter((s) => /^bearDenRock/.test(s.id));
ok(rocks.length >= 20 && rocks.every((s) => /^quaternius\/(Rock_Medium_[123])$/.test(s.mesh) || s.mesh), 'rock shell meshes: ' + rocks.length);
ok(world.structures.filter((s) => /^bearDen(Bone|Rubble)/.test(s.id)).length >= 8, 'bones + rubble on the floor');
console.log(`bearDen.test: ${n} checks ok`);
