// game/js/quest/worldMap.js (WM-10, D-076/D-077): the `M` card as a WHOLE-MAP view of the open map, drawn in ASCII.
// Pure data + preallocated buffers (no DOM). compose() rasters the card once per open (walk-bounds polygon from WM-05, sea inside the
// coast polygon, region outlines + approved names for regions in `region.seen`; unvisited regions stay dim fog: dark '.', unnamed,
// no outline) plus the marker lists (relays/waystones, travel digits, quest marks). Per frame only updatePose runs: it swaps two
// cells (player arrow by yaw) and allocates nothing. Same surface mapCard.js/main.js use on the chart card.
import { hexToRgb } from '../../../engine/index.js';
import { regionIdAt } from './regionBanner.js';

const CELL_ASPECT = 2; // a glyph cell is ~2x as tall as wide
const MARGIN = 40;     // metres around the walk-bounds bbox

/** World box shown: bbox of the walk-bounds polygon + margin. */
export function worldBox(geo) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of geo.bounds.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0: x0 - MARGIN, y0: y0 - MARGIN, x1: x1 + MARGIN, y1: y1 + MARGIN };
}

/** Card size in cells (border included) that fits a ui grid with room for the plate; keeps the world's aspect. */
export function worldMapSize(box, uiCols, uiRows) {
  const a = (box.x1 - box.x0) / (box.y1 - box.y0);
  let h = Math.max(12, Math.min(58, uiRows - 8)), w = Math.round(h * CELL_ASPECT * a);
  const maxW = Math.max(24, uiCols - 8);
  if (w > maxW) { w = maxW; h = Math.max(12, Math.round(w / (CELL_ASPECT * a))); }
  return { w, h };
}

function inPoly(P, x, y) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++)
    if (((P[i][1] > y) !== (P[j][1] > y)) && (x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0])) inside = !inside;
  return inside;
}

/** @param {Object} geo world_geo (bounds, coast, regions)  @param {Object} names region id -> approved name | null
 *  @param {Object} palette {colors}  @param {{getSeen:function():string[]|undefined, w:number, h:number, travel?:Object, travelHeader?:string}} o */
export function createWorldMapCard(geo, names, palette, { getSeen, w, h, travel = null, travelHeader = 'Travel: 1-9, or arrows and Enter', lockUnseen = false }) {
  const box = worldBox(geo), innerW = w - 2, innerH = h - 2, N = innerW * innerH, spanX = box.x1 - box.x0, spanY = box.y1 - box.y0;
  const col = (k, g = 1) => { const c = hexToRgb(palette.colors[k] || '#888888'); return [c[0] * g, c[1] * g, c[2] * g]; };
  const C = { edge: col('chartEdge', 0.8), land: col('pencil', 0.8), fog: col('chartInk', 0.28), sea: col('aetherDim', 0.7), bound: col('ferrum'),
    line: col('chartInk', 0.9), name: col('uiText'), relay: col('aetherDim'), waystone: col('aether'), quest: col('gold'), player: col('gold') };
  const art = { w, h, nFrames: 1, codes: new Uint8Array(w * h), rgb: new Uint8Array(w * h * 3), durMs: new Float64Array([1000]), loopMs: 1000 };
  const baseCodes = new Uint8Array(w * h), baseRgb = new Uint8Array(w * h * 3);
  const regIdx = new Int16Array(N), inB = new Uint8Array(N), sea = new Uint8Array(N);
  const rIds = geo.regions.map((r) => r.id), nR = rIds.length, seenFlag = new Uint8Array(nR);
  const cellX = (cx) => box.x0 + (cx + 0.5) * spanX / innerW, cellY = (cy) => box.y0 + (cy + 0.5) * spanY / innerH;
  /** world (x, y) -> card cell index (y*w+x, border included); -1 outside the box */
  function index(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < box.x0 || y < box.y0 || x > box.x1 || y > box.y1) return -1;
    return (1 + Math.min(innerH - 1, Math.floor((y - box.y0) * innerH / spanY))) * w + 1 + Math.min(innerW - 1, Math.floor((x - box.x0) * innerW / spanX));
  }
  for (let cy = 0; cy < innerH; cy++) for (let cx = 0; cx < innerW; cx++) { // static classification, once
    const x = cellX(cx), y = cellY(cy), i = cy * innerW + cx;
    regIdx[i] = rIds.indexOf(regionIdAt(geo.regions, x, y)); inB[i] = inPoly(geo.bounds.pts, x, y) ? 1 : 0; sea[i] = inPoly(geo.coast.pts, x, y) ? 1 : 0;
  }
  function put(i, code, c) { baseCodes[i] = code; baseRgb[i * 3] = c[0]; baseRgb[i * 3 + 1] = c[1]; baseRgb[i * 3 + 2] = c[2]; }

  // marker lists (world metres); statics = woken relays/waystones (persist), digits = current travel points, quest = giver marks
  const statics = [], staticKinds = [], dig = [], digIds = [], quest = [], questKinds = [];
  const labelMask = new Uint8Array(w * h); // VISQA-14: card cells holding a region-name letter; markers never overwrite them
  /** A marker cell that lands on a label letter slides along its row to the nearest free cell (the name keeps every letter). */
  function free(i) {
    if (i < 0 || !labelMask[i]) return i;
    for (let d = 1; d < 40; d++) { if (!labelMask[i - d]) return i - d; if (!labelMask[i + d]) return i + d; }
    return i;
  }
  const labels = []; // flat [cellX, cellY, len, regionIdx] of the placed names (tests read these)
  let travelLine = '', previous = -1, dirty = true, sel = -1, noticeText = '', travelNames = [], travelBase = '';
  const position = { x: -1, y: -1, code: 0 };

  function compose() {
    const seen = getSeen() || [];
    for (let k = 0; k < nR; k++) seenFlag[k] = seen.indexOf(rIds[k]) >= 0 ? 1 : 0;
    labels.length = 0; labelMask.fill(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!x || !y || x === w - 1 || y === h - 1) { put(i, 35, C.edge); continue; }
      const ci = (y - 1) * innerW + x - 1, r = regIdx[ci];
      if (!inB[ci]) { if (sea[ci]) put(i, 126, C.sea); else put(i, 32, C.edge); continue; }
      const eR = x === w - 2 || !inB[ci + 1], eD = y === h - 2 || !inB[ci + innerW], eL = x === 1 || !inB[ci - 1], eU = y === 1 || !inB[ci - innerW];
      if (eR || eD || eL || eU) { put(i, 35, C.bound); continue; } // WM-05 bounds polygon
      if (!seenFlag[r]) { put(i, 46, C.fog); continue; }
      const dx = regIdx[ci + 1] !== r && inB[ci + 1] === 1, dy = regIdx[ci + innerW] !== r && inB[ci + innerW] === 1;
      if (dx || dy) put(i, dx && dy ? 43 : dx ? 124 : 45, C.line); else put(i, 46, C.land);
    }
    for (let k = 0; k < nR; k++) { // names of seen regions: centred on the region's land, never over another name
      const nm = names[rIds[k]]; if (!seenFlag[k] || !nm) continue;
      let sx = 0, sy = 0, cnt = 0;
      for (let ci = 0; ci < N; ci++) if (regIdx[ci] === k && inB[ci]) { sx += ci % innerW; sy += (ci / innerW) | 0; cnt++; }
      if (!cnt) continue;
      const cy = Math.round(sy / cnt), xc = Math.max(0, Math.min(innerW - nm.length, Math.round(sx / cnt - nm.length / 2)));
      for (let d = 0, done = false; d < 14 && !done; d++) for (let s = 0; s < (d ? 2 : 1) && !done; s++) for (let sh = 0; sh <= nm.length && !done; sh++) {
        const row = s ? cy + d : cy - d, x0 = xc - sh; if (row < 0 || row >= innerH || x0 < 0) continue; // shift left when the centre hits the bounds edge
        let fit = true;
        for (let q = 0; q < nm.length && fit; q++) {
          const ci = row * innerW + x0 + q, cc = baseCodes[(row + 1) * w + x0 + q + 1];
          fit = inB[ci] === 1 && (cc === 46 || cc === 45 || cc === 124 || cc === 43); // may spill over a neighbour's land / outline, never over another name or the bounds line
        }
        if (!fit) continue;
        for (let q = 0; q < nm.length; q++) { put((row + 1) * w + x0 + q + 1, nm.charCodeAt(q), C.name); labelMask[(row + 1) * w + x0 + q + 1] = 1; }
        labels.push(x0, row, nm.length, k); done = true;
      }
    }
    for (let k = 0; k < statics.length; k += 2) { const i = free(index(statics[k], statics[k + 1])); if (i >= 0) put(i, staticKinds[k >> 1] === 'waystone' ? 79 : 111, staticKinds[k >> 1] === 'waystone' ? C.waystone : C.relay); }
    for (let k = 0; k < dig.length; k += 2) { const i = free(index(dig[k], dig[k + 1])); if (i >= 0) put(i, 49 + (k >> 1), C.waystone); }
    for (let k = 0; k < quest.length; k += 2) { const i = free(index(quest[k], quest[k + 1])); if (i >= 0) put(i, questKinds[k >> 1] === 'quest' ? 33 : 63, C.quest); }
    const row = (h - 1) * w, st = (w - travelLine.length) >> 1; // travel line centred on the bottom border
    for (let q = -1; q <= travelLine.length && travelLine; q++) put(row + st + q, q < 0 || q >= travelLine.length ? 32 : travelLine.charCodeAt(q), C.name);
    art.codes.set(baseCodes); art.rgb.set(baseRgb); previous = -1; dirty = false;
  }
  function setMarker(x, y, kind) {
    if (index(x, y) < 0) return false;
    if (kind !== 'relay' && kind !== 'waystone') { if (typeof kind === 'number' || /^[1-9]$/.test(kind)) return true; throw new Error('worldMap: invalid marker kind'); }
    statics.push(x, y); staticKinds.push(kind); dirty = true; return true;
  }
  function setQuestMarkers(list) {
    quest.length = 0; questKinds.length = 0;
    for (const m of list) {
      if (m.kind !== 'quest' && m.kind !== 'questReady') throw new Error('worldMap: invalid quest marker');
      if (index(m.x, m.y) >= 0) { quest.push(m.x, m.y); questKinds.push(m.kind); }
    }
    compose();
  }
  // WMP-05: with lockUnseen, a point in a region not in region.seen gets no digit and cannot be selected.
  const isLocked = (p) => (getSeen() || []).indexOf(regionIdAt(geo.regions, p.x, p.y)) < 0;
  function buildTravelLine() {
    let text = '';
    for (let k = 0; k < travelNames.length; k++) text += (k ? '  ' : '') + (k === sel ? '>' : '') + (k + 1) + ' ' + travelNames[k];
    travelLine = noticeText || (text ? travelHeader + '   ' + text : '');
    if (travelLine.length > w - 4) travelLine = travelLine.slice(0, w - 4);
    dirty = true;
  }
  function setTravelPoints(list) {
    dig.length = 0; digIds.length = 0; travelNames.length = 0; sel = -1; noticeText = '';
    const pts = [];
    for (const p of list || []) if (p && p.touched !== false && p.woken !== false && index(p.x, p.y) >= 0 && !(lockUnseen && isLocked(p))) pts.push(p);
    if (pts.some((p) => typeof p.order === 'number')) pts.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    for (let k = 0; k < pts.length && k < 9; k++) { dig.push(pts[k].x, pts[k].y); digIds.push(pts[k].id); travelNames.push(pts[k].name); }
    buildTravelLine(); return digIds.length;
  }
  /** WMP-05: arrow keys move the highlight over the woken relays (wraps); first press from "none" picks the first (+1) or last (-1). */
  function moveSelection(d) {
    const n = digIds.length; if (!n) return -1;
    sel = sel < 0 ? (d > 0 ? 0 : n - 1) : (sel + d + n) % n; noticeText = ''; buildTravelLine(); return sel;
  }
  function setNotice(text) { noticeText = text || ''; buildTravelLine(); }
  const arrows = [94, 62, 118, 60]; // yaw 0 north (-y), 90 east, 180 south, 270 west
  compose();
  return {
    art, position, fog: null, opaque: true, overlay: null, box, index, labels, onTravel: null, innerW, innerH,
    get travelLine() { return travelLine; },
    setMarker, setQuestMarkers, setTravelPoints, refreshTravel: () => (travel ? setTravelPoints(travel.list()) : 0),
    setChartPieces() { compose(); return true; }, // card opens: re-read region.seen + markers
    moveSelection, setNotice, selectedId: () => (sel >= 0 ? digIds[sel] : null), get selected() { return sel; },
    travelIdFor: (k) => (k >= 1 && k <= digIds.length ? digIds[k - 1] : null),
    updatePose(x, y, yawDeg) { // 0 alloc: two cells
      if (dirty) compose();
      if (previous >= 0) { art.codes[previous] = baseCodes[previous]; art.rgb[previous * 3] = baseRgb[previous * 3]; art.rgb[previous * 3 + 1] = baseRgb[previous * 3 + 1]; art.rgb[previous * 3 + 2] = baseRgb[previous * 3 + 2]; }
      previous = Number.isFinite(yawDeg) ? free(index(x, y)) : -1;
      if (previous < 0) { position.x = -1; position.y = -1; position.code = 0; return false; }
      const code = arrows[Math.floor((((yawDeg % 360) + 360) % 360 + 45) / 90) % 4];
      art.codes[previous] = code; art.rgb[previous * 3] = C.player[0]; art.rgb[previous * 3 + 1] = C.player[1]; art.rgb[previous * 3 + 2] = C.player[2];
      position.x = previous % w; position.y = (previous / w) | 0; position.code = code; return true;
    },
  };
}
