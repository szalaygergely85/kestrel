// UNDER-05 / OB-191 (arch 38.75): builds content/levels/strand_cave.level.json (a sea-cave gully from the beach into the Long Strand dune + one 11x8 m chamber,
// keepTerrain, ambience 'cave', one lantern light) and patches world_m1 (structure `strandCave`, rock shell, smugglers' crates, lantern, note, chest, state flag). Re-runnable.
//   node tools/gen-seacave.mjs      (pattern: tools/gen-bearden.mjs)
// Site: Long Strand east of Gullhaven (mouth on the beach facing south; the gully runs north INTO the dune; strand lv 3-4). Floor stays >= sea + 0.5 (no water plane inside).
import fs from 'node:fs';
import { stringifyContent } from '../engine/index.js';
import { loadM1 } from '../game/js/quest/under/loadM1.mjs';

const r2 = (v) => Math.round(v * 100) / 100;
const SEA = -96, OX = 1606, OY = 1700, H = 90, RC = [10, 11, 12, 13, 14], R_IN = 30, SL = 0.004, MOUTH_REL = 0.5; // ramp cols, doorway row (chamber south wall), floor rise per metre
const CH = { c0: 7, c1: 17, r0: 22, r1: 29 }; // chamber 11 x 8 m
const BASE = 2.7, OZ = r2(SEA - BASE); // local floor = rel-to-sea + BASE
const CEIL_H = 2.6, TOP_H = 2.9; // chamber ceiling/top above its floor
const { groundAt } = await loadM1('mesh');
const g = (c, r) => groundAt(OX + c + 0.5, OY + r + 0.5);
// mouth row: first row (walking inland from the sea) whose ramp ground reaches the mouth floor (the waterline just behind it)
let R0 = H - 2; while (R0 > R_IN && Math.min(...RC.map((c) => g(c, R0))) - SEA < MOUTH_REL) R0--;
const relFloor = (k) => MOUTH_REL + SL * k;
const loc = (rel) => r2(rel + BASE);
const FLOOR = loc(relFloor(R0 - R_IN)), CEIL = r2(FLOOR + CEIL_H), TOP = r2(FLOOR + TOP_H), FLW = r2(OZ + FLOOR);

const W = 26;
const rows = Array.from({ length: H }, () => Array.from({ length: W }, () => 'F'));
const legend = { R: { ceilH: 1, topH: 1.2, ceilMat: 'stone', floorH: 0.5, floorMat: 'floor', wallMat: 'rock_soft', solid: false, keepTerrain: true, desc: 'outer ring (non-solid, terrain above stays walkable)' },
  F: { ceilH: 1, topH: 1.2, ceilMat: 'stone', floorH: 1.2, floorMat: 'floor', wallMat: 'rock_soft', solid: true, keepTerrain: true, desc: 'filler under the dune (terrain above it stays walkable)' },
  '#': { ceilH: CEIL, topH: TOP, ceilMat: 'rock_soft', floorH: TOP, floorMat: 'floor', wallMat: 'rock_soft', solid: true, keepTerrain: true, desc: 'cave wall' },
  '.': { ceilH: CEIL, topH: TOP, ceilMat: 'rock_soft', floorH: FLOOR, floorMat: 'rock_soft', wallMat: 'rock_soft', solid: false, keepTerrain: true, desc: 'sea cave floor (dry)', zone: 'cave' } };
const pool = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@$%&*+=~^:;<>?'.split('');
const put = (c, r, ch) => { rows[r][c] = ch; };
for (let r = CH.r0 - 1; r <= CH.r1 + 1; r++) for (let c = CH.c0 - 1; c <= CH.c1 + 1; c++) put(c, r, '#');
for (let r = CH.r0; r <= CH.r1; r++) for (let c = CH.c0; c <= CH.c1; c++) put(c, r, '.');
const sym = (def) => { const j = JSON.stringify(def); for (const [k, v] of Object.entries(legend)) if (JSON.stringify(v) === j) return k; const k = pool.shift(); if (!k) throw new Error('legend pool exhausted'); legend[k] = def; return k; };
const q = (v, st) => r2(Math.ceil(v / st - 1e-9) * st); // quantise up so identical rows share a legend symbol
const WET_K = 9; // the first 9 m from the mouth are wet (darker moss-stone floor, the closest existing "wet" look)
let covered = false, coverR = -1;
for (let r = R0; r >= R_IN; r--) {
  const k = R0 - r, fl = loc(relFloor(Math.floor(k / 8) * 8)), gr = Math.min(...[RC[0] - 1, ...RC, RC[RC.length - 1] + 1].map((c) => g(c, r)));
  if (r === R_IN) { for (const c of RC) put(c, r, '.'); continue; }
  if (!covered && gr >= fl + 2.6 + OZ + 0.45) { covered = true; coverR = r; }
  const fm = k < WET_K ? 'stone_moss' : 'rock_soft';
  let s, f;
  if (!covered) {
    s = sym({ ceilH: 'sky', ceilMat: 'sky', floorH: fl, floorMat: fm, wallMat: 'rock_soft', solid: false, desc: k < WET_K ? 'cave gully (wet, open, carved)' : 'cave gully (open, carved)', zone: 'cave' });
    f = sym({ ceilH: 'sky', ceilMat: 'sky', floorH: q(gr + 0.4 - OZ, 0.25), floorMat: 'floor', wallMat: 'rock_soft', solid: true, desc: 'gully wall (top 0.4-0.65 m over the rim)' });
  } else {
    s = sym({ ceilH: r2(fl + 2.4), topH: r2(fl + 2.6), ceilMat: 'rock_soft', floorH: fl, floorMat: fm, wallMat: 'rock_soft', solid: false, keepTerrain: true, desc: k < WET_K ? 'cave tunnel (wet, covered)' : 'cave tunnel (covered)', zone: 'cave' });
    f = sym({ ceilH: r2(fl + 2.4), topH: r2(fl + 2.6), ceilMat: 'rock_soft', floorH: r2(fl + 2.6), floorMat: 'floor', wallMat: 'rock_soft', solid: true, keepTerrain: true, desc: 'tunnel wall' });
  }
  for (const c of RC) put(c, r, s);
  put(RC[0] - 1, r, f); put(RC[RC.length - 1] + 1, r, f);
}
const C0 = 5, C1 = 19, R0c = 20, R1 = R0; // the mouth row is the last grid row (seaward terrain is under water: no cells there)
for (let r = R0c; r <= R1; r++) for (let c = C0; c <= C1; c++) if ((r === R0c || c === C0 || c === C1 || (r === R1 && (c < RC[0] || c > RC[RC.length - 1])))) put(c, r, "R");
const LIGHT = { x: 1613.9, y: 1723.0 };
const level = {
  kind: 'level', schema: 1, id: 'strand_cave', nextId: 1, name: 'strand_cave', title: 'The Strand Cave', version: 1, cellSize: 1, ambience: 'cave',
  note: 'UNDER-05 / OB-191 (arch 38.75): generated by tools/gen-seacave.mjs. Placed at (' + (OX + C0) + ',' + (OY + R0c) + ',' + OZ + '). Gully from the beach mouth (world ~' + (OX + 12.5) + ',' + (OY + R0) + ') runs north into the dune (wet floor for the first ' + WET_K + ' m) to an 11x8 m chamber (floor ' + FLW + ', sea ' + SEA + '). One lantern light. keepTerrain except the open gully. Mesh physics only.',
  size: { w: C1 - C0 + 1, h: R1 - R0c + 1 }, rows: rows.slice(R0c, R1 + 1).map((r) => r.slice(C0, C1 + 1).join('')), legend,
  start: { x: 12.5 - C0, y: R0 - R0c + 0.5, facingDeg: 0, pitchDeg: 0, eyeH: 1.6, pose: 'standing' },
  ambient: { preset: 'ambient' }, lights: [{ id: 'lantern', on: true, preset: 'lanternHook', x: r2(LIGHT.x - (OX + C0)), y: r2(LIGHT.y - (OY + R0c)), z: r2(FLOOR + 1) }],
  props: [], interactables: [], triggers: [], markers: [], layers: {},
};
fs.writeFileSync('content/levels/strand_cave.level.json', JSON.stringify(level, null, 2) + '\n', 'utf8');

const FILE = 'content/worlds/world_m1.world.json', d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const mine = (id) => /^strandCave|^chestStrandCave$/.test(id);
d.structures = d.structures.filter((s) => !mine(s.id)); d.entities = d.entities.filter((e) => !mine(e.id));
const ci = d.structures.findIndex((s) => s.id === 'bearDen');
d.structures.splice(ci + 1, 0, { id: 'strandCave', level: 'strand_cave', note: 'UNDER-05 / OB-191: sea cave in the Long Strand dune (mouth ~' + (OX + 12.5) + ',' + (OY + R0) + ' -> chamber ' + (OX + CH.c0) + '..' + (OX + CH.c1 + 1) + ' x ' + (OY + CH.r0) + '..' + (OY + CH.r1 + 1) + ', floor ' + FLW + '); keepTerrain, mesh physics', origin: { x: OX + C0, y: OY + R0c, z: OZ }, yawSteps: 0 });
let n = 0;
const mesh = (id, m, x, y, z, yaw, sc) => d.structures.push({ id, mesh: 'quaternius/' + m, origin: { x: r2(x), y: r2(y), z: r2(z) }, scale: sc, yawDeg: yaw });
const rock = (m, x, y, z, yaw, sc) => mesh('strandCaveRock' + (++n), m, x, y, z, yaw, sc);
const RM = ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'];
const CX = OX + 12.5, jy = OY + coverR + 0.5; // gully centre x; junction row centre
// boulders flank the open gully (both sides, every ~2.1 m) so no square cut shows
for (let i = 0, y = OY + R0 - 0.5; y > jy - 0.5; y -= 2.1, i++) for (const sx of [-1, 1]) { const x = CX + sx * (4.4 + (i % 2) * 0.5); rock(RM[(i + (sx > 0 ? 1 : 0)) % 3], x, y, groundAt(x, y) - 0.5, 40 * i + (sx > 0 ? 90 : 0), 1.1 + 0.1 * (i % 3)); }
for (const sx of [-1, 1]) for (let j = 0; j < 2; j++) { const x = CX + sx * (4.9 + j * 1.6), y = jy - 0.2 - j * 1.6; rock(RM[(j + 1) % 3], x, y, groundAt(x, y) - 0.6, 70 * j + 30, 1.6 - 0.2 * j); }
const ceilW = r2(OZ + loc(relFloor(R0 - coverR)) + 2.4);
rock(RM[0], CX, jy - 1.9, ceilW + 0.4, 15, 1.4); rock(RM[2], CX, jy - 3.8, ceilW + 1.0, 200, 1.7); // lintel / brow over the tunnel start
// inside: corner + wall rocks, rubble on the floor
const X0 = OX + CH.c0, X1 = OX + CH.c1 + 1, Y0 = OY + CH.r0, Y1 = OY + CH.r1 + 1, XM = (X0 + X1) / 2;
const wallRocks = [[X0 + 0.3, Y0 + 0.3, 1.5], [X1 - 0.3, Y0 + 0.3, 1.6], [X0 + 0.3, Y1 - 0.3, 1.4], [X1 - 0.3, Y1 - 0.3, 1.5], [X0 + 0.2, (Y0 + Y1) / 2, 1.2], [X1 - 0.2, (Y0 + Y1) / 2 + 0.6, 1.3],
  [XM - 3, Y0 + 0.2, 1.1], [XM + 3.5, Y0 + 0.2, 1.2], [XM - 3.5, Y1 - 0.2, 1.1], [XM + 3.5, Y1 - 0.2, 1.1]];
wallRocks.forEach(([x, y, s], i) => rock(RM[i % 3], x, y, FLW - 0.1, 37 * i, s));
[['Pebble_Round_1', XM - 1.5, Y1 - 2.2, 0.9], ['Pebble_Round_3', XM + 2.3, Y1 - 3.0, 1.1], ['Pebble_Square_2', XM + 3.6, Y0 + 2.4, 1.0], ['Pebble_Round_5', XM - 3.3, Y0 + 3.4, 0.9], ['Pebble_Square_4', XM + 0.8, Y0 + 3.1, 1.0]]
  .forEach(([m, x, y, s], i) => mesh('strandCaveRubble' + (i + 1), m, x, y, FLW, 29 * i, s));
// smugglers' stash: crates stacked against the west wall (one on top), one further south
[[X0 + 1.1, Y0 + 1.6, 0, 12, 0.9], [X0 + 1.2, Y0 + 2.7, 0, 190, 0.85], [X0 + 2.2, Y0 + 1.2, 0, 95, 0.8], [X0 + 1.1, Y0 + 1.6, 0.98, 40, 0.7], [X0 + 1.6, Y0 + 4.2, 0, 340, 0.8]]
  .forEach(([x, y, dz, yaw, s], i) => mesh('strandCaveCrate' + (i + 1), 'Prop_Crate', x, y, FLW + dz, yaw, s));
const prop = (id, x, y, z, note, comp, yawDeg) => d.entities.push({ id, type: 'prop', x: r2(x), y: r2(y), z, ...(yawDeg !== undefined ? { yawDeg } : {}), components: comp, note });
prop('strandCaveLamp', LIGHT.x, LIGHT.y, FLW, 'UNDER-05: smugglers lantern (existing floorLanternVox; light = level lights[lantern])', { voxel: { anim: 'lit', loop: true, model: 'floorLanternVox' } });
prop('strandCaveNote', X0 + 2.6, Y0 + 2.9, FLW, 'UNDER-05: smugglers note (inspect.json note.smugglers, written QUEST-WRITER-FILL-01)', { inspect: { text: 'note.smugglers' } });
prop('chestStrandCave', XM + 0.4, Y0 + 0.9, FLW, 'UNDER-05: the earned chest at the back (guarded by the tortoise homes; chestDefs.js table)', { voxel: { anim: 'closed', loop: false, model: 'chestBig' } }, 180);
Object.assign(d.state, { 'under.strandCave.chest.chestStrandCave': false });
fs.writeFileSync(FILE, stringifyContent(d), 'utf8');
const man = JSON.parse(fs.readFileSync('content/manifest.json', 'utf8'));
if (!man.files.includes('levels/strand_cave.level.json')) { man.files.splice(man.files.indexOf('levels/bear_den.level.json') + 1, 0, 'levels/strand_cave.level.json'); fs.writeFileSync('content/manifest.json', JSON.stringify(man, null, 2) + '\n', 'utf8'); }
console.log(JSON.stringify({ OZ, R0, mouthY: OY + R0, FLOOR, FLW, coverR, jy, ceilW, rocks: n, chamber: [X0, Y0, X1, Y1], chest: [r2(XM + 0.4), r2(Y0 + 0.9)] }));
