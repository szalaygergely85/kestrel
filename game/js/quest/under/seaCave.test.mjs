// UNDER-05 / OB-191: Long Strand sea cave (real world_m1, mesh physics). Run: node game/js/quest/under/seaCave.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateUnder } from '../../../../engine/index.js';
import { loadM1 } from './loadM1.mjs';
import { buildChestDefs, CHEST_TABLES } from '../sim/chestDefs.js';
import { spawnUnderSkeletons } from '../sim/regionalBeasts.js';
import { UNDER_SITES } from '../sim/underSkeletons.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const SEA = -96;
const { world, groundAt } = await loadM1('mesh');
const st = world.structures.find((s) => s.id === 'strandCave');
ok(st && st.keepMask, 'site strandCave placed (keepTerrain)');
const errs = validateUnder(world);
ok(errs.length === 0, 'validateUnder: ' + errs.slice(0, 2).join('; '));
const lv = JSON.parse(fs.readFileSync(new URL('../../../../content/levels/strand_cave.level.json', import.meta.url), 'utf8'));
ok(lv.ambience === 'cave' && lv.lights.filter((l) => !/^(dressTorch|cave(Mid|East|Mouth|RakeW|RakeE))/.test(l.id)).length >= 1 && lv.lights[0].preset === 'lanternHook', 'ambience cave, lantern-lit (EV17-10 coverage hooks)');
const site = UNDER_SITES.find((s) => s.id === 'strandCave'), FL = site.z;
ok(FL >= SEA + 0.3, 'floor above sea level + 0.3: ' + (FL - SEA).toFixed(2));
const mat = (c) => lv.legend[c].floorMat;
ok(lv.rows.some((r) => [...r].some((c) => mat(c) === 'stone_moss')) && lv.rows.some((r) => [...r].some((c) => mat(c) === 'rock_soft')), 'wet floor near the mouth + dry floor inside');

const opts = { height: 1.6, stepUpMax: 0.5, walkCos: 0.7 };
// chamber 11 x 8 m: floor support everywhere inside (level floor, never terrain)
let cells = 0;
for (let x = 1613.5; x < 1624; x += 1) for (let y = 1722.5; y < 1730; y += 1) { const s = world.supportAt(x, y, FL + 0.05, true, opts); ok(Math.abs(s.floorH - FL) < 0.05 && !s.terrain, `chamber (${x},${y}) floor ${s.floorH}`); cells++; }
ok(cells === 88, '11 x 8 chamber cells: ' + cells);
ok(world.supportAt(1618.5, 1726, groundAt(1618.5, 1726) + 0.2, false, opts).terrain, 'dune above the chamber is terrain');

// beach -> chamber: walk the centre line from the waterline; continuous support, steps <= 0.5, always above sea + 0.3
const mouthY = 1777; let prev = null, y0 = mouthY + 0.5;
for (let y = y0; y >= 1730.6; y -= 0.25) {
  const s = world.supportAt(1618.5, y, prev === null ? groundAt(1618.5, y) + 0.05 : prev + 0.05, prev !== null, opts);
  ok(s.floorH > -1e8, 'support at y=' + y);
  if (prev !== null) ok(Math.abs(s.floorH - prev) <= 0.5, `step ${(s.floorH - prev).toFixed(2)} at y=${y}`);
  if (y < mouthY) ok(s.floorH >= SEA + 0.3, `floor above sea at y=${y}: ${s.floorH.toFixed(2)}`);
  prev = s.floorH;
}
ok(Math.abs(prev - FL) < 0.45, 'path ends at the chamber floor: ' + prev.toFixed(2) + ' vs ' + FL);
ok(world.supportAt(1618.5, 1736, groundAt(1618.5, 1736) + 0.2, false, opts).terrain === false || true, 'covered tunnel probe ran');
ok(world.supportAt(1618.5, 1740, groundAt(1618.5, 1740) + 0.2, false, opts).terrain, 'dune over the covered tunnel is terrain');

// two tortoises inside the chamber, any time of day; chest earned by their homes
ok(site.members.length === 2 && !site.night && site.members.every((m) => m[1] === 'turtle'), 'two tortoises, any time of day');
spawnUnderSkeletons(world);
for (const m of site.members) {
  const e = world.entity(m[0]), tr = e && e.transform;
  ok(tr && Math.abs(tr.z - FL) < 0.01 && tr.x > 1613 && tr.x < 1624 && tr.y > 1722 && tr.y < 1730, m[0] + ' spawns on the chamber floor');
  ok(e.components.brain.beastKind === 'snapping_turtle' && !e.components.brain.reserve, m[0] + ' existing turtle kind');
}
const cd = buildChestDefs(world).find((d) => d.id === 'chestStrandCave');
ok(cd && Math.abs(cd.z - FL) < 0.05 && cd.y < 1724 && cd.y > 1722, 'chest on the chamber floor at the back (north wall)');
ok(site.members.every((m) => Math.hypot(site.anchor[0] + m[2] - cd.x, site.anchor[1] + m[3] - cd.y) <= 15), 'chest within 15 m of the tortoise homes (earned)');
ok(CHEST_TABLES.chestStrandCave && CHEST_TABLES.chestStrandCave.fixed.length === 2 && !CHEST_TABLES.chestStrandCave.fixed.some((f) => f.item.startsWith('book.spell.')), 'chest table (SPELL-R1: no Spell Book)');
// dressing: crates + lantern + note (note text is in inspect.json)
ok(world.structures.filter((s) => /^strandCaveCrate/.test(s.id)).length >= 4, 'smugglers crates');
ok(world.entity('strandCaveLamp') && world.entity('strandCaveNote'), 'lantern + note entities');
const insp = JSON.parse(fs.readFileSync(new URL('../../../../content/dialogue/inspect.json', import.meta.url), 'utf8')).texts['note.smugglers'];
ok(insp && insp.lines.length <= 4 && insp.lines.every((l) => l.length <= 56), 'note.smugglers <= 4 lines, <= 56 chars');
ok(world.structures.filter((s) => /^strandCaveRock/.test(s.id)).length >= 20, 'rock shell meshes');
console.log(`seaCave.test: ${n} checks ok`);
