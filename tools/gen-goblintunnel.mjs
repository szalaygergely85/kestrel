// UNDER-06 / OB-191 (arch 38.75): builds content/levels/goblin_tunnel.level.json (a 3-wide tunnel between goblin camps campNorth (925,905) and campEast (965,975),
// ~80 m apart; two walk-in mouths, 2 bends, one side stash room; keepTerrain, nav floors, ambience cave, 3 goblin torches) and patches world_m1
// (structure `goblinTunnel`, rock-mesh mouths + inner dressing, chest anchor `chestGoblinTunnel`, state flag). Re-runnable.
//   node tools/gen-goblintunnel.mjs
import fs from 'node:fs';
import { stringifyContent } from '../engine/index.js';
import { loadM1 } from '../game/js/quest/under/loadM1.mjs';

const r2 = (v) => Math.round(v * 100) / 100;
const { groundAt } = await loadM1('mesh');
const STEP = 0.3, D = 3.8, CEIL_H = 2.6, TOP_H = 2.8, COVER = 3.7; // floor <= ground - D; tunnel ceiling 2.6 m, roof slab 0.2 m, crust >= 1.0 m
// ---- path (cell coordinates of the 3-wide tunnel centre line). Mouth A south of campNorth, mouth B north of campEast.
const A = [930, 917], P1 = [930, 939], P2 = [960, 939], B = [960, 962];
const path = []; // [x, y, dirIsY]
const leg = (a, b) => { const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]); let x = a[0], y = a[1]; for (;;) { path.push([x, y, dx === 0]); if (x === b[0] && y === b[1]) break; x += dx; y += dy; } };
leg(A, P1); path.pop(); leg(P1, P2); path.pop(); leg(P2, B);
const N = path.length;
const SIDE = { x: 945, w: 4, y0: 943, y1: 948 }; // side room: cells x 941..949, y 943..948; stub y 940..942 off the leg at x=945
const g = (x, y) => groundAt(x + 0.5, y + 0.5);
const gMin = (cells) => Math.min(...cells.map(([x, y]) => g(x, y)));
const around = (x, y, rx, ry) => { const o = []; for (let i = -rx; i <= rx; i++) for (let j = -ry; j <= ry; j++) o.push([x + i, y + j]); return o; };
// ---- floor profile along the path (abs z): target ground - D, ends = ground, slope <= STEP per cell both ways
const secG = (i) => { const [x, y, dirY] = path[i]; return gMin(around(x, y, dirY ? 1 : 0, dirY ? 0 : 1)); };
const gA = g(...path[0]), gB = g(...path[N - 1]);
const rampA = path.map((_, i) => gA - STEP * i), rampB = path.map((_, i) => gB - STEP * (N - 1 - i));
let iCA = 0; while (iCA < N && secG(iCA) < rampA[iCA] + COVER) iCA++;
let iCB = N - 1; while (iCB >= 0 && secG(iCB) < rampB[iCB] + COVER) iCB--;
const f = path.map(([x, y, dirY], i) => Math.min(i < iCA ? rampA[i] : Infinity, i > iCB ? rampB[i] : Infinity, (i < iCA || i > iCB) ? Infinity : gMin(around(x, y, dirY ? 3 : 1, dirY ? 1 : 3)) - D));
for (let i = 1; i < N; i++) f[i] = Math.min(f[i], f[i - 1] + STEP);
for (let i = N - 2; i >= 0; i--) f[i] = Math.min(f[i], f[i + 1] + STEP);
const OZ = r2(Math.floor((Math.min(...f) - 0.6) / STEP) * STEP);
const q = (z) => r2(Math.floor((z - OZ) / STEP + 1e-9) * STEP); // quantised rel floor (<= z)
const fr = f.map(q);
const iSide = path.findIndex(([x, y]) => x === SIDE.x && y === P1[1]);
const sideF = fr[iSide];

// ---- grid box: bbox of path + side room + 4 margin; border ring = non-solid keepTerrain 'R'
const xs = [A[0], B[0], SIDE.x - SIDE.w, SIDE.x + SIDE.w], ys = [A[1], B[1], SIDE.y1];
const X0 = Math.min(...xs) - 4, X1 = Math.max(...xs) + 4, Y0 = Math.min(...ys) - 1, Y1 = Math.max(...ys) + 1; // mouth A faces north (row Y0+1), B south
const W = X1 - X0 + 1, H = Y1 - Y0 + 1;
const rows = Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => (r === 0 || r === H - 1 || c === 0 || c === W - 1) ? 'R' : 'F'));
const legend = { R: { ceilH: 1, topH: 1.2, ceilMat: 'stone', floorH: 0.5, floorMat: 'floor', wallMat: 'stone', solid: false, keepTerrain: true, desc: 'outer ring (non-solid, terrain above stays walkable)' },
  F: { ceilH: 1, topH: 1.2, ceilMat: 'stone', floorH: 1.2, floorMat: 'floor', wallMat: 'stone', solid: true, keepTerrain: true, desc: 'filler under the ground (terrain above it stays walkable)' } };
const pool = ('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@$%&*+=~^:;<>?' + Array.from({ length: 64 }, (_, i) => String.fromCharCode(0xc0 + i)).filter((c) => c !== '×' && c !== '÷').join('')).split('').filter((c) => c !== 'R' && c !== 'F');
const byKey = new Map();
const charFor = (key, def) => { if (!byKey.has(key)) { const ch = pool.shift(); legend[ch] = def; byKey.set(key, ch); } return byKey.get(key); };
const floorOpen = (v) => charFor('so' + v, { ceilH: 'sky', ceilMat: 'sky', floorH: v, floorMat: 'floor', wallMat: 'stone', solid: false, desc: `mouth slope ${v} (open, carved)`, zone: 'cave' });
const floorCov = (v) => charFor('sc' + v, { ceilH: r2(v + CEIL_H), topH: r2(v + TOP_H), ceilMat: 'stone', floorH: v, floorMat: 'floor', wallMat: 'stone', solid: false, keepTerrain: true, desc: `tunnel floor ${v}`, zone: 'cave' });
const wallOpen = (top) => charFor('wo' + top, { ceilH: 'sky', ceilMat: 'sky', floorH: top, floorMat: 'floor', wallMat: 'stone', solid: true, desc: `slope wall (top ${top}, 0.4 m over the rim)` });
const wallCov = (v) => charFor('wc' + v, { ceilH: r2(v + CEIL_H), topH: r2(v + TOP_H), ceilMat: 'stone', floorH: r2(v + TOP_H), floorMat: 'floor', wallMat: 'stone', solid: true, keepTerrain: true, desc: `tunnel wall ${v}` });

// cell table: key "x,y" -> { v (rel floor), open }
const floorCells = new Map();
const setFloor = (x, y, v, open) => floorCells.set(x + ',' + y, { x, y, v, open });
// open (carved trench) while the roof is not yet covered; latched per mouth end
const coveredAt = new Array(N).fill(false);
for (const dir of [1, -1]) {
  let latched = false;
  for (let k = 0; k < N; k++) {
    const i = dir === 1 ? k : N - 1 - k, [x, y, dirY] = path[i];
    const gr = gMin(around(x, y, dirY ? 1 : 0, dirY ? 0 : 1));
    if (!latched && gr >= fr[i] + OZ + COVER) latched = true;
    if (latched) coveredAt[i] = true;
    if (k > N / 2) break;
  }
}
path.forEach(([x, y, dirY], i) => {
  for (let o = -1; o <= 1; o++) { const cx = dirY ? x + o : x, cy = dirY ? y : y + o; setFloor(cx, cy, fr[i], !coveredAt[i]); }
});
// stub + side room (covered, level sideF)
for (let y = P1[1] + 1; y <= SIDE.y0 - 1; y++) for (let x = SIDE.x - 1; x <= SIDE.x + 1; x++) setFloor(x, y, sideF, false);
for (let y = SIDE.y0; y <= SIDE.y1; y++) for (let x = SIDE.x - SIDE.w; x <= SIDE.x + SIDE.w; x++) setFloor(x, y, sideF, false);
// paint floors, then walls (any non-floor cell within 1 of a floor cell)
const lc = (x, y) => [x - X0, y - Y0];
const walls = [];
for (const c of floorCells.values()) {
  const [cx, cy] = lc(c.x, c.y);
  rows[cy][cx] = c.open ? floorOpen(c.v) : floorCov(c.v);
}
for (const c of [...floorCells.values()]) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
  const wx = c.x + i, wy = c.y + j; if (floorCells.has(wx + ',' + wy)) continue;
  const [cx, cy] = lc(wx, wy); if (cx < 1 || cy < 1 || cx > W - 2 || cy > H - 2) continue;
  if (c.open) { const top = r2(Math.ceil((g(wx, wy) + 0.4 - OZ) / STEP) * STEP); rows[cy][cx] = wallOpen(top); }
  else if (rows[cy][cx] === 'F') rows[cy][cx] = wallCov(c.v);
  walls.push([wx, wy]);
}
// lights: 3 goblin torches (level lights): stub, leg 2 west, leg 3 mid
const lt = (id, x, y, v) => ({ id, on: true, preset: 'torch', x: x - X0 + 0.5, y: y - Y0 + 0.5, z: r2(v + 1.7) });
const iAt = (x, y) => path.findIndex(([px, py]) => px === x && py === y);
const lights = [lt('torchRoom', SIDE.x - SIDE.w + 1, SIDE.y0, sideF), lt('torchBend', P1[0] + 4, P1[1] - 1, fr[iAt(P1[0] + 4, P1[1])]), lt('torchEast', P2[0] - 2, P2[1] + 6, fr[iAt(P2[0], P2[1] + 6)])];
const lvPlace = { x: X0, y: Y0, z: OZ };
const level = {
  kind: 'level', schema: 1, id: 'goblin_tunnel', nextId: 1, name: 'goblin_tunnel', title: 'The Goblin Tunnel', version: 1, cellSize: 1, ambience: 'cave',
  note: `UNDER-06 / OB-191 (arch 38.75): generated by tools/gen-goblintunnel.mjs. Placed at (${X0},${Y0},${OZ}). 3-wide tunnel from mouth A (${A[0]}.5,${A[1]}, south of campNorth) to mouth B (${B[0]}.5,${B[1]}, north of campEast), bends at (${P1}) and (${P2}), side stash room at x ${SIDE.x - SIDE.w}..${SIDE.x + SIDE.w} y ${SIDE.y0}..${SIDE.y1} (floor ${r2(OZ + sideF)}). keepTerrain except the open mouth slopes. Mesh physics only.`,
  size: { w: W, h: H }, rows: rows.map((r) => r.join('')), legend,
  start: { x: A[0] - X0 + 0.5, y: 1.5, facingDeg: 0, pitchDeg: 0, eyeH: 1.6, pose: 'standing' },
  ambient: { preset: 'ambient' }, lights, props: [], interactables: [], triggers: [], markers: [], layers: {},
};
fs.writeFileSync('content/levels/goblin_tunnel.level.json', JSON.stringify(level, null, 2) + '\n', 'utf8');

// ---- world_m1 patch
const FILE = 'content/worlds/world_m1.world.json', d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const mine = (id) => /^goblinTunnel|^chestGoblinTunnel$/.test(id);
d.structures = d.structures.filter((s) => !mine(s.id)); d.entities = d.entities.filter((e) => !mine(e.id));
const ci = d.structures.findIndex((s) => s.id === 'crypt');
d.structures.splice(ci + 1, 0, { id: 'goblinTunnel', level: 'goblin_tunnel', note: `UNDER-06 / OB-191: goblin tunnel campNorth <-> campEast (mouths ${A[0]}.5,${A[1]} and ${B[0]}.5,${B[1]}); keepTerrain, mesh physics`, origin: { x: X0, y: Y0, z: OZ }, yawSteps: 0 });
let n = 0;
const mesh = (id, m, x, y, z, yaw, sc) => d.structures.push({ id, mesh: 'quaternius/' + m, origin: { x: r2(x), y: r2(y), z: r2(z) }, scale: sc, yawDeg: yaw });
const rock = (m, x, y, z, yaw, sc) => mesh('goblinTunnelRock' + (++n), m, x, y, z, yaw, sc);
const RM = ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'];
// mouths: boulders flank the open slope up to the cover point, plus a cap rock over the junction (hides the square cut)
for (const [end, dirSign] of [[0, 1], [N - 1, -1]]) {
  let j = -1; for (let k = 0; k < N; k++) { const i = end === 0 ? k : N - 1 - k; if (coveredAt[i]) { j = i; break; } }
  const [mx, my] = path[end], [jx, jy] = path[j], len = Math.abs(jy - my);
  for (let t = 0, i = 0; t <= len + 1; t += 2.1, i++) for (const sx of [-1, 1]) { const x = mx + 0.5 + sx * (2.6 + (i % 2) * 0.5), y = my + 0.5 + dirSign * (t + 0.5), z = groundAt(x, y) - 0.5; rock(RM[(i + (sx > 0 ? 1 : 0)) % 3], x, y, z, 40 * i + (sx > 0 ? 90 : 0), 1.0 + 0.1 * (i % 3)); }
  const cx = jx + 0.5, cy = jy + 0.5 - dirSign * 0.2;
  rock(RM[0], cx, cy, groundAt(cx, cy) - 0.2, 15, 1.3); rock(RM[2], cx + 0.8, cy + dirSign * 1.2, groundAt(cx, cy) - 0.3, 200, 1.5);
}
// bends + stash room: corner rocks and wall rocks (round off the square shell)
const FLR = (v) => r2(OZ + v);
const bend = (p, v) => { for (const [sx, sy] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) rock(RM[(n + 1) % 3], p[0] + 0.5 + sx, p[1] + 0.5 + sy, FLR(v) - 0.1, 37 * n, 0.9); };
bend(P1, fr[iAt(...P1)]); bend(P2, fr[iAt(...P2)]);
const rx0 = SIDE.x - SIDE.w, rx1 = SIDE.x + SIDE.w + 1, ry0 = SIDE.y0, ry1 = SIDE.y1 + 1;
[[rx0 + 0.3, ry0 + 0.3, 1.4], [rx1 - 0.3, ry0 + 0.3, 1.4], [rx0 + 0.3, ry1 - 0.3, 1.4], [rx1 - 0.3, ry1 - 0.3, 1.4], [rx0 + 0.2, (ry0 + ry1) / 2, 1.1], [rx1 - 0.2, (ry0 + ry1) / 2, 1.1], [SIDE.x - 2.5, ry1 - 0.2, 1.0], [SIDE.x + 3.5, ry1 - 0.2, 1.0]].forEach(([x, y, s], i) => rock(RM[i % 3], x, y, FLR(sideF) - 0.1, 41 * i, s));
for (let i = 5; i < N - 5; i += 9) { const [x, y, dirY] = path[i]; for (const sd of [-1, 1]) { const px = dirY ? x + 0.5 + sd * 1.9 : x + 0.5, py = dirY ? y + 0.5 : y + 0.5 + sd * 1.9; if (coveredAt[i]) rock(RM[(i + sd + 3) % 3], px, py, FLR(fr[i]) - 0.2, 53 * i + sd * 20, 0.8); } }
[['Pebble_Round_1', rx0 + 2.0, ry0 + 1.5], ['Pebble_Square_2', rx1 - 2.2, ry0 + 2.0], ['Pebble_Round_3', rx0 + 2.4, ry1 - 1.6]].forEach(([m, x, y], i) => mesh('goblinTunnelRubble' + (i + 1), m, x, y, FLR(sideF), 29 * i, 1.0));
const CHX = r2(SIDE.x + 0.5), CHY = r2(ry1 - 0.7);
d.entities.push({ id: 'chestGoblinTunnel', type: 'prop', x: CHX, y: CHY, z: FLR(sideF), yawDeg: 0, components: { voxel: { anim: 'closed', loop: false, model: 'chestBig' } }, note: 'UNDER-06: the goblins\' stash (chestDefs.js table); earned: opens once the 3 tunnel goblins are dead' });
Object.assign(d.state, { 'under.goblinTunnel.chest.chestGoblinTunnel': false, 'under.goblinTunnel.cleared': false });
fs.writeFileSync(FILE, stringifyContent(d), 'utf8');
const man = JSON.parse(fs.readFileSync('content/manifest.json', 'utf8'));
if (!man.files.includes('levels/goblin_tunnel.level.json')) { man.files.splice(man.files.indexOf('levels/crypt.level.json') + 1, 0, 'levels/goblin_tunnel.level.json'); fs.writeFileSync('content/manifest.json', JSON.stringify(man, null, 2) + '\n', 'utf8'); }
console.log(JSON.stringify({ OZ, X0, Y0, W, H, N, chars: Object.keys(legend).length, sideZ: FLR(sideF), chest: [CHX, CHY], rocks: n, f0: FLR(fr[0]), fN: FLR(fr[N - 1]), open: coveredAt.filter((v) => !v).length }));
