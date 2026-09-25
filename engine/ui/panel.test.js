// engine/ui/panel.test.js (US-015). Headless Node ESM, no framework.
// Run: node engine/ui/panel.test.js
import { buildPanelArt, createPanel, drawPanel, Panel } from './panel.js';
import { createSceneDim, resetSceneDim } from './sceneDim.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const palette = { colors: { red: '#ff0000', blue: '#0000ff' } };
const model = {
  size: { w: 3, h: 2 },
  keys: { r: { c: 'red' }, b: { c: 'blue' } },
  animations: {
    show: {
      durations: [100, 200],
      frames: [
        { S: { glyphs: ['A B', ' C '], fg: ['r r', ' b '] } },
        { S: { glyphs: ['XYZ', 'WVU'], fg: ['bbb', 'rrr'] } },
      ],
    },
  },
};

// ---- buildPanelArt ----
{
  const art = buildPanelArt(model, palette, 'show');
  ok('w/h/nFrames match the model', art.w === 3 && art.h === 2 && art.nFrames === 2);
  ok('loopMs = sum of durations', art.loopMs === 300);
  ok('space glyph -> code 0 (transparent)', art.codes[1] === 0); // frame0 row0 col1 = ' '
  ok('non-space glyph -> its own char code', art.codes[0] === 'A'.charCodeAt(0));
  const ri = 0 * 3;
  ok('key color resolved to rgb', art.rgb[ri] === 255 && art.rgb[ri + 1] === 0 && art.rgb[ri + 2] === 0); // 'r' -> red
}

// ---- Panel state machine ----
{
  const art = buildPanelArt(model, palette, 'show');
  const panel = createPanel(art, { fadeIn: 0.5, fadeOut: 0.25 });
  ok('starts closed, a=0', panel.state === 'closed' && panel.a === 0);
  panel.open();
  ok('open() -> opening', panel.state === 'opening');
  panel.step(0.25);
  ok('halfway through fadeIn: a=0.5', Math.abs(panel.a - 0.5) < 1e-9, panel.a);
  panel.step(0.25);
  ok('fadeIn complete: state=open, a=1', panel.state === 'open' && panel.a === 1);
  panel.step(1.0);
  ok('openSec keeps counting while open', panel.openSec > 1.0, panel.openSec);
  panel.close();
  ok('close() -> closing', panel.state === 'closing');
  panel.step(0.25);
  ok('fadeOut complete (0.25s / 0.25s fadeOut): state=closed, a=0, openSec reset', panel.state === 'closed' && panel.a === 0 && panel.openSec === 0);
}

// ---- layout: UI-grid centre scaling, size stays in cells ----
{
  const art = buildPanelArt(model, palette, 'show');
  const panel = createPanel(art);
  panel.layout(160, 60, 10, 80, { cols: 160, rows: 60 }); // 1:1 grid -> scene
  ok('160x60 (1:1): x0 centred on 80, y0=10', panel.x0 === 80 - 1 && panel.y0 === 10);
  panel.layout(320, 120, 10, 80, { cols: 160, rows: 60 }); // 2x scale
  ok('320x120 (2x): centre scales, size (art.w) does not', panel.x0 === 160 - 1 && panel.y0 === 20 && art.w === 3);
}

// ---- pushDim: whole-scene dim + plate rect, both lerp(1, mul, a) ----
{
  const art = buildPanelArt(model, palette, 'show');
  const panel = createPanel(art, { sceneMul: 0.4, plateMul: 0.2, platePad: 1 });
  panel.x0 = 5; panel.y0 = 5;
  panel.state = 'open'; panel.a = 0.5;
  const dim = createSceneDim();
  resetSceneDim(dim);
  panel.pushDim(dim);
  ok('dim.all = lerp(1, 0.4, 0.5) = 0.7', Math.abs(dim.all - 0.7) < 1e-9, dim.all);
  ok('one plate rect pushed', dim.n === 1);
  ok('plate rect padded by platePad', dim.rects[0] === 4 && dim.rects[1] === 4 && dim.rects[2] === 5 + 3 + 1 && dim.rects[3] === 5 + 2 + 1);
}

// ---- pushDim: OWN-REQ-003 - UI-cell rect converted to scene cells via ui.sx/sy ----
{
  const art = buildPanelArt(model, palette, 'show');
  const panel = createPanel(art, { plateMul: 0.2, platePad: 1 });
  panel.x0 = 5; panel.y0 = 5; // UI cells
  panel.state = 'open'; panel.a = 1;
  const dim = createSceneDim();
  resetSceneDim(dim);
  panel.pushDim(dim, { sx: 2, sy: 2 }); // 320x120 scene over a 160x60 UI grid
  ok('plate rect scaled to scene cells (x2)', dim.rects[0] === 8 && dim.rects[1] === 8 && dim.rects[2] === 18 && dim.rects[3] === 16, Array.from(dim.rects.subarray(0, 4)));
  resetSceneDim(dim);
  panel.pushDim(dim); // no `ui` -> identity (sx=sy=1), same as the plain scene-grid case above
  ok('no `ui` arg -> identity scaling', dim.rects[0] === 4 && dim.rects[1] === 4 && dim.rects[2] === 9 && dim.rects[3] === 8);
}

// ---- drawPanel: frame-by-time, skips transparent, honors closed state ----
function fakeRt(cols, rows) {
  const cells = new Map();
  return { cols, rows, setCellRGB(x, y, gi, r, g, b, r2, g2, b2) { cells.set(`${x},${y}`, { gi, r, g, b }); }, _cells: cells };
}
{
  const art = buildPanelArt(model, palette, 'show');
  const panel = createPanel(art);
  panel.x0 = 0; panel.y0 = 0; panel.state = 'closed';
  const rt = fakeRt(10, 10);
  drawPanel(rt, panel, 0, null);
  ok('closed panel draws nothing', rt._cells.size === 0);

  panel.state = 'open'; panel.a = 1;
  drawPanel(rt, panel, 50, null); // t=50 < durations[0]=100 -> frame 0
  ok('frame 0 drawn: glyph A at (0,0)', rt._cells.get('0,0').gi === 'A'.charCodeAt(0) - 32);
  ok('transparent cell (row 0 col 1 = " ") not drawn', !rt._cells.has('1,0'));

  rt._cells.clear();
  drawPanel(rt, panel, 150, null); // t=150 in [100,300) -> frame 1
  ok('frame 1 drawn: glyph X at (0,0)', rt._cells.get('0,0').gi === 'X'.charCodeAt(0) - 32);

  rt._cells.clear();
  drawPanel(rt, panel, 350, null); // wraps: 350 % 300 = 50 -> frame 0 again
  ok('time wraps at loopMs', rt._cells.get('0,0').gi === 'A'.charCodeAt(0) - 32);
}

// ---- Panel is exported as a class (createPanel returns an instance) ----
ok('createPanel returns a Panel instance', createPanel(buildPanelArt(model, palette, 'show')) instanceof Panel);

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
