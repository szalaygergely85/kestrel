// game/js/quest/mapCard.js (US-015, docs/architecture.md 7.6 item 8). The
// map-card panel: first show (0.5 s after the title fades out, minimum
// 1.0 s on screen before it can be dismissed), then a plain `M` toggle from
// the first dismissal until the end trigger. Uses the generic
// `engine/ui/panel.js` primitive - this module owns every game rule
// (timing, gating, the `M` binding) the panel itself knows nothing about.
import { buildPanelArt, createPanel, hexToRgb } from '../../../engine/index.js';
import { request as requestHint } from './hints.js';

let art = null;   // PanelArt, built once (palette/model are load-time constants)
let panel = null; // runtime Panel, rebuilt every 'world:loaded' (7.6 item 6)
let chartView = null;

// MAP-01a pending: one replaceable semantic table, using existing chart colours.
export const CHART_GLYPHS = Object.freeze({
  grass: { glyph: '.', color: 'pencil' }, forest: { glyph: 'T', color: 'pencil' },
  water: { glyph: '~', color: 'aetherDim' }, rock: { glyph: ':', color: 'chartInk' },
  road: { glyph: '-', color: 'uiText' }, structure: { glyph: '#', color: 'ferrum' },
  steep: { glyph: '/', color: 'chartInk' },
  relay: { glyph: 'o', color: 'aetherDim' }, waystone: { glyph: 'O', color: 'aether' },
  player: { glyph: '^', color: 'gold' }, edge: { glyph: '+', color: 'chartEdge' },
});

/** Load-time raster of the baked semantic planes. Pose updates touch two cells,
 * retaining the marker underneath; no per-frame lists, strings or allocations.
 */
export function createChartCard(chart, palette, { markers = [], glyphs = CHART_GLYPHS, width = 96, rows = 40 } = {}) {
  const bounds = chart?.bounds;
  if (chart?.chartVersion !== 1 || !Number.isInteger(chart.width) || chart.width < 1
    || !Number.isInteger(chart.rows) || chart.rows < 1 || chart.width * chart.rows > 524288
    || !bounds || ![bounds.x0,bounds.y0,bounds.x1,bounds.y1].every(Number.isFinite)
    || bounds.x1 <= bounds.x0 || bounds.y1 <= bounds.y0 || chart.shadeLevels !== 16
    || !Array.isArray(chart.categories) || chart.categories.length < 1 || chart.categories.length > 10
    || new Set(chart.categories).size !== chart.categories.length
    || !Array.isArray(chart.glyphs) || !Array.isArray(chart.shades) || !Array.isArray(markers)
    || chart.glyphs.length !== chart.rows || chart.shades.length !== chart.rows
    || !Number.isInteger(width) || width < 16 || width > 128 || !Number.isInteger(rows) || rows < 8 || rows > 52)
    throw new Error('chart: invalid planes, bounds or card size');
  const colors = {}, codes = {};
  for (const key of [...chart.categories, 'relay', 'waystone', 'player', 'edge']) {
    const token = glyphs[key];
    if (!token || typeof token.glyph !== 'string' || !/^[!-~]$/.test(token.glyph)
      || !/^#[0-9a-f]{6}$/i.test(palette.colors[token.color] || '')) throw new Error('chart: invalid glyph/colour');
    codes[key] = token.glyph.charCodeAt(0); colors[key] = hexToRgb(palette.colors[token.color]);
  }
  for (let y = 0; y < chart.rows; y++) {
    if (typeof chart.glyphs[y] !== 'string' || chart.glyphs[y].length !== chart.width
      || typeof chart.shades[y] !== 'string' || chart.shades[y].length !== chart.width
      || !/^[0-9a-f]+$/i.test(chart.shades[y])) throw new Error('chart: invalid plane row');
    for (let x = 0; x < chart.width; x++) {
      const category = chart.glyphs[y].charCodeAt(x) - 48;
      if (category < 0 || category >= chart.categories.length) throw new Error('chart: unknown category');
    }
  }
  const w = width, h = rows, innerW = w - 2, innerH = h - 2;
  const chartArt = { w, h, nFrames: 1, codes: new Uint8Array(w*h), rgb: new Uint8Array(w*h*3), durMs: new Float64Array([1000]), loopMs: 1000 };
  function put(i, code, color, gain = 1) {
    chartArt.codes[i] = code;
    chartArt.rgb[i*3] = Math.round(color[0]*gain); chartArt.rgb[i*3+1] = Math.round(color[1]*gain); chartArt.rgb[i*3+2] = Math.round(color[2]*gain);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y*w+x;
    if (!x || !y || x === w-1 || y === h-1) { put(i,codes.edge,colors.edge); continue; }
    const sx = Math.min(chart.width-1,Math.floor((x-1+0.5)*chart.width/innerW));
    const sy = Math.min(chart.rows-1,Math.floor((y-1+0.5)*chart.rows/innerH));
    const category = chart.categories[chart.glyphs[sy].charCodeAt(sx)-48];
    put(i,codes[category],colors[category],0.65+0.35*parseInt(chart.shades[sy][sx],16)/15);
  }
  const x0 = bounds.x0, y0 = bounds.y0, spanX = bounds.x1-x0, spanY = bounds.y1-y0;
  function index(x,y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < x0 || y < y0 || x > x0+spanX || y > y0+spanY) return -1;
    return (1+Math.min(innerH-1,Math.floor((y-y0)*innerH/spanY)))*w+1+Math.min(innerW-1,Math.floor((x-x0)*innerW/spanX));
  }
  for (const marker of markers) {
    const i = marker ? index(marker.x,marker.y) : -1;
    if (i < 0 || !['relay','waystone'].includes(marker.kind)) throw new Error('chart: invalid marker');
    put(i,codes[marker.kind],colors[marker.kind]);
  }
  const baseCodes = chartArt.codes.slice(), baseRgb = chartArt.rgb.slice();
  let previous = -1;
  const arrows = [94,62,118,60]; // yaw 0 north (-y), 90 east, 180 south, 270 west
  const position = { x: -1, y: -1, code: 0 };
  return {
    art: chartArt, position,
    updatePose(x,y,yawDeg) {
      if (previous >= 0) {
        chartArt.codes[previous] = baseCodes[previous];
        chartArt.rgb[previous*3] = baseRgb[previous*3]; chartArt.rgb[previous*3+1] = baseRgb[previous*3+1]; chartArt.rgb[previous*3+2] = baseRgb[previous*3+2];
      }
      previous = Number.isFinite(yawDeg) ? index(x,y) : -1;
      if (previous < 0) { position.x = -1; position.y = -1; position.code = 0; return false; }
      const yaw = ((yawDeg%360)+360)%360, code = arrows[Math.floor((yaw+45)/90)%4];
      put(previous,code,colors.player);
      position.x = previous%w; position.y = Math.floor(previous/w); position.code = code;
      return true;
    },
  };
}

/** Call from the 'world:loaded' handler (first load AND every restart). */
export function initMapCard(assets, sceneCols, sceneRows, chartOptions = null) {
  const model = assets.model('mapCard');
  if (!art) art = buildPanelArt(model, assets.palette, 'show');
  const cfg = assets.uiStyle.mapCard;
  chartView = chartOptions ? createChartCard(chartOptions.chart, assets.palette, chartOptions) : null;
  panel = createPanel(chartView ? chartView.art : art, {
    fadeIn: cfg.fadeIn, fadeOut: cfg.fadeOut,
    sceneMul: cfg.sceneDim.bgMul, plateMul: cfg.plate.bgMul, platePad: cfg.plate.pad,
  });
  panel.layout(sceneCols, sceneRows, chartView ? Math.max(0,(assets.uiStyle.uiGrid.rows-panel.art.h)>>1) : model.layout.top,
    chartView ? assets.uiStyle.uiGrid.cols/2 : model.layout.centerX, assets.uiStyle.uiGrid);
  return panel;
}

export function getMapPanel() { return panel; }
export function isMapOpen() { return !!panel && panel.state !== 'closed'; }
export function getMapChart() { return chartView; }

/**
 * `wakeTitleDoneAtSec` = the wake timeline's fixed "title has fully faded
 * out" time (seconds since world load, from `wakeTitleDoneAtSec(cfg)` in
 * wake.js) - the first-show delay (`cfg.showOnce.delaySec`) is measured
 * from there, off the same `quest.wakeT` clock the wake sequence uses (kept
 * running after the wake ends - see main.js).
 * @param {import('../../../engine/index.js').World} world
 * @param {Object} assets - AssetRegistry (palette/uiStyle)
 * @param {number} dt
 * @param {import('../../../engine/index.js').Input} input
 * @param {number} wakeT
 * @param {number} titleDoneAtSec
 */
export function stepMapCard(world, assets, dt, input, wakeT, titleDoneAtSec) {
  if (!panel) return;
  panel.step(dt);
  if (chartView && panel.state !== 'closed') {
    const player = world.get('player');
    const t = player?.data?.transform;
    if (t) chartView.updatePose(t.x,t.y,t.yawDeg);
    else chartView.updatePose(NaN,NaN,NaN);
  }
  const uiStyle = assets.uiStyle;
  const cfg = uiStyle.mapCard;
  const ending = typeof world.state['quest.endT'] === 'number' && world.state['quest.endT'] >= 0;

  // Owner request (2026-09-27): no automatic first show - the card is
  // `M`-only from the start. The old showOnce/minShowSec/dismiss timeline
  // (cfg.showOnce/minShowSec/dismiss, design/models/title.js) is unused now;
  // left in uiStyle for the moment rather than editing a shared content file
  // for a behaviour-only change. Latches `dismissed` true (without ever
  // calling panel.open()) at the same relative moment the auto-open used to
  // fire (title fade + delaySec), purely to keep the "Press M to read the
  // chart" hint's pacing unchanged. Also covers restored/legacy state where
  // `shown` is already true but `dismissed` isn't (the old mid-first-show
  // case) - latches immediately rather than ever locking `M` out.
  if (!world.state['ui.mapCard.dismissed']) {
    if (!world.state['ui.mapCard.shown']) {
      if (wakeT < titleDoneAtSec + cfg.showOnce.delaySec) return; // not yet
      world.state['ui.mapCard.shown'] = true;
    }
    world.state['ui.mapCard.dismissed'] = true;
    world.state['hints.chartT'] = 0; // arms the "Press M to read the chart" 20 s timer (hints.js stepHints)
    requestHint(world, uiStyle, 'move');
    return;
  }

  if (ending) return; // never during the end sequence/screen
  if (panel.state === 'closed') {
    if (input.pressed('KeyM')) {
      input.consumePressed();
      panel.open();
      world.state['ui.mapCard.opened'] = true;
    }
  } else if (input.anyPressed()) {
    // `M`, Esc (the browser drops pointer lock itself - accepted, 7.6 item
    // 5) or any other key closes it.
    input.consumePressed();
    panel.close();
  }
}
