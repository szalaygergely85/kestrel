/* design/levels/world_geo.js - WORLD GEOGRAPHY (designer, 2026-10-11, PROPOSED; owner asks for a real world map).
 * Plain script: sets ASSETS.levels.world_geo. NOT loaded by the game yet: it is the data + reference maths for the
 * new terrain-recipe layers (doc: docs/world-map-2026-10-11.md; preview: design/preview/world-map.html).
 * Frame = overworld_far.js: metres, x EAST, y SOUTH, z = metres relative to the tower ground floor (lowlands ~ -68).
 * Rule: every layer is multiplied by mask(x,y) = 0 inside `protect` (stage 0-3 play data: tower, meadow, road,
 * Bend Relay, ford, Ford Relay, crossroads, Outwall; signal-tower crown), so today's heights stay bit-identical there.
 * geoHeight(x, y, h0, U) takes h0 = overworld_far recipeHeight(x, y) and U = overworld_far.util (fbm, riverX).
 * Names marked P = PROPOSED (not canon yet).
 */
(function () {
  'use strict';
  var root = (typeof window !== 'undefined') ? window : globalThis;
  root.ASSETS = root.ASSETS || {}; root.ASSETS.levels = root.ASSETS.levels || {};

  var G = {
    version: 1, status: 'PROPOSED', seed: 7331,
    seaLevel: -96, snowLine: 110, rockLine: 40, alpineLine: 5,
    protect: { rect: [704, 832, 1728, 1344], discs: [{ x: 713.8, y: 1232.1, r: 160 }], margin: 150,
               note: 'architecture 38.42: stage 0-2 area x 704..1728, y 832..1344 unchanged. All layers x mask; mask = 0 inside rect/discs, smoothstep to 1 over margin' },
    // Data shapes for the terrain layers (38.42): engine coords, x east, y SOUTH, metres. Regions = axis rects [x0,y0,x1,y1]
    // (polygon = its 4 corners); river = overworld_far x_r(y) (sample it for a polyline); coast = closed polygon; ridges =
    // polylines + width; lake/marsh = rotated ellipses; biomes = biomeAt() rules over these shapes (no extra polygons).
    southTilt: { y0: 1250, y1: 1780, drop: 26, note: 'land falls toward the sea' },

    // ---- mountains: polyline spines, gaussian body + ridged noise crest ----
    ranges: [
      { id: 'whitecombs', name: 'the Whitecombs (P)', h: 230, w: 260, ridged: { scale: 170, amp: 90 }, seedOff: 71,
        pts: [[-40, 330], [250, 240], [560, 260], [860, 150], [1180, 110], [1500, 180], [1800, 140], [2100, 240]],
        gorge: { width: 90, keep: 0.25, note: 'the river cuts a notch: range height x 0.25 at the river' } },
      { id: 'westFells', name: 'the West Fells (P; was recipe.ridge)', h: 170, w: 190, ridged: { scale: 150, amp: 60 }, seedOff: 73,
        pts: [[110, 300], [190, 500], [240, 700], [230, 840], [260, 1000], [230, 1200], [170, 1430]] }
    ],
    peaks: [
      { id: 'oldPale', name: 'Old Pale (P)', x: 880, y: 120, h: 120, r: 140 },
      { id: 'p2', x: 420, y: 210, h: 80, r: 120 }, { id: 'p3', x: 1560, y: 150, h: 90, r: 130 },
      { id: 'p4', x: 1880, y: 110, h: 60, r: 110 }, { id: 'p5', x: 140, y: 620, h: 70, r: 110 }
    ],

    // ---- the Sealed Gate (P): fortified pass through the West Fells, locked until the Part II final quest ----
    gate: { id: 'sealedGate', name: 'the Sealed Gate (P)', x: 240, y: 840, locked: true, key: 'Part II final quest (post-release)',
            pass: { x: 250, y: 840, rx: 230, ry: 55, rot: 0.0, floor: -30, note: 'flatten toward floor inside e<0.6, blend to e=1' },
            wall: [[240, 778], [240, 902]], towers: [[240, 772], [240, 908]], doorW: 8, wallH: 14,
            note: 'stone curtain + 2 towers + barred gate (Medieval kit walls/arches). Beyond the gate: not built' },

    // ---- river: keep x_r(y) (overworld_far recipe.river); new bed profile only where mask > 0 ----
    river: { source: { name: 'Highspring tarn (P)', x: 1193, y: 130 }, mouth: { x: 1180, y: 1725 },
             estuaryWiden: { y0: 1450, y1: 1730, extra: 35 },
             bedNorth: [[100, 45], [300, -20], [420, -56], [600, -60], [760, -72]],
             bedSouth: [[1300, -92], [1500, -95], [1730, -99]], bedWidth: 40 },

    lake: { id: 'glasswater', name: 'Glasswater (P)', x: 1235, y: 505, rx: 165, ry: 90, rot: 0.2, surface: -58, depth: 10, shore: 0.3 },
    marsh: { id: 'reedmire', name: 'the Reedmire (P)', x: 1110, y: 1560, rx: 230, ry: 140, rot: 0.55, flatH: 0.8, blend: 0.4,
             pool: { scale: 40, threshold: 0.6 } },

    // ---- coast: sea polygon (sea INSIDE). kinds[k] = segment pts[k] -> pts[k+1] ----
    coast: {
      pts: [[-60, 1530], [120, 1500], [300, 1520], [470, 1470], [600, 1440], [700, 1420], [800, 1435], [880, 1500],
            [960, 1580], [1040, 1640], [1110, 1690], [1160, 1730], [1230, 1745], [1320, 1735], [1450, 1760],
            [1600, 1780], [1750, 1770], [1880, 1730], [1990, 1700], [2110, 1690], [2110, 2110], [-60, 2110]],
      kinds: ['cliff', 'cliff', 'cliff', 'cliff', 'cliff', 'cliff', 'beach', 'beach', 'beach', 'beach', 'beach', 'beach',
              'beach', 'beach', 'beach', 'beach', 'beach', 'cliff', 'cliff', 'open', 'open', 'open'],
      beachWidth: 90, beachH: 1.2, duneAt: 55, duneH: 3.5, cliffH: 22, cliffWidth: 12, cliffBack: 120,
      seabedSlope: 0.08, seabedMax: 14
    },

    // ---- the east: Ferrum's Wall (canon) is the 4th side; Ferrum is a horizon backdrop beyond the map ----
    wall: { name: 'the Wall', x0: 1985, amp: 14, period: 310, y0: 380, y1: 1705, h: 24, towerEvery: 160, ballistae: true,
            walkLimitX: 1880, note: 'x_w(y) = x0 + amp sin(y/period). Unwalkable; bounds stop at x 1880 (killing ground)' },
    ferrum: { name: 'Ferrum', x: 2450, y: 1000, tiers: [{ r: 430, z: 40, name: 'Low Wards' }, { r: 300, z: 110, name: 'mid tiers' },
              { r: 170, z: 190, name: 'the Crown' }], lights: 'amber', note: 'off-map silhouette, far LOD (like farTower)' },

    // ---- roads (halfWidth m). main = overworld_far recipe.path (unchanged) ----
    roads: [
      { id: 'main', name: 'the road (existing)', hw: 3, pts: [[1480, 1025], [1420, 1032], [1350, 1050], [1260, 1045], [1180, 1062], [1090, 1070], [1000, 1066]] },
      { id: 'oldWest', name: 'Old West Road (P)', hw: 2.5, pts: [[975, 1058], [880, 1052], [780, 1078], [695, 1090], [600, 1030], [460, 920], [330, 850], [240, 840], [0, 830]] },
      { id: 'northTrack', name: 'north track', hw: 2, pts: [[985, 1058], [905, 940], [960, 860], [1060, 760], [1110, 640], [1110, 560]] },
      { id: 'millTrack', hw: 2, pts: [[1060, 760], [1150, 800], [1195, 700], [1300, 620], [1520, 460]] },
      { id: 'southTrack', hw: 2, pts: [[1430, 1040], [1520, 1180], [1620, 1300], [1600, 1500], [1500, 1715]] },
      { id: 'coastPath', hw: 1.5, pts: [[1860, 1700], [1680, 1745], [1500, 1715], [1350, 1700], [1240, 1700]] },
      { id: 'fellsPath', hw: 1.5, pts: [[460, 920], [420, 640], [300, 400]] },
      { id: 'headPath', hw: 1.5, pts: [[695, 1090], [714, 1232], [760, 1380], [900, 1520]] }
    ],
    relayLine: [[1985, 1004], [1760, 1012], [1496.5, 1024.5], [1262, 1033], [992, 1079], [905, 940], [695, 1090], [713.8, 1232.1]],
    kestrelFall: { from: [1985, 1002], to: [1504, 1022], scraps: [[1880, 1006], [1790, 1009], [1690, 1013], [1600, 1016], [1540, 1019]] },

    // ---- regions (rect x0,y0,x1,y1; first match wins). forest: noise threshold (lower = denser) + tree kind ----
    // lv = zone level band (owner 2026-10-11; D-020: no XP - enemy strength / gear tier). Tower side of the river
    // (east) = 1-5, far side (west) = 5-10, rising with distance from the tower; the ford is the gateway; the Gate = Part II.
    regions: [
      { id: 'east', name: 'Ferrum\'s Wall (off-limits)', r: [1880, 0, 2048, 1720], forest: null, lv: null },
      { id: 'tower', name: 'Tower Hill + meadow', r: [1380, 930, 1600, 1130], forest: { thr: 0.55, kind: 'broadleaf' }, lv: [1, 1], stage: 0 },
      { id: 'roadWest', name: 'Road West + Bend', r: [1150, 960, 1380, 1130], forest: { thr: 0.55, kind: 'broadleaf' }, lv: [1, 2], stage: 1 },
      { id: 'ford', name: 'Ford + Crossroads', r: [940, 1010, 1150, 1130], forest: { thr: 0.55, kind: 'broadleaf' }, lv: [4, 5], stage: 2 },
      { id: 'whitecombs', name: 'the Whitecombs (P)', r: [0, 0, 2048, 330], forest: { thr: 0.62, kind: 'pine' }, lv: [5, 10], lvNote: 'east of the tarn 5, west of it 9-10' },
      { id: 'westFells', name: 'West Fells + Sealed Gate (P)', r: [0, 330, 340, 1520], forest: { thr: 0.6, kind: 'pine' }, lv: [9, 10] },
      { id: 'northwood', name: 'Northwood (P)', r: [1450, 330, 1880, 880], forest: { thr: 0.38, kind: 'pine' }, lv: [4, 5] },
      { id: 'glasswater', name: 'Glasswater + North Bank', r: [960, 330, 1450, 860], forest: { thr: 0.5, kind: 'broadleaf' }, lv: [4, 6], stage: 4, lvNote: 'east shore 4-5, west shore 6' },
      { id: 'alpine', name: 'High Pastures (P)', r: [340, 330, 960, 700], forest: { thr: 0.58, kind: 'pine' }, lv: [8, 9] },
      { id: 'thornwood', name: 'the Thornwood (P)', r: [560, 700, 860, 1150], forest: { thr: 0.34, kind: 'twisted' }, lv: [6, 7] },
      { id: 'outwall', name: 'Outwall fields', r: [860, 700, 960, 1010], forest: { thr: 0.8, kind: 'broadleaf' }, lv: [5, 6], stage: 3 },
      { id: 'ashMile', name: 'the Ash Mile (P)', r: [1680, 880, 1880, 1320], forest: { thr: 0.6, kind: 'dead' }, lv: [3, 4] },
      { id: 'downs', name: 'the Downs (P)', r: [1300, 1200, 1880, 1650], forest: { thr: 0.8, kind: 'broadleaf' }, flowers: 0.52, lv: [2, 3] },
      { id: 'signalHill', name: 'Signal Hill + Signal Head', r: [560, 1150, 880, 1440], forest: { thr: 0.66, kind: 'pine' }, lv: [7, 8], stage: 5 },
      { id: 'westHeath', name: 'the Heath coast (P)', r: [340, 1150, 560, 1540], forest: { thr: 0.72, kind: 'twisted' }, lv: [8, 9] },
      { id: 'reedmire', name: 'the Reedmire (P)', r: [880, 1300, 1300, 1720], forest: { thr: 0.75, kind: 'twisted' }, lv: [5, 7], lvNote: 'east bank 5, west bank 6-7' },
      { id: 'strand', name: 'the Long Strand (P)', r: [1300, 1650, 1880, 1800], forest: null, lv: [3, 4] },
      { id: 'heartland', name: 'river heartland', r: [0, 0, 2048, 2048], forest: { thr: 0.55, kind: 'broadleaf' }, flowers: 0.6, lv: [2, 3], lvWest: [5, 6] }
    ],

    // ---- sites: t = V village, F farm, R ruin, C camp, K cove, M mine/cave (shallow, NOT a dungeon), T watchtower,
    //      L relay, W waystone, G gate, P landmark. st = stage (D-060) or region; ex = exists in play data ----
    sites: [
      { t: 'L', n: 'Hollow Watchtower', x: 1496.5, y: 1024.5, st: 0, ex: 1 }, { t: 'W', n: 'meadow waystone', x: 1428, y: 1040, st: 0, ex: 1 },
      { t: 'L', n: 'Bend Relay', x: 1262, y: 1033, st: 1, ex: 1 }, { t: 'L', n: 'Ford Relay', x: 992, y: 1079, st: 2, ex: 1 },
      { t: 'P', n: 'stepping stones', x: 1028, y: 1068, st: 2 }, { t: 'R', n: 'crossroads ruin (Rook\'s nest)', x: 975, y: 1058, st: 2 },
      { t: 'F', n: 'trade post', x: 1000, y: 1066, st: 2 }, { t: 'P', n: 'straw targets', x: 978, y: 1092, st: 2 },
      { t: 'V', n: 'Outwall', x: 905, y: 940, st: 3 }, { t: 'L', n: 'Outwall relay', x: 912, y: 952, st: 3 },
      { t: 'F', n: 'Outwall barley farm', x: 975, y: 900, st: 3 }, { t: 'F', n: 'orchard', x: 930, y: 860, st: 3 },
      { t: 'F', n: 'goose farm', x: 860, y: 990, st: 3 }, { t: 'P', n: 'north look', x: 955, y: 1005, st: 2 },
      { t: 'R', n: 'north bank ruins', x: 1150, y: 800, st: 4 }, { t: 'F', n: 'river mill', x: 1195, y: 700, st: 4 },
      { t: 'F', n: 'fisher\'s jetty', x: 1100, y: 560, st: 4 }, { t: 'R', n: 'island ruin', x: 1270, y: 520, st: 4 },
      { t: 'C', n: 'reed-cutters\' camp', x: 1360, y: 560, st: 4 }, { t: 'K', n: 'Glasswater beach', x: 1180, y: 430, st: 4 },
      { t: 'L', n: 'ws_signalNorth', x: 695, y: 1090, st: 5 }, { t: 'L', n: 'Signal tower (Signal Source)', x: 713.8, y: 1232.1, st: 5 },
      { t: 'R', n: 'keeper\'s lodge', x: 790, y: 1180, st: 5 }, { t: 'K', n: 'Signal Head cove', x: 760, y: 1405, st: 5 },
      { t: 'C', n: 'woodcutters\' camp', x: 820, y: 1150, st: 'thornwood' }, { t: 'P', n: 'the hollow oak', x: 650, y: 960, st: 'thornwood' },
      { t: 'C', n: 'hunter\'s lodge', x: 760, y: 880, st: 'thornwood' }, { t: 'C', n: 'charcoal burners', x: 610, y: 1110, st: 'thornwood' },
      { t: 'R', n: 'moss shrine', x: 720, y: 790, st: 'thornwood' },
      { t: 'G', n: 'the Sealed Gate (P)', x: 240, y: 840, st: 'westFells' }, { t: 'R', n: 'gate garrison ruin', x: 360, y: 880, st: 'westFells' },
      { t: 'T', n: 'fells watchtower', x: 330, y: 1180, st: 'westFells' }, { t: 'M', n: 'copper adit', x: 200, y: 1060, st: 'westFells' },
      { t: 'F', n: 'shepherd\'s fold', x: 420, y: 640, st: 'westFells' }, { t: 'P', n: 'Fells falls', x: 270, y: 520, st: 'westFells' },
      { t: 'F', n: 'goatherds\' summer hut', x: 520, y: 420, st: 'alpine' }, { t: 'P', n: 'Highspring tarn', x: 1193, y: 130, st: 'whitecombs' },
      { t: 'P', n: 'Old Pale', x: 880, y: 120, st: 'whitecombs' }, { t: 'M', n: 'ice cave', x: 980, y: 250, st: 'whitecombs' },
      { t: 'C', n: 'hermit\'s shelter', x: 1450, y: 300, st: 'whitecombs' }, { t: 'P', n: 'snow cairn', x: 1700, y: 230, st: 'whitecombs' },
      { t: 'C', n: 'logging camp', x: 1600, y: 700, st: 'northwood' }, { t: 'T', n: 'old pine watchtower', x: 1720, y: 560, st: 'northwood' },
      { t: 'M', n: 'grey quarry', x: 1520, y: 460, st: 'northwood' }, { t: 'C', n: 'wolf den', x: 1800, y: 780, st: 'northwood' },
      { t: 'L', n: 'Ash Mile relay stump', x: 1760, y: 1012, st: 'ashMile' }, { t: 'R', n: 'burnt farmstead', x: 1740, y: 1230, st: 'ashMile' },
      { t: 'P', n: 'Kestrel scrap trail', x: 1650, y: 1015, st: 'ashMile' },
      { t: 'F', n: 'bee farm (Burl\'s honey)', x: 1530, y: 1190, st: 'downs' }, { t: 'F', n: 'shepherd\'s hut', x: 1620, y: 1310, st: 'downs' },
      { t: 'P', n: 'poppy fields', x: 1700, y: 1430, st: 'downs' }, { t: 'R', n: 'standing stones', x: 1480, y: 1480, st: 'downs' },
      { t: 'R', n: 'windmill ruin', x: 1800, y: 1540, st: 'downs' }, { t: 'C', n: 'drovers\' camp', x: 1380, y: 1330, st: 'downs' },
      { t: 'V', n: 'Gullhaven (P)', x: 1500, y: 1715, st: 'strand' }, { t: 'R', n: 'beach wreck', x: 1680, y: 1760, st: 'strand' },
      { t: 'C', n: 'dune camp', x: 1350, y: 1700, st: 'strand' }, { t: 'T', n: 'lighthouse ruin', x: 1865, y: 1705, st: 'strand' },
      { t: 'K', n: 'seal rocks', x: 1780, y: 1765, st: 'strand' },
      { t: 'C', n: 'stilt hut', x: 1150, y: 1560, st: 'reedmire' }, { t: 'L', n: 'Mire relay (side)', x: 1060, y: 1470, st: 'reedmire' },
      { t: 'P', n: 'eel weirs', x: 1210, y: 1660, st: 'reedmire' }, { t: 'P', n: 'heron rookery', x: 990, y: 1600, st: 'reedmire' },
      { t: 'F', n: 'peat cutters', x: 1250, y: 1440, st: 'reedmire' },
      { t: 'K', n: 'Gull Cove', x: 910, y: 1535, st: 'westHeath' }, { t: 'M', n: 'smugglers\' sea cave', x: 480, y: 1475, st: 'westHeath' },
      { t: 'R', n: 'heath chapel', x: 420, y: 1330, st: 'westHeath' }, { t: 'F', n: 'crofter farm', x: 560, y: 1300, st: 'westHeath' },
      { t: 'F', n: 'river farm', x: 1100, y: 1250, st: 'heartland' }, { t: 'R', n: 'old bridge piers', x: 1045, y: 1320, st: 'heartland' },
      { t: 'C', n: 'boar wallow', x: 1330, y: 1150, st: 'heartland' }, { t: 'P', n: 'flower meadow', x: 1300, y: 900, st: 'heartland' }
    ]
  };

  function smooth(a, b, x) { var t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy); t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(ax + dx * t - px, ay + dy * t - py);
  }
  function lineDist(pts, x, y) { var b = 1e9; for (var i = 1; i < pts.length; i++) { var d = segDist(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); if (d < b) b = d; } return b; }
  function ell(o, x, y) { var c = Math.cos(o.rot), s = Math.sin(o.rot), dx = x - o.x, dy = y - o.y, u = (dx * c + dy * s) / o.rx, v = (-dx * s + dy * c) / o.ry; return Math.sqrt(u * u + v * v); }
  function interp(p, y) { if (y <= p[0][0]) return p[0][1]; for (var i = 1; i < p.length; i++) if (y <= p[i][0]) { var t = (y - p[i - 1][0]) / (p[i][0] - p[i - 1][0]); return p[i - 1][1] + t * (p[i][1] - p[i - 1][1]); } return p[p.length - 1][1]; }
  function coastSD(x, y) {
    var P = G.coast.pts, n = P.length, inside = false, best = 1e9, kind = 'open';
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
      var d = segDist(x, y, xj, yj, xi, yi); if (d < best) { best = d; kind = G.coast.kinds[j]; }
    }
    return { sd: inside ? -best : best, kind: kind === 'open' ? 'cliff' : kind };
  }
  function mask(x, y) {
    var P = G.protect, r = P.rect, dx = Math.max(r[0] - x, 0, x - r[2]), dy = Math.max(r[1] - y, 0, y - r[3]);
    var m = smooth(0, P.margin, Math.hypot(dx, dy));
    for (var i = 0; i < P.discs.length; i++) { var D = P.discs[i]; m *= smooth(D.r, D.r + P.margin, Math.hypot(x - D.x, y - D.y)); }
    return m;
  }
  function riverHalfWidth(y) { var E = G.river.estuaryWiden; return 10 + E.extra * smooth(E.y0, E.y1, y); }
  function regionAt(x, y) { for (var i = 0; i < G.regions.length; i++) { var r = G.regions[i].r; if (x >= r[0] && x < r[2] && y >= r[1] && y < r[3]) return G.regions[i]; } return G.regions[G.regions.length - 1]; }

  // h0 = overworld_far recipeHeight(x, y); U = overworld_far.util. Returns the new height (h0 inside protect).
  function geoHeight(x, y, h0, U) {
    var m = mask(x, y); if (m <= 0) return h0;
    var h = h0 - G.southTilt.drop * smooth(G.southTilt.y0, G.southTilt.y1, y), i, e;
    var dr = Math.abs(x - U.riverX(y));
    for (i = 0; i < G.ranges.length; i++) {
      var R = G.ranges[i], d = lineDist(R.pts, x, y), f = Math.exp(-Math.pow(d / R.w, 2));
      if (f < 0.002) continue;
      var n = U.fbm(x / R.ridged.scale, y / R.ridged.scale, G.seed + R.seedOff, 4, 0.5, 2), rn = 1 - Math.abs(2 * n - 1);
      var add = R.h * f + R.ridged.amp * rn * rn * Math.exp(-Math.pow(d / (R.w * 0.7), 2));
      if (R.gorge) add *= 1 - (1 - R.gorge.keep) * Math.exp(-Math.pow(dr / R.gorge.width, 2));
      h += add;
    }
    for (i = 0; i < G.peaks.length; i++) { var p = G.peaks[i]; h += p.h * Math.exp(-Math.pow(Math.hypot(x - p.x, y - p.y) / p.r, 2)); }
    e = ell(G.gate.pass, x, y); if (e < 1) h += (G.gate.pass.floor - h) * smooth(1, 0.6, e);
    var Rv = G.river, bw = smooth(Rv.bedWidth, Rv.bedWidth * 0.4, dr);
    if (y < 780) h += (Math.min(h, interp(Rv.bedNorth, y)) - h) * bw;
    if (y > 1280) h += (Math.min(h, interp(Rv.bedSouth, y)) - h) * bw;
    var L = G.lake; e = ell(L, x, y);
    if (e < 1) h = Math.min(h, L.surface - L.depth * (1 - e * e)); else if (e < 1 + L.shore) h += (L.surface + 0.8 - h) * smooth(1 + L.shore, 1, e);
    var M = G.marsh; e = ell(M, x, y);
    if (e < 1 + M.blend) { var flat = G.seaLevel + M.flatH + 0.6 * (U.fbm(x / 30, y / 30, G.seed + 51, 2, 0.5, 2) - 0.5); h += (flat - h) * smooth(1 + M.blend, 1, e); }
    var C = G.coast, c = coastSD(x, y);
    if (c.sd < 0) h = G.seaLevel - Math.min(C.seabedMax, 1.5 + (-c.sd) * C.seabedSlope);
    else {
      if (h < G.seaLevel + 0.6) h = G.seaLevel + 0.6;
      if (c.kind === 'beach') {
        var bh = G.seaLevel + C.beachH + C.duneH * Math.exp(-Math.pow((c.sd - C.duneAt) / 25, 2)) * 2 * U.fbm(x / 35, y / 35, G.seed + 61, 2, 0.5, 2);
        h = bh + (h - bh) * smooth(0, C.beachWidth, c.sd);
      } else {
        var top = h + Math.max(0, G.seaLevel + C.cliffH - h) * smooth(C.cliffBack, 0, c.sd);
        h = (G.seaLevel - 3) + (top - G.seaLevel + 3) * smooth(0, C.cliffWidth, c.sd);
      }
    }
    return h0 + m * (h - h0);
  }

  // Biome key for the map + the scatter recipe (doc section 5). slope = |grad h| (m/m).
  function biomeAt(x, y, h, slope, U) {
    if (x >= G.wall.walkLimitX && y < G.wall.y1 + 20) return 'wallGround';
    var c = coastSD(x, y); if (c.sd < 0) return 'sea';
    var L = G.lake, eL = ell(L, x, y); if (eL < 1) return 'lake';
    var dr = Math.abs(x - U.riverX(y)), hw = riverHalfWidth(y); if (dr < hw && y > 120) return 'river';
    var eM = ell(G.marsh, x, y);
    if (eM < 1) return U.fbm(x / G.marsh.pool.scale, y / G.marsh.pool.scale, G.seed + 53, 2, 0.5, 2) > G.marsh.pool.threshold ? 'marshPool' : 'marsh';
    if (c.kind === 'beach' && c.sd < G.coast.beachWidth * 0.5) return 'sand';
    if (c.kind === 'beach' && c.sd < G.coast.beachWidth + 30) return 'dunes';
    if (c.kind === 'cliff' && c.sd < 18) return 'cliff';
    if (h > G.snowLine) return 'snow';
    if (h > G.rockLine || slope > 0.9) return 'rock';
    if (eL < 1 + L.shore * 0.6) return 'shore';
    if (dr < hw + 14) return 'reeds';
    var Rg = regionAt(x, y), F = Rg.forest;
    var fn = U.fbm(x / 280 + 17, y / 280 - 9, G.seed + 13, 3, 0.5, 2);
    var thr = F ? F.thr + (1 - mask(x, y)) * (0.55 - F.thr) : 2;   // inside protect: today's 0.55
    if (F && fn > thr && slope < 0.5 && dr > 30) {
      if (h > G.alpineLine - 40 && F.kind === 'broadleaf') return 'pine';
      return F.kind;
    }
    if (h > G.alpineLine) return 'alpine';
    if (Rg.id === 'ashMile') return 'ash';
    var fl = Rg.flowers || 0.62;
    if (U.fbm(x / 90, y / 90, G.seed + 41, 3, 0.5, 2) > fl) return 'flowers';
    return U.fbm(x / 140, y / 140, G.seed + 43, 2, 0.5, 2) > 0.52 ? 'grassTall' : 'grass';
  }


  // ---- MAP-01c (38.42): biome table for the scatter (ids >= 1; 0 = meadow = today's placements) + area fields ----
  // forest.fill <= 0.72 keeps a tree band under the ~4k visible-tree cap (cellM 6.5 -> 2.37 cells/100 m2 x fill; budget printed by
  // geoBiomes.test.js). species weights name existing recipe species (CommonTree/Pine meshes); TwistedTree/DeadTree have no LOD1 or
  // measured trunk yet, so those biomes use stand-ins (see `standIn`). scale/hueJitter are data for a later placement channel.
  var CT = function (a) { var o = {}; a.forEach(function (w, i) { o['quaternius/CommonTree_' + (i + 1)] = w; }); return o; };
  var PN = function (a) { var o = {}; a.forEach(function (w, i) { o['quaternius/Pine_' + (i + 1)] = w; }); return o; };
  var mix = function (a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; };
  G.biomes = {
    1: { name: 'broadleafForest', blendM: 24, forest: { fill: 0.72, species: CT([14, 14, 12, 10, 10]) }, detail: { rocks: 1.2 }, scale: [0.85, 1.2], hueJitter: 0.1 },
    2: { name: 'pineForest', blendM: 30, forest: { fill: 0.72, species: mix(PN([10, 10, 8, 6, 6]), CT([2, 2, 1, 0, 0])) }, detail: { rocks: 1.0 }, scale: [0.9, 1.4], hueJitter: 0.08 },
    3: { name: 'twistedWood', blendM: 20, standIn: 'TwistedTree_*', forest: { fill: 0.72, species: mix(CT([0, 0, 6, 14, 14]), PN([0, 0, 8, 0, 0])) }, detail: { rocks: 1.5 }, scale: [1.0, 1.6], hueJitter: 0.12 },
    4: { name: 'ashMile', blendM: 40, standIn: 'DeadTree_*', forest: { fill: 0.13, species: CT([0, 0, 0, 0, 1]) }, detail: { rocks: 0.6 }, scale: [0.8, 1.1], hueJitter: 0.15 },
    5: { name: 'flowerFields', blendM: 30, forest: { fill: 0.04, species: CT([1, 1, 1, 0, 0]) }, detail: { rocks: 0.3 }, scale: [0.9, 1.3], hueJitter: 0.4 },
    6: { name: 'grassFields', blendM: 30, forest: { fill: 0.06, species: CT([1, 1, 1, 0, 0]) }, detail: { rocks: 0.3 }, scale: [1.0, 1.5], hueJitter: 0.2 },
    7: { name: 'beachDunes', blendM: 60, forest: { fill: 0 }, detail: { rocks: 0.1 }, scale: [0.8, 1.2], hueJitter: 0.1 },
    8: { name: 'fen', blendM: 40, forest: { fill: 0.1, species: CT([0, 0, 0, 1, 1]) }, detail: { rocks: 0.2 }, scale: [1.0, 1.5], hueJitter: 0.1 },
    9: { name: 'alpineMeadow', blendM: 20, forest: { fill: 0.05, species: PN([1, 1, 1, 1, 1]) }, detail: { rocks: 0.5 }, scale: [0.8, 1.1], hueJitter: 0.08 }
  };
  var KIND_BIOME = { broadleaf: 1, pine: 2, twisted: 3, dead: 4 };
  function rectSd(r, x, y) {   // signed distance to an axis rect (negative inside)
    var cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, qx = Math.abs(x - cx) - (r[2] - r[0]) / 2, qy = Math.abs(y - cy) - (r[3] - r[1]) / 2;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
  }
  // {biomeId: sdf(x, y)}: union (min) of the region rects of one biome; beach strip along the 'beach' coast; fen = marsh ellipse.
  // The catch-all 'heartland' stays biome 0. Alpine/Downs override the pine/broadleaf kind of their region.
  function biomeAreas() {
    var rects = {}, id, i;
    for (i = 0; i < G.regions.length; i++) {
      var R = G.regions[i];
      if (R.id === 'heartland' || !R.forest && R.id !== 'downs') continue;
      id = R.id === 'downs' ? 5 : R.id === 'alpine' ? 9 : KIND_BIOME[R.forest.kind];
      if (id) (rects[id] = rects[id] || []).push(R.r);
    }
    var out = {};
    Object.keys(rects).forEach(function (k) { var L = rects[k]; out[k] = function (x, y) { var b = 1e9; for (var j = 0; j < L.length; j++) { var d = rectSd(L[j], x, y); if (d < b) b = d; } return b; }; });
    out[7] = function (x, y) { var c = coastSD(x, y); return c.kind === 'beach' ? c.sd - (G.coast.beachWidth + 30) : 1e3; };
    out[8] = function (x, y) { var M = G.marsh; return (ell(M, x, y) - 1) * Math.min(M.rx, M.ry); };
    return out;
  }
  // far = ASSETS.levels.overworld_far.util
  function installBiomes(far) { return far.setGeoBiomes(G.biomes, biomeAreas()); }

  // ---- MAP-02/03/05 (arch 38.42): the geography as composer layers (height + type), installed by installGeo(far) ----
  // Same maths as geoHeight() above, split per feature in geoHeight's own order (tilt/ridges/peaks/gate -> lake -> marsh -> coast; the
  // river bed is MAP-04's). The composer skips the keep rect by branch; outside it each layer blends in with mask(). With mask == 1
  // (>= 150 m outside the keep) a chain of layers equals geoHeight exactly (up to the 16 m GeoFields bilinear on coast/ridge distance).
  var WORLD_RECT = [0, 0, 4096, 4096];
  // Field builders run once per 16 m node. The coast sd + beach flag come from ONE alloc-free pass (the first field fn fills both tables;
  // GeoFields visits the nodes of one id at a time, in order, so the second reads the table by node index).
  function geoFieldFns() {
    var world = { x0: 0, y0: 0, x1: 4096, y1: 4096 }, W = Math.ceil((world.x1 - world.x0) / 16) + 1, H = W;
    var sdT = null, kindT = null;
    function fillCoast() {
      var P = G.coast.pts, K = G.coast.kinds, n = P.length;
      sdT = new Float32Array(W * H); kindT = new Uint8Array(W * H);
      for (var j = 0; j < H; j++) for (var i = 0; i < W; i++) {
        var x = world.x0 + i * 16, y = world.y0 + j * 16, inside = false, best = 1e18, kd = 0;
        for (var a = 0, b = n - 1; a < n; b = a++) {
          var xi = P[a][0], yi = P[a][1], xj = P[b][0], yj = P[b][1];
          if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
          var dx = xi - xj, dy = yi - yj, t = ((x - xj) * dx + (y - yj) * dy) / (dx * dx + dy * dy); t = t < 0 ? 0 : t > 1 ? 1 : t;
          var qx = xj + dx * t - x, qy = yj + dy * t - y, d = qx * qx + qy * qy;
          if (d < best) { best = d; kd = K[b] === 'beach' ? 1 : 0; }
        }
        best = Math.sqrt(best); sdT[i + j * W] = inside ? -best : best; kindT[i + j * W] = kd;
      }
    }
    var f = {
      coast: function (x, y) { if (sdT === null) fillCoast(); return sdT[(x / 16) + (y / 16) * W]; },
      beachK: function (x, y) { return kindT[(x / 16) + (y / 16) * W]; }
    };
    G.ranges.forEach(function (R) { f[R.id] = function (x, y) { return lineDist(R.pts, x, y); }; });
    return f;
  }
  function geoLayers(U, rockSlope) {
    var C = G.coast, L = G.lake, M = G.marsh, T = G.southTilt, sea = G.seaLevel;
    function bbox(o, k) { var r = Math.max(o.rx, o.ry) * k; return [o.x - r, o.y - r, o.x + r, o.y + r]; }
    return [
      { id: 'ridges', rect: WORLD_RECT, heightFn: function (h0, x, y, F) {       // MAP-03: southern tilt, ranges, peaks, Sealed Gate pass
          var m = mask(x, y); if (m <= 0) return h0;
          var h = h0 - T.drop * smooth(T.y0, T.y1, y), i, e, dr = Math.abs(x - U.riverX(y));
          for (i = 0; i < G.ranges.length; i++) {
            var R = G.ranges[i], d = F.sdf(R.id, x, y), f = Math.exp(-Math.pow(d / R.w, 2));
            if (f < 0.002) continue;
            var n = U.fbm(x / R.ridged.scale, y / R.ridged.scale, G.seed + R.seedOff, 4, 0.5, 2), rn = 1 - Math.abs(2 * n - 1);
            var add = R.h * f + R.ridged.amp * rn * rn * Math.exp(-Math.pow(d / (R.w * 0.7), 2));
            if (R.gorge) add *= 1 - (1 - R.gorge.keep) * Math.exp(-Math.pow(dr / R.gorge.width, 2));
            h += add;
          }
          for (i = 0; i < G.peaks.length; i++) { var p = G.peaks[i]; h += p.h * Math.exp(-Math.pow(Math.hypot(x - p.x, y - p.y) / p.r, 2)); }
          e = ell(G.gate.pass, x, y); if (e < 1) h += (G.gate.pass.floor - h) * smooth(1, 0.6, e);
          return h0 + m * (h - h0);
        } },
      { id: 'lake', rect: bbox(L, 1 + L.shore), heightFn: function (h, x, y) {   // MAP-05: Glasswater bowl + shore lip
          var e = ell(L, x, y); if (e >= 1 + L.shore) return h;
          var m = mask(x, y); if (m <= 0) return h;
          var hn = e < 1 ? Math.min(h, L.surface - L.depth * (1 - e * e)) : h + (L.surface + 0.8 - h) * smooth(1 + L.shore, 1, e);
          return h + m * (hn - h);
        } },
      { id: 'marsh', rect: bbox(M, 1 + M.blend), heightFn: function (h, x, y) {   // MAP-05: Reedmire, low flat wet ground
          var e = ell(M, x, y); if (e >= 1 + M.blend) return h;
          var m = mask(x, y); if (m <= 0) return h;
          var flat = sea + M.flatH + 0.6 * (U.fbm(x / 30, y / 30, G.seed + 51, 2, 0.5, 2) - 0.5);
          return h + m * (h + (flat - h) * smooth(1 + M.blend, 1, e) - h);
        } },
      { id: 'coast', rect: [0, 1420 - C.cliffBack - 10, 4096, 4096], heightFn: function (h, x, y, F) {   // MAP-02: sea floor, beach band, cliffs
          var sd = F.sdf('coast', x, y);
          if (sd >= C.cliffBack && sd >= C.beachWidth + 40) return h;
          var m = mask(x, y); if (m <= 0) return h;
          var hn = h;
          if (sd < 0) hn = sea - Math.min(C.seabedMax, 1.5 + (-sd) * C.seabedSlope);
          else {
            if (hn < sea + 0.6) hn = sea + 0.6;
            if (F.sdf('beachK', x, y) > 0.5) {
              var bh = sea + C.beachH + C.duneH * Math.exp(-Math.pow((sd - C.duneAt) / 25, 2)) * 2 * U.fbm(x / 35, y / 35, G.seed + 61, 2, 0.5, 2);
              hn = bh + (hn - bh) * smooth(0, C.beachWidth, sd);
            } else {
              var top = hn + Math.max(0, sea + C.cliffH - hn) * smooth(C.cliffBack, 0, sd);
              hn = (sea - 3) + (top - sea + 3) * smooth(0, C.cliffWidth, sd);
            }
          }
          return h + m * (hn - h);
        },
        typeFn: function (t, x, y, h, slope, F) {                       // sea 2, beach sand 5, cliff rock 3
          var sd = F.sdf('coast', x, y);
          if (sd < 0) return 2;
          if (F.sdf('beachK', x, y) > 0.5) return sd < C.beachWidth ? 5 : t;
          return sd < 18 ? 3 : t;
        } },
      { id: 'terrainTypes', rect: WORLD_RECT, typeFn: function (t, x, y, h, slope) {   // lake/marsh/snow/alpine/flowers
          var e = ell(L, x, y);
          if (e < 1) return 2;
          if (e < 1 + L.shore * 0.6) return 5;
          if (ell(M, x, y) < 1) return U.fbm(x / M.pool.scale, y / M.pool.scale, G.seed + 53, 2, 0.5, 2) > M.pool.threshold ? 7 : 8;
          if (h > G.snowLine + 25 * (U.fbm(x / 60, y / 60, G.seed + 81, 2, 0.5, 2) - 0.5) && slope <= rockSlope) return 6;   // steep faces stay rock
          if (t !== 0) return t;
          if (h > G.alpineLine) return 10;
          var fl = regionAt(x, y).flowers || 0.62;
          return U.fbm(x / 90, y / 90, G.seed + 41, 3, 0.5, 2) > fl ? 9 : t;
        } }
    ];
  }
  // far = ASSETS.levels.overworld_far.util. Layers + GeoFields (coast, ranges) + biomes. Call once, before any bake.
  function installGeo(far) {
    var rockSlope = root.ASSETS.levels.overworld_far.recipe.rock.slope;
    far.setGeoLayers(geoLayers(far, rockSlope), geoFieldFns());
    return installBiomes(far);
  }

  G.util = { biomeAreas: biomeAreas, installBiomes: installBiomes, installGeo: installGeo, geoLayers: geoLayers, geoFieldFns: geoFieldFns, geoHeight: geoHeight, biomeAt: biomeAt, mask: mask, coastSD: coastSD, regionAt: regionAt, riverHalfWidth: riverHalfWidth,
             wallX: function (y) { return G.wall.x0 + G.wall.amp * Math.sin(y / G.wall.period); }, ell: ell, lineDist: lineDist };
  root.ASSETS.levels.world_geo = G;
})();
