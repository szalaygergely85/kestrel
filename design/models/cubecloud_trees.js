/*
 * Kestrel - "cube-cloud" voxel trees (EXPERIMENT, owner concept art 2026-10-07; not wired into the game)
 * Owner: Designer. Preview: design/preview/cubecloud-trees.html
 *
 * PASS 2 (owner voxel-oak reference): leaves are CLUMPS (3D plus-shaped clusters of 3-7 small cubes) laid out in
 * 4-7 drooping, airy TIERS that sit on branch ends; trunks are built from a visible grid of small cubes in 3-4 bark
 * shades with flared root cubes; branches are chains of cubes on a bent (quadratic Bezier) path.
 *
 * A seeded, deterministic generator that turns a species recipe into a flat list of BOXES:
 *   { c:[x,y,z], s:[w,h,d], rot:[rx,ry,rz], mat:'<palette key>', ao:0..1,
 *     part:'trunk'|'root'|'branch'|'fleck'|'leaf'|'ivy' }
 *   - units: 1 unit = ASSETS.cubeCloudTrees.unitM metres (0.5 m). Y is UP, ground at y = 0, trunk foot at x = z = 0.
 *   - c = box centre, s = full edge lengths. Leaf cubes 0.25 .. 0.8 units, trunk/branch cubes 0.3 .. 1.2 units.
 *   - rot = degrees. Vertex = c + Ry(ry) * Rx(rx) * Rz(rz) * (corner * s)   (corner in [-0.5, 0.5]^3, right-handed,
 *     Ry(a) maps +x to (cos a, 0, -sin a), Rz(a) maps +x to (cos a, sin a, 0)). Pass 2 only uses ry (cubes are
 *     upright; a clump / trunk layer shares one yaw so its cube grid stays readable).
 *   - mat = a key of ASSETS.palette.colors (pass 2 keys: leafLime2..leafShade, pine*, bark*, barkWhite*, barkFleck,
 *     autumn*, petalPinkBright/Mid/Deep; appended to palette.js).
 *   - ao = baked occlusion hint (1 = outer shell, ~0.7 = deep inside the crown); multiply the lit colour by it.
 *   - part 'ivy' = green clumps stuck on the oak trunk (foliage material, not leaf-budgeted separately).
 *
 * API (classic script, also require()-able from Node):
 *   ASSETS.cubeCloudTrees.generate(species, seed) -> { species, seed, boxes:[...], stats:{ boxes, leaves, ivy, wood,
 *       clumps, trisMax, trisPractical, heightUnits, radiusUnits, trimmed, capped } }
 *   ASSETS.cubeCloudTrees.speciesList            -> ['oak','pine','birch','cherry']
 *   ASSETS.cubeCloudTrees.maxBoxes               -> 700 (hard cap; leaf clumps are thinned to fit, lowest/innermost first)
 * trisMax = 12 per box (all 6 faces); trisPractical = 6 per box (at most 3 faces of a box can face any camera).
 * stats.clumps = leaf + ivy clumps placed; stats.trimmed = clump specs dropped by the budget; stats.capped = true if
 * the hard cap refused any box (should not happen with the shipped recipes).
 */
(function (root) {
  'use strict';
  var ASSETS = root.ASSETS = root.ASSETS || {};
  var D2R = Math.PI / 180, CAP = 700;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  // rotate a local offset about +Y by a degrees (same convention as the box rot: +x -> (cos a, 0, -sin a))
  function rotY(v, a) { var c = Math.cos(a * D2R), s = Math.sin(a * D2R); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; }

  function makeCtx(species, seed) {
    var rng = mulberry32(hashStr(species) ^ Math.imul(seed | 0, 2654435761));
    var G = { rng: rng, boxes: [], cap: CAP, clumps: 0, trimmed: 0, capped: false };
    G.rnd = function (a, b) { return a + (b - a) * rng(); };
    G.jit = function (x) { return (rng() * 2 - 1) * x; };
    G.pick = function (arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; };
    G.wpick = function (list) { // [[key, weight], ...]
      var tot = 0, i; for (i = 0; i < list.length; i++) tot += list[i][1];
      var r = rng() * tot; for (i = 0; i < list.length; i++) { r -= list[i][1]; if (r <= 0) return list[i][0]; }
      return list[list.length - 1][0];
    };
    G.add = function (b) { if (G.boxes.length >= G.cap) { G.capped = true; return null; } G.boxes.push(b); return b; };
    return G;
  }

  // ---- TRUNK: layers of small cubes on an n x n grid (only the ring is emitted; a recessed dark core box per layer
  // fills the holes left by the randomly dropped corner cubes). Width tapers base -> top, flares at the foot.
  // Returns the layer list (anchors for branches / ivy / flecks).
  function voxTrunk(G, p) {
    var segs = [], y = 0, cs = p.cs, yaw0 = G.rnd(0, 90), ox = 0, oz = 0;
    while (y < p.height - 1e-6) {
      var h = Math.min(cs, p.height - y), t = (y + h / 2) / p.height;
      var w = lerp(p.baseW, p.topW, Math.pow(t, 0.85)) * (1 + (p.flare || 0) * Math.pow(Math.max(0, 1 - t / 0.2), 2));
      var n = Math.max(1, Math.round(w / cs)), cl = w / n;
      if (p.crook) { ox += G.jit(p.crook); oz += G.jit(p.crook); }
      var cx = p.lean[0] * t * t + ox, cz = p.lean[1] * t * t + oz, yaw = yaw0 + (p.twist || 0) * t;
      if (n >= 3) G.add({ c: [cx, y + h / 2, cz], s: [(n - 0.7) * cl, h, (n - 0.7) * cl], rot: [0, yaw, 0], mat: p.coreMat, ao: 0.7, part: 'trunk' });
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
        var edge = i === 0 || j === 0 || i === n - 1 || j === n - 1, corner = (i === 0 || i === n - 1) && (j === 0 || j === n - 1);
        if (n >= 3 && !edge) continue;
        if (n >= 3 && corner && G.rng() < 0.5) continue;
        var o = rotY([(i - (n - 1) / 2) * cl + G.jit(0.04), 0, (j - (n - 1) / 2) * cl + G.jit(0.04)], yaw);
        var mat = p.fleckP && G.rng() < p.fleckP ? p.fleckMat : G.wpick(p.mats);
        G.add({ c: [cx + o[0], y + h / 2, cz + o[2]], s: [cl * G.rnd(0.93, 1.04), h * G.rnd(0.95, 1.04), cl * G.rnd(0.93, 1.04)],
          rot: [0, yaw, 0], mat: mat, ao: 0.78 + 0.22 * t, part: 'trunk' });
      }
      segs.push({ y: y + h / 2, x: cx, z: cz, w: w, yaw: yaw });
      y += h;
    }
    // flared roots: short stair-steps of cubes running out from the foot
    var nr = p.roots || 0, ra0 = G.rnd(0, 360), bw = p.baseW * (1 + (p.flare || 0)) / 2, len = p.rootLen || 2;
    for (var k = 0; k < nr; k++) {
      var a = ra0 + k * 360 / nr + G.jit(18);
      for (var m = 0; m < len; m++) {
        var sz = cs * (1.2 - 0.25 * m) * G.rnd(0.9, 1.1), hh = m === 0 ? sz * 1.5 : sz * (0.9 - 0.1 * m), d = bw - cs * 0.25 + m * cs * 0.85;
        G.add({ c: [segs[0].x + Math.cos(a * D2R) * d, hh / 2, segs[0].z - Math.sin(a * D2R) * d], s: [sz, hh, sz],
          rot: [0, a, 0], mat: G.wpick(p.mats), ao: 0.75, part: 'root' });
      }
    }
    return segs;
  }
  function segAt(segs, y) { var best = segs[0]; segs.forEach(function (s) { if (Math.abs(s.y - y) < Math.abs(best.y - y)) best = s; }); return best; }

  // ---- BRANCH: chain of cubes along a quadratic Bezier start -> end. o.up / o.out place the control point:
  // up 0.75 + out 0.3 = rises first, then bends outward (oak); up 0.45 + out 0.55 = spreads flat first (cherry).
  function bez(a, b, c, t) { var u = 1 - t; return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1], u * u * a[2] + 2 * u * t * b[2] + t * t * c[2]]; }
  function dist(a, b) { var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return Math.sqrt(x * x + y * y + z * z); }
  function limb(G, start, end, w0, w1, o) {
    var ctrl = [lerp(start[0], end[0], o.out), lerp(start[1], end[1], o.up), lerp(start[2], end[2], o.out)];
    var len = dist(start, ctrl) + dist(ctrl, end), n = Math.max(2, Math.ceil(len / ((w0 + w1) / 2 * 0.95)));
    var yaw = Math.atan2(-(end[2] - start[2]), end[0] - start[0]) / D2R;
    for (var i = 0; i < n; i++) {
      var t = (i + 0.5) / n, p = bez(start, ctrl, end, t), w = lerp(w0, w1, t) * G.rnd(0.92, 1.06);
      if (o.crook) { p[0] += G.jit(o.crook); p[2] += G.jit(o.crook); }
      G.add({ c: p, s: [w, w, w], rot: [0, yaw + G.jit(10), 0], mat: G.wpick(o.mats), ao: 0.82 + 0.12 * t, part: 'branch' });
    }
    return { at: function (t) { return bez(start, ctrl, end, t); } };
  }

  // ---- LEAF CLUMP: centre cube + 2..6 smaller axis neighbours (a 3D plus with arms missing), one shared yaw.
  // tone 0..1 picks the material from the ladder L.mats (dark -> bright); top arm brighter, bottom arm darker.
  var NB = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
  function clump(G, c, s, tone, L) {
    var yaw = G.rnd(0, 90), ox = c[0] - L.ax, oz = c[2] - L.az, ol = Math.sqrt(ox * ox + oz * oz) || 1;
    ox /= ol; oz /= ol;
    var picks = NB.map(function (d, i) { return G.rng() < (i < 4 ? L.pH : i === 4 ? L.pUp : L.pDown); });
    var cnt = picks.filter(Boolean).length, guard = 0;
    while (cnt < 2 && guard++ < 20) { var k = Math.floor(G.rng() * 4); if (!picks[k]) { picks[k] = true; cnt++; } }
    var cubes = [[0, 0, 0, s, 0]];
    NB.forEach(function (d, i) {
      if (!picks[i]) return;
      var ns = s * G.rnd(0.68, 0.92), off = (s + ns) * 0.5 * 0.9, wd = rotY([d[0] * off, d[1] * off, d[2] * off], yaw);
      var dt = d[1] > 0 ? 0.14 : d[1] < 0 ? -0.2 : (wd[0] * ox + wd[2] * oz) / off * 0.08;
      cubes.push([wd[0], wd[1], wd[2], ns, dt]);
    });
    cubes.forEach(function (q) {
      var tn = clamp(tone + q[4] + G.jit(0.06), 0, 0.999), mat = L.mats[Math.floor(tn * L.mats.length)];
      if (L.sprinkle && G.rng() < L.sprinkle.p) mat = L.sprinkle.mat;
      G.add({ c: [c[0] + q[0], c[1] + q[1], c[2] + q[2]], s: [q[3], q[3], q[3]], rot: [0, yaw, 0], mat: mat,
        ao: 0.8 + 0.2 * tn, part: L.part || 'leaf' });
    });
    G.clumps++;
  }

  // ---- TIER PAD: clump specs scattered over a drooping disc (centre domes up, rim sags by o.droop units).
  function padSpecs(G, specs, pc, rp, o) {
    var n = Math.max(1, Math.round(o.fill * rp * rp * G.rnd(0.85, 1.15))), made = 0, tries = 0;
    while (made < n && tries++ < n * 30) {
      var q = made === 0 ? G.rnd(0, 0.25) : Math.sqrt(G.rng()), th = G.rnd(0, 2 * Math.PI);
      var s = lerp(o.sBig, o.sSmall, q) * G.rnd(0.85, 1.15), r = s * 1.35;
      var c = [pc[0] + Math.cos(th) * q * rp, pc[1] + o.dome * (1 - q * q) * G.rng() - o.droop * q * q + G.jit(0.12), pc[2] + Math.sin(th) * q * rp];
      var ok = true;
      for (var i = 0; i < specs.length; i++) {
        var p = specs[i], dx = p.c[0] - c[0], dy = (p.c[1] - c[1]) * 1.15, dz = p.c[2] - c[2], lim = 0.8 * (r + p.r);
        if (dx * dx + dy * dy + dz * dz < lim * lim) { ok = false; break; }
      }
      if (!ok) continue;
      specs.push({ c: c, s: s, r: r, q: q }); made++;
    }
  }
  // n pad centres on a ring of radius d around the trunk axis
  function ring(G, ax, az, y, d, n, a0) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var a = (a0 + i * 360 / n + G.jit(14)) * D2R, dd = d * G.rnd(0.88, 1.1);
      out.push([ax + Math.cos(a) * dd, y + G.jit(0.25), az - Math.sin(a) * dd]);
    }
    return out;
  }

  // ---- LEAVES: tone every spec (height in crown + distance from axis = sun exposure), fit the box budget (drop the
  // lowest-priority = low/inner clumps first), emit clumps + stray cubes hanging under rim clumps.
  function leaves(G, specs, L, o) {
    if (!specs.length) return;
    var ymin = 1e9, ymax = -1e9, rmax = 1e-6;
    specs.forEach(function (sp) {
      var dx = sp.c[0] - L.ax, dz = sp.c[2] - L.az; sp.rad = Math.sqrt(dx * dx + dz * dz);
      ymin = Math.min(ymin, sp.c[1]); ymax = Math.max(ymax, sp.c[1]); rmax = Math.max(rmax, sp.rad);
    });
    specs.forEach(function (sp) {
      var hN = (sp.c[1] - ymin) / Math.max(1e-6, ymax - ymin), rN = sp.rad / rmax;
      sp.tone = o.toneBase + o.kH * hN + o.kR * rN + 0.1 * (1 - sp.q) * hN + G.jit(0.08);
      sp.pri = 0.6 * hN + 0.6 * rN + G.rng() * 0.5;
    });
    var exp = 1 + 4 * L.pH + L.pUp + L.pDown + 0.2 + (o.strayP || 0) * 0.9;
    var K = Math.max(0, Math.floor((G.cap - G.boxes.length) / exp));
    if (specs.length > K) {
      G.trimmed += specs.length - K;
      specs = specs.slice().sort(function (a, b) { return b.pri - a.pri; }).slice(0, K);
    }
    specs.forEach(function (sp) {
      clump(G, sp.c, sp.s, sp.tone, L);
      if (sp.q > 0.6 && G.rng() < (o.strayP || 0)) {
        var n = G.rng() < 0.3 ? 2 : 1, y = sp.c[1] - sp.s * 0.5, x = sp.c[0] + G.jit(sp.s * 0.4), z = sp.c[2] + G.jit(sp.s * 0.4);
        var mat = L.mats[Math.floor(clamp(sp.tone - 0.15, 0, 0.999) * L.mats.length)];
        for (var k = 0; k < n; k++) {
          var ss = G.rnd(0.26, 0.4);
          y -= ss / 2 + (k ? 0.04 : G.rnd(0.3, 0.8));
          G.add({ c: [x, y, z], s: [ss, ss, ss], rot: [0, G.rnd(0, 90), 0], mat: mat, ao: 0.85, part: 'leaf' });
          y -= ss / 2; x += G.jit(0.08); z += G.jit(0.08);
        }
      }
    });
  }

  var BARK = [['barkDeep', 2], ['bark', 4], ['barkMid', 3], ['barkLight', 1]];
  var LIMB = [['bark', 3], ['barkMid', 3], ['barkDeep', 1], ['barkLight', 1]];

  // ---------------------------------------------------------------------------
  // SPECIES RECIPES (tuning lives here). Tier tables: [y, ringRadius, pads, padRadius]
  // ---------------------------------------------------------------------------
  var species = {
    // Big stylised oak: thick flared trunk, 4 heavy limbs -> 5 drooping tiers, lime tops, ivy on the trunk.
    oak: function (G) {
      var segs = voxTrunk(G, { height: 6.0, cs: 0.6, baseW: 2.6, topW: 1.6, flare: 0.35, lean: [G.jit(0.4), G.jit(0.4)], twist: 20,
        mats: BARK, coreMat: 'barkDeep', roots: 5 + (G.rng() < 0.5 ? 1 : 0), rootLen: 3 });
      var top = segs[segs.length - 1], ax = top.x, az = top.z, y0 = G.rnd(0, 360), pads = [], limbs = [];
      // T1: 4 heavy limbs -> lowest, widest tier
      ring(G, ax, az, 7.4, 6.4, 4, y0).forEach(function (pc) {
        var s = segAt(segs, G.rnd(4.4, 5.6));
        limbs.push(limb(G, [s.x, s.y, s.z], [pc[0], pc[1] - 0.7, pc[2]], 1.15, 0.55, { out: 0.3, up: 0.75, mats: LIMB }));
        pads.push({ c: pc, rp: G.rnd(2.5, 2.9) });
      });
      // T2: side branches off the limbs, 45 deg around
      ring(G, ax, az, 8.9, 4.5, 4, y0 + 45).forEach(function (pc, i) {
        limb(G, limbs[i].at(0.4), [pc[0], pc[1] - 0.6, pc[2]], 0.7, 0.42, { out: 0.35, up: 0.7, mats: LIMB });
        pads.push({ c: pc, rp: G.rnd(2.4, 2.8) });
      });
      // central leader -> T3, T4, T5
      var lead = limb(G, [ax, top.y + 0.3, az], [ax + G.jit(0.6), 12.6, az + G.jit(0.6)], 1.1, 0.5, { out: 0.5, up: 0.5, mats: LIMB });
      ring(G, ax, az, 10.4, 3.1, 3, y0 + 20).forEach(function (pc) {
        limb(G, lead.at(0.45), [pc[0], pc[1] - 0.6, pc[2]], 0.55, 0.38, { out: 0.4, up: 0.6, mats: LIMB });
        pads.push({ c: pc, rp: G.rnd(2.1, 2.5) });
      });
      ring(G, ax, az, 11.8, 1.5, 3, y0 + 80).forEach(function (pc) {
        limb(G, lead.at(0.7), [pc[0], pc[1] - 0.5, pc[2]], 0.45, 0.34, { out: 0.4, up: 0.6, mats: LIMB });
        pads.push({ c: pc, rp: G.rnd(1.7, 2.1) });
      });
      var tip = lead.at(1);
      pads.push({ c: [tip[0], 13.3, tip[2]], rp: 1.5 });
      // ivy clumps stuck on the trunk faces
      var IVY = { mats: ['ivyDark', 'leafDeepGreen', 'ivy', 'ivyLight'], pH: 0.7, pUp: 0.5, pDown: 0.6, part: 'ivy' };
      for (var v = 0, nv = 4 + Math.floor(G.rng() * 3); v < nv; v++) {
        var sg = segAt(segs, G.rnd(1.0, 4.8)), fy = sg.yaw + Math.floor(G.rnd(0, 4)) * 90, s = G.rnd(0.36, 0.48);
        var off = rotY([sg.w / 2 + s * 0.25, 0, G.jit(sg.w * 0.3)], fy);
        IVY.ax = sg.x; IVY.az = sg.z;
        clump(G, [sg.x + off[0], sg.y + G.jit(0.2), sg.z + off[2]], s, G.rnd(0.2, 0.8), IVY);
      }
      var po = { fill: 1.0, sBig: 0.66, sSmall: 0.48, dome: 0.6, droop: 1.0 }, specs = [];
      pads.forEach(function (pd) { padSpecs(G, specs, pd.c, pd.rp, po); });
      leaves(G, specs, { mats: ['leafShade', 'leafDeepGreen', 'leafMid', 'leafLime', 'leafLime2'], pH: 0.72, pUp: 0.5, pDown: 0.4, ax: ax, az: az },
        { toneBase: 0.18, kH: 0.42, kR: 0.22, strayP: 0.35 });
    },
    // Pine: slim trunk, 7 stacked drooping rings of dark/mid clumps, pointed top. <= ~7.5 m.
    pine: function (G) {
      var segs = voxTrunk(G, { height: 13.0, cs: 0.45, baseW: 1.05, topW: 0.4, flare: 0.3, lean: [G.jit(0.25), G.jit(0.25)], twist: 10,
        mats: [['barkDeep', 3], ['bark', 4], ['barkMid', 2]], coreMat: 'barkDeep', roots: 4, rootLen: 2 });
      var specs = [], T = 7, top = segs[segs.length - 1];
      for (var i = 0; i < T; i++) {
        var y = 2.8 + i * 1.6, R = 4.3 - i * 0.5, sg = segAt(segs, y), ax = sg.x, az = sg.z;
        specs.push({ c: [ax, y + 0.25, az], s: 0.55, r: 0.74, q: 0 }); // hugs the trunk
        var m = Math.max(1, Math.round(R / 1.45));
        for (var k = 0; k < m; k++) {
          var r = R * (k + 1) / m, cnt = Math.max(3, Math.round(2 * Math.PI * r / 2.0)), a0 = G.rnd(0, 360);
          for (var j = 0; j < cnt; j++) {
            var a = (a0 + j * 360 / cnt + G.jit(10)) * D2R, rr = r * G.rnd(0.9, 1.05), q = Math.min(1, rr / R);
            var s = lerp(0.62, 0.44, q) * G.rnd(0.9, 1.1);
            specs.push({ c: [ax + Math.cos(a) * rr, y - 1.3 * q * q + G.jit(0.12), az - Math.sin(a) * rr], s: s, r: s * 1.35, q: q });
          }
        }
      }
      // pointed top: shrinking stack of cubes
      [[13.2, 0.5], [13.75, 0.42], [14.2, 0.34], [14.55, 0.26]].forEach(function (t, n) {
        G.add({ c: [top.x, t[0], top.z], s: [t[1], t[1], t[1]], rot: [0, G.rnd(0, 90), 0], mat: n < 2 ? 'pineMid' : 'pineLight', ao: 1, part: 'leaf' });
      });
      leaves(G, specs, { mats: ['pineDeep', 'pineMid', 'pineLight', 'leafMid'], pH: 0.8, pUp: 0.3, pDown: 0.3, ax: top.x, az: top.z },
        { toneBase: 0.05, kH: 0.45, kR: 0.3, strayP: 0.25 });
    },
    // Birch: slim white trunk with dark fleck cubes + lenticel plates, bright yellow-orange clumps all over.
    birch: function (G) {
      var segs = voxTrunk(G, { height: 12.0, cs: 0.5, baseW: 1.1, topW: 0.5, flare: 0.15, lean: [G.jit(0.6), G.jit(0.6)], twist: 8,
        mats: [['barkWhite', 6], ['barkWhiteShade', 3]], fleckP: 0.16, fleckMat: 'barkFleck', coreMat: 'barkFleck', roots: 0 });
      segs.forEach(function (s) { // thin dark horizontal plates on the faces
        if (G.rng() > 0.45) return;
        var fy = s.yaw + Math.floor(G.rnd(0, 4)) * 90, o = rotY([s.w / 2 + 0.02, 0, G.jit(s.w * 0.25)], fy);
        G.add({ c: [s.x + o[0], s.y + G.jit(0.12), s.z + o[2]], s: [0.06, G.rnd(0.08, 0.14), s.w * G.rnd(0.3, 0.6)], rot: [0, fy, 0], mat: 'barkFleck', ao: 1, part: 'fleck' });
      });
      var top = segs[segs.length - 1], ax = top.x, az = top.z, y0 = G.rnd(0, 360), pads = [];
      var TW = [['barkWhiteShade', 3], ['barkWhite', 2], ['barkFleck', 1]];
      [[6.0, 2.4, 3, 1.8], [7.6, 2.7, 3, 1.9], [9.2, 1.8, 3, 1.8], [10.7, 1.2, 3, 1.6], [12.2, 0.6, 2, 1.35], [13.4, 0, 1, 1.1]].forEach(function (T, ti) {
        ring(G, ax, az, T[0], T[1], T[2], y0 + ti * 47).forEach(function (pc) {
          if (ti < 2) { var s = segAt(segs, Math.min(11.5, pc[1] - 1.6)); limb(G, [s.x, s.y, s.z], [pc[0], pc[1] - 0.5, pc[2]], 0.42, 0.3, { out: 0.3, up: 0.6, mats: TW }); }
          pads.push({ c: pc, rp: T[3] * G.rnd(0.92, 1.08) });
        });
      });
      var po = { fill: 2.0, sBig: 0.58, sSmall: 0.44, dome: 0.6, droop: 0.5 }, specs = [];
      pads.forEach(function (pd) { padSpecs(G, specs, pd.c, pd.rp, po); });
      leaves(G, specs, { mats: ['autumnOrange', 'autumnGold', 'autumnYellow', 'autumnYellowBright'], pH: 0.72, pUp: 0.5, pDown: 0.45, ax: ax, az: az },
        { toneBase: 0.12, kH: 0.45, kR: 0.25, strayP: 0.3 });
    },
    // Cherry: short crooked brown trunk, wide flat-spreading limbs, umbrella of bright pink clumps, a few white.
    cherry: function (G) {
      var segs = voxTrunk(G, { height: 4.4, cs: 0.55, baseW: 1.9, topW: 1.2, flare: 0.3, lean: [G.jit(0.9), G.jit(0.9)], crook: 0.14, twist: 25,
        mats: [['barkDeep', 3], ['bark', 4], ['barkMid', 2]], coreMat: 'barkDeep', roots: 4, rootLen: 2 });
      var top = segs[segs.length - 1], ax = top.x, az = top.z, y0 = G.rnd(0, 360), pads = [], limbs = [];
      var CM = [['barkDeep', 3], ['bark', 3], ['barkMid', 1]];
      ring(G, ax, az, 6.6, 5.2, 4, y0).forEach(function (pc) {
        var s = segAt(segs, G.rnd(3.4, 4.2));
        limbs.push(limb(G, [s.x, s.y, s.z], [pc[0], pc[1] - 0.6, pc[2]], 1.0, 0.5, { out: 0.55, up: 0.45, mats: CM, crook: 0.12 }));
        pads.push({ c: pc, rp: G.rnd(2.5, 2.8) });
      });
      ring(G, ax, az, 7.9, 3.4, 4, y0 + 45).forEach(function (pc, i) {
        limb(G, limbs[i].at(0.45), [pc[0], pc[1] - 0.5, pc[2]], 0.6, 0.38, { out: 0.45, up: 0.55, mats: CM, crook: 0.1 });
        pads.push({ c: pc, rp: G.rnd(2.2, 2.5) });
      });
      ring(G, ax, az, 9.0, 1.5, 3, y0 + 20).forEach(function (pc) {
        limb(G, [ax, top.y, az], [pc[0], pc[1] - 0.5, pc[2]], 0.7, 0.4, { out: 0.5, up: 0.5, mats: CM, crook: 0.1 });
        pads.push({ c: pc, rp: G.rnd(1.9, 2.3) });
      });
      pads.push({ c: [ax + G.jit(0.4), 10.0, az + G.jit(0.4)], rp: 1.5 });
      var po = { fill: 1.25, sBig: 0.62, sSmall: 0.46, dome: 0.7, droop: 0.9 }, specs = [];
      pads.forEach(function (pd) { padSpecs(G, specs, pd.c, pd.rp, po); });
      leaves(G, specs, { mats: ['petalPinkDeep', 'petalPinkMid', 'petalPinkBright', 'petalPinkLight'], pH: 0.72, pUp: 0.5, pDown: 0.4, ax: ax, az: az,
        sprinkle: { mat: 'petalWhite', p: 0.06 } }, { toneBase: 0.15, kH: 0.4, kR: 0.25, strayP: 0.3 });
    }
  };

  function generate(name, seed) {
    if (!species[name]) throw new Error('cubeCloudTrees: unknown species ' + name);
    var G = makeCtx(name, seed == null ? 1 : seed);
    species[name](G);
    var top = 0, rad = 0, leaves = 0, ivy = 0;
    G.boxes.forEach(function (b) {
      var hs = Math.max(b.s[0], b.s[2]) * 0.71;
      top = Math.max(top, b.c[1] + b.s[1] / 2); rad = Math.max(rad, Math.sqrt(b.c[0] * b.c[0] + b.c[2] * b.c[2]) + hs);
      if (b.part === 'leaf') leaves++; else if (b.part === 'ivy') ivy++;
    });
    var n = G.boxes.length;
    return { species: name, seed: seed, boxes: G.boxes, stats: { boxes: n, leaves: leaves, ivy: ivy, wood: n - leaves - ivy, clumps: G.clumps,
      trisMax: n * 12, trisPractical: n * 6, heightUnits: +top.toFixed(2), radiusUnits: +rad.toFixed(2), trimmed: G.trimmed, capped: G.capped } };
  }

  var api = { version: 2, unitM: 0.5, maxBoxes: CAP, speciesList: Object.keys(species), generate: generate, _mulberry32: mulberry32 };
  ASSETS.cubeCloudTrees = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
