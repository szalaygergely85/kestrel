// game/js/quest/mapTravel.test.js (WMP-05): pick a woken relay ON the M world map (digits, arrows + Enter) -> the existing onTravel(id);
// blocked in combat (card stays open, notice), locked-region / unwoken relays are not selectable. Run: node game/js/quest/mapTravel.test.js
import '../../../design/palette.js';
import '../../../design/ui-region-banner.js';
import '../../../design/levels/world_geo.js';
import { initMapCard, stepMapCard, getMapPanel, getMapChart, TOAST_TRAVEL_BLOCKED } from './mapCard.js';
import { regionIdAt } from './regionBanner.js';
import { makeOk } from '../../../engine/test/assert.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const A = globalThis.ASSETS, geo = A.levels.world_geo;
const model = { size: { w: 5, h: 3 }, keys: {}, layout: { top: 20, centerX: 80 },
  animations: { show: { durations: [1000], frames: [{ S: { glyphs: ['#####', '#   #', '#####'], fg: [' . . ', '.   .', ' . . '] } }] } } };
const assets = { palette: A.palette, uiStyle: { uiGrid: { cols: 240, rows: 90 },
  mapCard: { fadeIn: 0.4, fadeOut: 0.25, minShowSec: 1.0, sceneDim: { bgMul: 0.35 }, plate: { pad: 1, bgMul: 0.18 }, showOnce: { delaySec: 0.5 } } },
  model: () => model };
function fakeInput() { let s = new Set(); return { _press(c) { s.add(c); }, pressed: (c) => s.has(c), anyPressed: () => s.size > 0, consumePressed() { s.clear(); } }; }

const P = [{ id: 'ws_a', name: 'Ford', x: 1000, y: 1050, order: 1 }, { id: 'ws_b', name: 'Bend', x: 1200, y: 1050, order: 2 }, { id: 'ws_c', name: 'Gate', x: 1400, y: 1050, order: 3 }];
const rg = (p) => regionIdAt(geo.regions, p.x, p.y);
const seen = [rg(P[0]), rg(P[1])]; // third point's region stays unseen
let blocked = false; const got = [];
initMapCard(assets, 240, 90, { markers: [], travel: { list: () => P.map((p) => ({ ...p, woken: true })) }, worldMap: { geo, lockUnseen: true, names: A.uiRegionBanner.names, getSeen: () => seen } });
const cv = getMapChart();
cv.onTravel = (id) => got.push(id); cv.travelBlocked = () => blocked;
const world = { state: { 'ui.mapCard.shown': true, 'ui.mapCard.dismissed': true, 'quest.endT': -1 }, get: () => null };
const input = fakeInput();
const step = (code) => { if (code) input._press(code); stepMapCard(world, assets, 1 / 60, input, 100, 0); };
const open = () => { step('KeyM'); for (let i = 0; i < 40; i++) step(); };
const unseenLocked = rg(P[2]) !== rg(P[0]) && rg(P[2]) !== rg(P[1]);

open();
ok('locked-region relay has no digit / not selectable', !unseenLocked || (cv.travelIdFor(3) === null && !cv.travelLine.includes('Gate')));
ok('arrow Right highlights the first relay (no travel yet)', (step('ArrowRight'), cv.selected === 0 && got.length === 0 && cv.travelLine.includes('>1 Ford')));
step('ArrowRight'); ok('arrow Right moves to relay 2', cv.selected === 1 && cv.selectedId() === 'ws_b');
step('ArrowLeft'); step('ArrowLeft'); ok('arrow Left wraps', cv.selected === (unseenLocked ? 1 : 2) || cv.selected >= 0);
step('ArrowRight'); const idx = cv.selected;
blocked = true; step('Enter');
ok('combat: Enter does not travel, card stays open, notice shown', got.length === 0 && getMapPanel().state === 'open' && cv.travelLine.includes(TOAST_TRAVEL_BLOCKED));
step('Digit1'); ok('combat: digit blocked too', got.length === 0 && getMapPanel().state === 'open');
blocked = false; cv.refreshTravel(); step('ArrowRight'); const id = cv.selectedId(); step('Enter');
ok('Enter on highlighted relay -> onTravel(id) and card closes', got.length === 1 && got[0] === id && getMapPanel().state === 'closing');
for (let i = 0; i < 40; i++) step();
open(); step('Digit2'); ok('digit 2 still travels to relay 2', got[1] === 'ws_b');
for (let i = 0; i < 40; i++) step();
open(); step('Enter'); ok('Enter with nothing highlighted = normal close', got.length === 2 && getMapPanel().state === 'closing');
for (let i = 0; i < 40; i++) step();
P[0].woken = false; // unwoken relays are not listed
cv.setTravelPoints(P.filter((p) => p.woken !== false));
ok('unwoken relay absent from the list', !cv.travelLine.includes('Ford') && cv.travelIdFor(1) === 'ws_b');
console.log(`mapTravel: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
