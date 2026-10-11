// MAP-28: world overlay on the M chart - chart pieces unfog their area, labels sit inside their region.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../../../design/palette.js';
import '../../../design/levels/overworld_far.js';
import '../../../design/levels/world_geo.js';
import {createMapFog} from './mapFog.js';
import {createChartCard} from './mapCard.js';
import {buildWorldOverlay, AREAS, LABELS} from './mapWorld.js';

const A = globalThis.ASSETS, G = A.levels.world_geo, U = A.levels.overworld_far.util, palette = A.palette;
const chart = JSON.parse(readFileSync(new URL('../../../content/chart/world_m1.chart.json', import.meta.url)));
const W = 96, H = 40, iw = W - 2, ih = H - 2;

// labels: <= 16 chars, ASCII, wholly inside their own region (or the declared sub-area)
const ov = buildWorldOverlay(G, U, chart.bounds, iw, ih);
for (const L of ov.labels) {
  assert.ok(L.text.length <= 16 && /^[ -~]+$/.test(L.text), L.text);
  for (const c of L.cells) assert.ok(c >= 0 && (ov.area[c] === L.areaIdx || ov.area[c] === L.alsoIdx), `${L.text} outside ${L.area}`);
}
for (const id of ['The Quiet Sea', 'The Braid', 'Braidmouth', 'The Shearcliffs', 'The Hollins', 'Glasswater', "Ferrum's Wall", 'The Sealed Gate'])
  assert.ok(ov.labels.some((l) => l.text === id), id);
assert.equal(LABELS.length, ov.labels.length);
for (let a = 0; a < AREAS.length; a++) assert.ok(ov.areaCells[a].length > 0, 'area empty: ' + AREAS[a]);

// pick a river cell and a marsh cell (card coords)
const cardCell = (c) => (Math.floor(c / iw) + 1) * W + (c % iw) + 1;
const riverCell = cardCell(ov.areaCells[AREAS.indexOf('river')][0]);
const marshCell = cardCell(ov.areaCells[AREAS.indexOf('marsh')][0]);
const wx = (i) => chart.bounds.x0 + ((i % W) - 1 + .5) * (chart.bounds.x1 - chart.bounds.x0) / iw;
const wy = (i) => chart.bounds.y0 + (Math.floor(i / W) - 1 + .5) * (chart.bounds.y1 - chart.bounds.y0) / ih;

const fog = createMapFog(chart.bounds);
const view = createChartCard(chart, palette, {width: W, rows: H, fog, geo: {G, U}});
const codes = view.art.codes;
// label spaces are legitimately blank
const gap = new Set(); for (const L of ov.labels) L.cells.forEach((c, k) => { if (L.text[k] === ' ') gap.add(c); });
const text = (L) => Array.from(L.cells, (c) => String.fromCharCode(codes[cardCell(c)])).join('');
const braid = ov.labels.find((l) => l.text === 'The Braid');

// no piece, nothing visited: areas stay fogged, labels hidden
assert.equal(codes[riverCell], 32); assert.equal(codes[marshCell], 32);
assert.notEqual(text(braid), 'The Braid');
// visited as today: the cell unfogs by itself, the neighbouring area does not
fog.reveal(wx(marshCell), wy(marshCell)); view.updatePose(NaN, NaN, NaN); // the open card refreshes the fog every step
assert.notEqual(codes[marshCell], 32); assert.equal(codes[riverCell], 32);
// piece flag chart.river -> the whole river area, label included; the marsh stays as visited
const heap = process.memoryUsage().heapUsed;
assert.equal(view.setChartPieces((id) => id === 'river'), true);
for (const c of ov.areaCells[AREAS.indexOf("river")]) if (!gap.has(c)) assert.notEqual(codes[cardCell(c)], 32, "river cell " + c);
assert.equal(text(braid), 'The Braid');
assert.equal(text(ov.labels.find((l) => l.text === 'Braidmouth')), 'Braidmouth');
const lakeLabel = ov.labels.find((l) => l.text === 'Glasswater');
assert.notEqual(text(lakeLabel), 'Glasswater');           // other pieces not set
assert.equal(codes[cardCell(ov.areaCells[AREAS.indexOf('sea')][0])], 32);
// clearing the piece fogs it again
view.setChartPieces(() => false);
assert.equal(codes[riverCell], 32);
// all pieces: every area open; player marker/updatePose still fine
view.setChartPieces(() => true);
for (let a = 0; a < AREAS.length; a++) for (const c of ov.areaCells[a]) if (!gap.has(c)) assert.notEqual(codes[cardCell(c)], 32);
assert.equal(text(lakeLabel), 'Glasswater');
assert.ok(view.updatePose(1180, 1000, 90));
assert.ok(process.memoryUsage().heapUsed - heap < 8e6);

// no geo = the old chart, no pieces API effect
const plain = createChartCard(chart, palette, {width: W, rows: H});
assert.equal(plain.overlay, null); assert.equal(plain.setChartPieces(() => true), false);
console.log('mapWorld OK');
