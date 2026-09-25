// engine/world/packed.test.js (US-025). Headless Node ESM, no framework.
// Run: node engine/world/packed.test.js
import { loadLevel } from './Level.js';
import { packLevel, SKY_H } from './packed.js';
// US-027b: tower/test_room moved to content/levels/*.level.json.
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

const { globals } = await loadTestAssets();
const towerRawDef = globals.levels.tower;
const testRoomRawDef = globals.levels.test_room;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// Tiny fake MaterialTable: deterministic small ids per key, no allocation
// per call after the first sighting (same contract as the real one).
function fakeMatTable() {
  const ids = new Map();
  let next = 1;
  return { idFor(key) { if (!ids.has(key)) ids.set(key, next++); return ids.get(key); } };
}

function approxEq(a, b, eps = 1e-4) { return Math.abs(a - b) <= eps; }

function checkLevel(name, def) {
  const level = loadLevel(def);
  const table = fakeMatTable();
  const packed = packLevel(level, table);

  let allMatch = true;
  for (let cy = 0; cy < level.height && allMatch; cy++) {
    for (let cx = 0; cx < level.width && allMatch; cx++) {
      const i = cy * level.width + cx;
      const s = level.sectorAt(cx + 0.5, cy + 0.5);
      if (!s) continue;
      const ceilSky = s.ceilH === 'sky';
      const topSky = s.topH === 'sky' || (s.topH === undefined && ceilSky);
      const gi = i * 4;
      if (!approxEq(packed.geom[gi], s.floorH)) allMatch = false;
      if (ceilSky) { if (packed.geom[gi + 1] < 1e29) allMatch = false; }
      else if (!approxEq(packed.geom[gi + 1], s.ceilH)) allMatch = false;
      const expectTopH = topSky ? null : (s.topH !== undefined ? s.topH : (ceilSky ? null : s.ceilH));
      if (topSky) { if (packed.geom[gi + 2] < 1e29) allMatch = false; }
      else if (!approxEq(packed.geom[gi + 2], expectTopH)) allMatch = false;
      if (packed.mats[gi] !== table.idFor(s.wallMat)) allMatch = false;
      if (packed.mats[gi + 1] !== table.idFor(s.floorMat)) allMatch = false;
      const expectCeilMat = ceilSky ? 0 : table.idFor(s.ceilMat);
      if (packed.mats[gi + 2] !== expectCeilMat) allMatch = false;
      if (packed.mats[gi + 3] !== table.idFor(s.upperMat || s.wallMat)) allMatch = false;
      const expectSolid = s.solid ? 1 : 0;
      if ((packed.flags[i] & 1) !== expectSolid) allMatch = false;
      if (((packed.flags[i] >> 1) & 1) !== (ceilSky ? 1 : 0)) allMatch = false;
      if (((packed.flags[i] >> 2) & 1) !== (topSky ? 1 : 0)) allMatch = false;
    }
  }
  ok(`${name}: packed geom/mats/flags == level.sectorAt for every cell`, allMatch);
  return { level, table, packed };
}

checkLevel('test_room', testRoomRawDef);
const { level: towerLevel, table } = checkLevel('tower', towerRawDef);

// --- after animateSector('grate', 0.5) --------------------------------------
const g = towerLevel.legend['G'];
const before = g.ceilH;
g.ceilH = g.floorH + (g.dynamic.ceilOpen - g.floorH) * 0.5; // same math World.animateSector uses
const packed2 = packLevel(towerLevel, table);
const gCell = { cx: null, cy: null };
outer:
for (let cy = 0; cy < towerLevel.height; cy++) {
  for (let cx = 0; cx < towerLevel.width; cx++) {
    if (towerLevel.rows[cy][cx] === 'G') { gCell.cx = cx; gCell.cy = cy; break outer; }
  }
}
ok('grate cell found in the tower grid', gCell.cx !== null);
const gi = (gCell.cy * towerLevel.width + gCell.cx) * 4;
ok('packed geom.ceilH reflects animateSector(0.5) exactly', approxEq(packed2.geom[gi + 1], g.ceilH), `${packed2.geom[gi + 1]} vs ${g.ceilH}`);
ok('packed flags bit3 (dynamic) is set on the grate cell', (packed2.flags[gCell.cy * towerLevel.width + gCell.cx] & 8) !== 0);
g.ceilH = before;

// --- US-007 ARCH CHANGES item 3: computeMaxH includes a raised open,
// sky-ceilinged floor (previously skipped by `else if (f & FLAG_CEIL_SKY)
// continue`, so a roofless upper platform never bounded the sun DDA escape).
{
  const legend = {
    '.': { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false },
    'P': { floorH: 5, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false }, // raised open sky-ceilinged platform
  };
  const raisedDef = { name: '__maxHRaisedSky', legend, rows: ['..', '.P'], start: { x: 0.5, y: 0.5, facingDeg: 90 } };
  const raisedLevel = loadLevel(raisedDef);
  const raisedPacked = packLevel(raisedLevel, fakeMatTable());
  ok('computeMaxH: a raised open sky-ceilinged floor (floorH=5) sets maxH=5, not 0',
    approxEq(raisedPacked.maxH, 5), `maxH=${raisedPacked.maxH}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
