// game/js/ui/titleCard.test.js (US-015). Headless Node ESM, no framework.
// Run: node game/js/ui/titleCard.test.js
import { initTitleCard, drawTitleCard } from './titleCard.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const titleModel = {
  size: { w: 6, h: 1 }, keys: { h: { c: 'hot' } },
  layout: { top: 18, centerX: 80 },
  animations: { show: { durations: [1000], frames: [{ S: { glyphs: ['###:.#'], fg: ['hhhhhh'] } }] } },
  shine: { period: 2.0, width: 3, slope: 0, color: 'white', amount: 1.0 }, // amount=1 -> fully white inside the band
};
const subModel = {
  size: { w: 3, h: 1 }, keys: {}, layout: { belowTitle: 1 },
  animations: { show: { durations: [1000], frames: [{ S: { glyphs: ['sub'], fg: ['   '] } }] } },
};
const assets = {
  palette: { colors: { hot: '#ff0000', white: '#ffffff' } },
  uiStyle: { uiGrid: { cols: 160, rows: 60 } },
  model(key) { return key === 'title' ? titleModel : subModel; },
};

function fakeRt(cols = 160, rows = 60) {
  const cells = new Map();
  return { cols, rows, setCellRGB(x, y, gi, r, g, b) { cells.set(`${x},${y}`, { gi, r, g, b }); }, _cells: cells };
}

initTitleCard(assets, 160, 60);

// ---- gating: no draw before/after the title is on screen ----
{
  const rt = fakeRt();
  drawTitleCard(rt, 0, 0, 'none', null);
  drawTitleCard(rt, 0, 0, 'done', null);
  ok('titleState none/done draws nothing', rt._cells.size === 0);
}

// ---- basic draw during "in": glyph colour = the resolved palette colour, no shine ----
{
  const rt = fakeRt();
  drawTitleCard(rt, 500, 1, 'in', null); // a=1, no fade
  const c0 = rt._cells.get('77,18'); // titleX0 = 80 - 3 = 77 at 1:1 grid
  ok('logo glyph drawn at the expected cell', !!c0);
  ok('no shine tint outside the hold', c0 && c0.r === 255 && c0.g === 0 && c0.b === 0);
}

// ---- shine: only during "hold", only on '#' cells, lerps toward white by `amount` ----
{
  const rt = fakeRt();
  // period=2.0, span = w+32 = 38, pos = -16 + (timeMs/1000 % 2)/2 * 38.
  // At timeMs=0: pos=-16. slope=0, so d = x - pos = x+16. width=3 -> d in [0,3) -> x in [-16,-13): never inside the 0..5 glyph range.
  // Pick timeMs so pos lands ON the first '#' column (x=0): pos=0 -> x - 0 in [0,3) -> x in {0,1,2} lit.
  // phase*38 = 16 -> phase = 16/38; timeMs = phase*2000
  const timeMs = (16 / 38) * 2000;
  drawTitleCard(rt, timeMs, 1, 'hold', null);
  const litHash = rt._cells.get('77,18'); // x=0 in the art, a '#'
  const unlitHash = rt._cells.get('82,18'); // x=5 in the art ('#'), outside the [0,3) band
  const colonCell = rt._cells.get('80,18'); // x=3 is ':' (drop shadow glyph, never shines even if inside the band)
  ok('a "#" glyph inside the shine band is lerped toward white (amount=1 -> fully white)',
    !!litHash && litHash.r === 255 && litHash.g === 255 && litHash.b === 255, JSON.stringify(litHash));
  ok('a "#" glyph outside the shine band keeps its plain colour', !!unlitHash && unlitHash.r === 255 && unlitHash.g === 0 && unlitHash.b === 0);
  ok('a non-"#" glyph is never shined even if geometrically inside the band', !!colonCell && colonCell.r === 255 && colonCell.g === 0 && colonCell.b === 0);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
