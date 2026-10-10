// game/js/quest/mapCard.js (US-015, docs/architecture.md 7.6 item 8). The
// map-card panel: first show (0.5 s after the title fades out, minimum
// 1.0 s on screen before it can be dismissed), then a plain `M` toggle from
// the first dismissal until the end trigger. Uses the generic
// `engine/ui/panel.js` primitive - this module owns every game rule
// (timing, gating, the `M` binding) the panel itself knows nothing about.
import { buildPanelArt, createPanel, hexToRgb, drawPanel } from '../../../engine/index.js';
import { request as requestHint } from './hints.js';

let art = null;   // PanelArt, built once (palette/model are load-time constants)
let panel = null; // runtime Panel, rebuilt every 'world:loaded' (7.6 item 6)
let chartView = null;
let prevLocked = false; // pointer-lock state of the previous step (BUG-NOTE-ESC-01, same pattern as noteRead.js)

// MAP-01a pending: one replaceable semantic table, using existing chart colours.
export const CHART_GLYPHS = Object.freeze({
  grass: { glyph: '.', color: 'pencil' }, forest: { glyph: 'T', color: 'pencil' },
  water: { glyph: '~', color: 'aetherDim' }, rock: { glyph: ':', color: 'chartInk' },
  road: { glyph: '-', color: 'uiText' }, structure: { glyph: '#', color: 'ferrum' },
  steep: { glyph: '/', color: 'chartInk' },
  relay: { glyph: 'o', color: 'aetherDim' }, waystone: { glyph: 'O', color: 'aether' },
  quest: { glyph: '!', color: 'gold' }, questReady: { glyph: '?', color: 'gold' }, // QG-04: giver markers (dynamic, setQuestMarkers)
  player: { glyph: '^', color: 'gold' }, edge: { glyph: '+', color: 'chartEdge' },
  route: { glyph: '*', color: 'pencil' }, print: { glyph: 'N', color: 'chartInk' },
});

/** Load-time raster of the baked semantic planes. Pose updates touch two cells,
 * retaining the marker underneath; no per-frame lists, strings or allocations.
 */
export function createChartCard(chart, palette, { markers = [], glyphs = CHART_GLYPHS, width = 96, rows = 40, fog = null, travel = null, travelHeader = 'Travel: press a number' } = {}) {
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
  for (const key of [...chart.categories, 'relay', 'waystone', 'quest', 'questReady', 'player', 'edge', 'route', 'print']) {
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
  if(fog && (fog.bounds?.x0!==x0||fog.bounds?.y0!==y0||fog.bounds?.x1!==bounds.x1||fog.bounds?.y1!==bounds.y1))
    throw new Error('chart: incompatible fog bounds');
  function index(x,y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < x0 || y < y0 || x > x0+spanX || y > y0+spanY) return -1;
    return (1+Math.min(innerH-1,Math.floor((y-y0)*innerH/spanY)))*w+1+Math.min(innerW-1,Math.floor((x-x0)*innerW/spanX));
  }
  const markerCells = new Uint8Array(w*h);
  for (const marker of markers) {
    const i = marker ? index(marker.x,marker.y) : -1;
    if (i < 0 || !['relay','waystone'].includes(marker.kind)) throw new Error('chart: invalid marker');
    put(i,codes[marker.kind],colors[marker.kind]);
    markerCells[i]=1;
  }
  const baseCodes = chartArt.codes.slice(), baseRgb = chartArt.rgb.slice();
  const plainCodes = baseCodes.slice(), plainRgb = baseRgb.slice(); // static markers only (QG-04 restores cells from here)
  const fullCodes = fog ? baseCodes.slice() : null, fullRgb = fog ? baseRgb.slice() : null;
  const baseMarker = markerCells.slice(); // markerCells without digits/quest (restore)
  const qCells = []; // cells currently holding a quest marker
  let fogRevision = -1;
  let previous = -1;
  function revealed(i){
    const x=i%w,y=Math.floor(i/w);
    return fog.isExplored(x0+(x-1+.5)*spanX/innerW,y0+(y-1+.5)*spanY/innerH);
  }
  function refreshFog(){
    if(!fog||fogRevision===fog.revision)return;
    chartArt.codes.set(fullCodes);chartArt.rgb.set(fullRgb);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const i=y*w+x;
      if(!revealed(i)){chartArt.codes[i]=32;chartArt.rgb[i*3]=0;chartArt.rgb[i*3+1]=0;chartArt.rgb[i*3+2]=0;}
    }
    for(let j=1;j<fog.routeCount;j++){
      let a=index(fog.routeX(j-1),fog.routeY(j-1)),b=index(fog.routeX(j),fog.routeY(j));
      if(a<0||b<0)continue;
      let ax=a%w,ay=Math.floor(a/w);const bx=b%w,by=Math.floor(b/w);
      const dx=Math.abs(bx-ax),dy=-Math.abs(by-ay),sx=ax<bx?1:-1,sy=ay<by?1:-1;let err=dx+dy;
      for(;;){
        const i=ay*w+ax;
        if(!markerCells[i]&&revealed(i))put(i,codes.route,colors.route);
        if(ax===bx&&ay===by)break;
        const e=2*err;if(e>=dy){err+=dy;ax+=sx;}if(e<=dx){err+=dx;ay+=sy;}
      }
    }
    const text='NOTHING', start=Math.floor((w-text.length)/2), row=Math.floor(h/2);
    for(let x=0;x<text.length;x++){
      const i=row*w+start+x;if(!revealed(i))put(i,text.charCodeAt(x),colors.print);
    }
    baseCodes.set(chartArt.codes);baseRgb.set(chartArt.rgb);
    previous=-1;fogRevision=fog.revision;
  }
  refreshFog();
  /** QG-04: replace the dynamic quest markers; list = [{kind:'quest'|'questReady', x, y}]. Off-map entries are skipped. */
  function setQuestMarkers(list) {
    const tc = fog ? fullCodes : baseCodes, tr = fog ? fullRgb : baseRgb;
    for (const i of qCells) { tc[i] = plainCodes[i]; tr[i*3] = plainRgb[i*3]; tr[i*3+1] = plainRgb[i*3+1]; tr[i*3+2] = plainRgb[i*3+2]; markerCells[i] = 0; }
    qCells.length = 0;
    for (const m of list) {
      if (m.kind !== 'quest' && m.kind !== 'questReady') throw new Error('chart: invalid quest marker');
      const i = index(m.x, m.y); if (i < 0 || markerCells[i]) continue;
      tc[i] = codes[m.kind]; tr[i*3] = colors[m.kind][0]; tr[i*3+1] = colors[m.kind][1]; tr[i*3+2] = colors[m.kind][2];
      markerCells[i] = 1; qCells.push(i);
    }
    if (fog) fogRevision = -1; else { chartArt.codes.set(baseCodes); chartArt.rgb.set(baseRgb); }
    previous = -1;
    refreshFog();
  }
  /** WS1-07a: one-cell marker update. kind = 'relay'|'waystone' (permanent static marker, e.g. a wake) or a digit 1-9
   * (number or string; shown only until the next setTravelPoints). Off-map -> false. No re-raster. */
  const digitCells = []; // cells currently showing a travel digit
  function writeCell(i, code, color) {
    const tc = fog ? fullCodes : baseCodes, tr = fog ? fullRgb : baseRgb;
    tc[i] = code; tr[i*3] = color[0]; tr[i*3+1] = color[1]; tr[i*3+2] = color[2];
  }
  function applyBase() {
    if (fog) fogRevision = -1; else { chartArt.codes.set(baseCodes); chartArt.rgb.set(baseRgb); }
    previous = -1; refreshFog();
  }
  function setMarker(x, y, kind, silent = false) {
    const i = index(x, y); if (i < 0) return false;
    const d = typeof kind === 'number' ? kind : /^[1-9]$/.test(kind) ? +kind : 0;
    if (d >= 1 && d <= 9) {
      writeCell(i, 48 + d, colors.waystone); markerCells[i] = 1; digitCells.push(i);
    } else if (kind === 'relay' || kind === 'waystone') {
      plainCodes[i] = codes[kind]; plainRgb[i*3] = colors[kind][0]; plainRgb[i*3+1] = colors[kind][1]; plainRgb[i*3+2] = colors[kind][2];
      writeCell(i, codes[kind], colors[kind]); markerCells[i] = 1;
    } else throw new Error('chart: invalid marker kind');
    if (!silent) applyBase();
    return true;
  }
  // travel line: text on the bottom border row (static strings built only when the card opens or a wake happens)
  const lineColor = hexToRgb(palette.colors.uiText || palette.colors[glyphs.print.color]);
  const travelIds = []; let travelLine = '';
  function setTravelPoints(list) {
    for (const i of digitCells) { // restore digit cells to the static marker underneath
      writeCell(i, plainCodes[i], [plainRgb[i*3], plainRgb[i*3+1], plainRgb[i*3+2]]);
      if (!qCells.includes(i)) markerCells[i] = baseMarker[i];
    }
    digitCells.length = 0; travelIds.length = 0;
    const pts = [];
    for (const p of list || []) if (p && p.touched !== false && p.woken !== false && index(p.x, p.y) >= 0) pts.push(p);
    if (pts.some((p) => typeof p.order === 'number')) pts.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    let text = '';
    for (let k = 0; k < pts.length && k < 9; k++) {
      setMarker(pts[k].x, pts[k].y, k + 1, true); travelIds.push(pts[k].id);
      text += (k ? '  ' : '') + (k + 1) + ' ' + pts[k].name;
    }
    travelLine = text ? travelHeader + '   ' + text : '';
    if (travelLine.length > w - 4) travelLine = travelLine.slice(0, w - 4);
    const row = (h - 1) * w, tc = fog ? fullCodes : baseCodes, tr = fog ? fullRgb : baseRgb;
    for (let x = 0; x < w; x++) { // border back to edge glyph, then the text centred on it
      tc[row + x] = plainCodes[row + x]; tr[(row + x)*3] = plainRgb[(row + x)*3]; tr[(row + x)*3+1] = plainRgb[(row + x)*3+1]; tr[(row + x)*3+2] = plainRgb[(row + x)*3+2];
    }
    const pad = travelLine ? 1 : 0, start = ((w - travelLine.length) >> 1) - pad;
    for (let x = -pad; x < travelLine.length + pad; x++) { // one blank cell either side of the text
      const c = x < 0 || x >= travelLine.length ? 32 : travelLine.charCodeAt(x), i = row + start + pad + x;
      tc[i] = c; tr[i*3] = lineColor[0]; tr[i*3+1] = lineColor[1]; tr[i*3+2] = lineColor[2];
    }
    applyBase();
    return pts.length;
  }
  function refreshTravel() { return travel ? setTravelPoints(travel.list()) : 0; }
  /** Digit n (1-9) -> travel id of the n-th shown point, or null. */
  function travelIdFor(n) { return n >= 1 && n <= travelIds.length ? travelIds[n - 1] : null; }
  const arrows = [94,62,118,60]; // yaw 0 north (-y), 90 east, 180 south, 270 west
  const position = { x: -1, y: -1, code: 0 };
  return {
    art: chartArt, position, fog, setQuestMarkers, setMarker, setTravelPoints, refreshTravel, travelIdFor, onTravel: null,
    get travelLine() { return travelLine; },
    updatePose(x,y,yawDeg) {
      refreshFog();
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

const DIGIT_KEYS = ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9'];
/** WS1-07a: digit key with a shown travel point -> onTravel(id), card closes; else false (normal close rule). */
function pickTravel(input) {
  for (let n = 1; n <= 9; n++) {
    if (!input.pressed(DIGIT_KEYS[n-1]) && !input.pressed('Numpad' + n)) continue;
    const id = chartView.travelIdFor(n);
    if (id === null) return false;
    input.consumePressed();
    panel.close();
    if (chartView.onTravel) chartView.onTravel(id);
    return true;
  }
  return false;
}
export function getMapPanel() { return panel; }
export function isMapOpen() { return !!panel && panel.state !== 'closed'; }
export function getMapChart() { return chartView; }

/** Host draw seam: blank fog cells need an opaque plate too (drawPanel skips spaces). */
export function drawMapCard(ui,timeMs,lut=null) {
  if(!panel||panel.state==='closed')return;
  if(chartView?.fog){
    const a=panel.art;
    for(let y=0;y<a.h;y++)for(let x=0;x<a.w;x++)if(a.codes[y*a.w+x]===32)
      ui.setCellRGB(panel.x0+x,panel.y0+y,0,0,0,0,0,0,0);
  }
  drawPanel(ui,panel,timeMs,lut);
}

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
 * @param {boolean} [locked] pointer-lock state this step (BUG-NOTE-ESC-01: Chrome eats Esc under pointer
 * lock - releases the lock, no keydown reaches the page - so a lock-lost edge while the card is open closes
 * it, same pattern as noteRead.js's stepNoteRead). `locked` undefined (old callers) = never auto-closes.
 */
export function stepMapCard(world, assets, dt, input, wakeT, titleDoneAtSec, locked) {
  if (!panel) return;
  if (typeof locked === 'boolean') {
    if (prevLocked && !locked && panel.state !== 'closed') panel.close();
    prevLocked = locked;
  }
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
      if (chartView) chartView.refreshTravel();
      panel.open();
      world.state['ui.mapCard.opened'] = true;
    }
  } else if (chartView && panel.state !== 'closing' && pickTravel(input)) {
    return;
  } else if (input.anyPressed()) {
    // `M`, Esc (the browser drops pointer lock itself - accepted, 7.6 item
    // 5) or any other key closes it.
    input.consumePressed();
    panel.close();
  }
}
