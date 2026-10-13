// Kestrel - preview-only helpers for ground-richness.html and biome-atmos.html (ENV-02/03-DESIGN).
// NOT engine code: a readable reference of how the biomeLook.js data is meant to be applied.
(function (root) {
  var L = {};
  function cl(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  L.cl = cl;
  L.rgb = function (hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  L.css = function (c) { return 'rgb(' + Math.round(cl(c[0]) * 255) + ',' + Math.round(cl(c[1]) * 255) + ',' + Math.round(cl(c[2]) * 255) + ')'; };
  L.mix = function (a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
  L.mul = function (a, k) { return [a[0] * k[0], a[1] * k[1], a[2] * k[2]]; };
  L.ramp = function (stops, t) {
    t = cl(t) * (stops.length - 1);
    var i = Math.min(stops.length - 2, Math.floor(t));
    return L.mix(stops[i], stops[i + 1], t - i);
  };
  L.hash = function (x, y, s) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1013904223)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  L.vnoise = function (x, y, s) {
    var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    var u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    var a = L.hash(xi, yi, s), b = L.hash(xi + 1, yi, s), c = L.hash(xi, yi + 1, s), d = L.hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  function ss(a, b, x) { var t = cl((x - a) / (b - a)); return t * t * (3 - 2 * t); }
  L.ss = ss;

  var cache = new Map();
  function prep(gv) {
    var p = cache.get(gv); if (p) return p;
    p = { ramp: gv.ramp.map(L.rgb), bg: gv.bg.map(L.rgb), acc: (gv.accents || []).map(function (a) { return L.rgb(a.c); }) };
    if (gv.water) p.water = { color: L.rgb(gv.water.color), light: L.rgb(gv.water.light), bg: L.rgb(gv.water.bg), wet: L.rgb(gv.water.wet) };
    cache.set(gv, p); return p;
  }

  // One ground cell. xw,zw = world metres; fpD = depth footprint of the cell (m); cx,cy = stable cell id
  // (in game: the world cell, so a camera move never re-rolls a glyph); wind01 0..1; t seconds.
  // Returns { g, f:[r,g,b], b:[r,g,b] }.
  L.groundCell = function (gv, xw, zw, fpD, cx, cy, wind01, t) {
    var P = prep(gv), n = gv.glyphs.length;
    var h1 = L.hash(cx, cy, 1), h2 = L.hash(cx, cy, 2), h3 = L.hash(cx, cy, 3);
    var fineFade = 1 - ss(gv.noiseScale * 0.15, gv.noiseScale * 0.5, fpD);
    var macroFade = 1 - ss(gv.macroScale * 0.15, gv.macroScale * 0.5, fpD);
    var s = gv.noiseScale;
    var n1 = L.vnoise(xw / s, zw / s, 11) * 0.65 + L.vnoise(xw / s * 2.3 + 7.1, zw / s * 2.3 + 3.3, 12) * 0.35;
    var m = L.vnoise(xw / gv.macroScale, zw / gv.macroScale, 13);
    var tone = cl(0.5 + (n1 - 0.5) * 1.2 * gv.contrast * fineFade + (m - 0.5) * 1.0 * gv.contrast * macroFade);
    var gi = Math.floor(cl(tone * 0.55 + h1 * 0.6 - 0.08) * n * 0.9999);
    var g = gv.glyphs.charAt(gi);
    var f = L.ramp(P.ramp, tone), k = 0.94 + h2 * 0.12;
    f = [f[0] * k, f[1] * k, f[2] * k];
    var b = L.ramp(P.bg, tone);

    // water (shore): static when calm
    if (gv.water) {
      var W = gv.water, edgeZ = W.from + (L.vnoise(xw / 6, 0.5, 21) - 0.5) * 4;
      if (zw > edgeZ) {
        var drift = t * 0.8 * wind01;
        var w = L.vnoise((xw + drift) / 1.6, zw / 0.9, 22) * 0.7 + L.vnoise(xw / 5, zw / 3, 23) * 0.3;
        var wg = w > 0.62 ? W.glyphs.charAt(0) : w > 0.5 ? W.glyphs.charAt(1) : W.glyphs.charAt(2);
        return { g: wg, f: L.mix(P.water.color, P.water.light, cl((w - 0.4) * 2)), b: L.mix(P.water.bg, P.water.color, cl((w - 0.3) * 0.6)) };
      }
      if (zw > edgeZ - W.edge) {
        var kw = ss(edgeZ - W.edge, edgeZ, zw) * 0.7;
        f = L.mix(f, P.water.wet, kw); b = L.mix(b, P.water.wet, kw * 0.8);
      }
    }
    // accents (decor-sized speckles)
    var acc = gv.accents || [];
    for (var i = 0; i < acc.length; i++) {
      var a = acc[i];
      if (zw > a.maxDist) continue;
      var cn = L.vnoise(xw / (s * 1.3) + i * 17, zw / (s * 1.3), 30 + i);
      var p = a.d * (1 - a.cluster + a.cluster * 2 * ss(0.35, 0.75, cn)) * (1 - ss(a.maxDist * 0.6, a.maxDist, zw));
      if (L.hash(cx, cy, 40 + i) < p) { g = a.g; f = P.acc[i].slice(); break; }
    }
    // wind shimmer: a coherent gust wave in world space; wind01 = 0 -> no change at all
    var sh = gv.shimmer;
    if (sh && sh.amp > 0 && wind01 > 0) {
      var gs = 7, xg = (xw * 0.8 + zw * 0.6) / gs - t * 0.35 * (0.5 + wind01);
      var gust = ss(0.45, 0.85, L.vnoise(xg, (zw * 0.8 - xw * 0.6) / gs * 0.5, 50));
      var kk = sh.amp * wind01 * gust;
      f = L.mix(f, P.ramp[3], cl(kk * sh.sheen * 1.6));
      if (sh.mode === 'lean' && kk > 0.15 + h3 * 0.6 && gv.glyphs.indexOf(g) === gi) g = sh.lean.charAt(gi);
    }
    return { g: g, f: f, b: b };
  };

  L.grade = function (c, gr) {
    var r = gr.gain[0] * (c[0] + gr.lift[0] * (1 - c[0])), g = gr.gain[1] * (c[1] + gr.lift[1] * (1 - c[1])), b = gr.gain[2] * (c[2] + gr.lift[2] * (1 - c[2]));
    r = Math.pow(Math.max(r, 0), 1 / gr.gamma[0]); g = Math.pow(Math.max(g, 0), 1 / gr.gamma[1]); b = Math.pow(Math.max(b, 0), 1 / gr.gamma[2]);
    var l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return [l + (r - l) * gr.sat, l + (g - l) * gr.sat, l + (b - l) * gr.sat];
  };

  // Incremental cell canvas: only changed cells are repainted (and counted).
  L.Panel = function (canvas, W, H, cw, ch) {
    this.cv = canvas; this.W = W; this.H = H; this.cw = cw; this.ch = ch;
    canvas.width = W * cw; canvas.height = H * ch;
    this.ctx = canvas.getContext('2d');
    this.ctx.textBaseline = 'top';
    this.ctx.font = Math.round(ch * 0.95) + 'px Consolas, "Courier New", monospace';
    this.pg = new Array(W * H); this.pf = new Array(W * H); this.pb = new Array(W * H);
    this.changed = 0;
  };
  L.Panel.prototype.put = function (x, y, g, fc, bc) {
    var i = y * this.W + x;
    if (this.pg[i] === g && this.pf[i] === fc && this.pb[i] === bc) return;
    this.pg[i] = g; this.pf[i] = fc; this.pb[i] = bc; this.changed++;
    var c = this.ctx, px = x * this.cw, py = y * this.ch;
    c.fillStyle = bc; c.fillRect(px, py, this.cw, this.ch);
    if (g !== ' ') { c.fillStyle = fc; c.fillText(g, px, py); }
  };

  // Picks shared by both pages (localStorage), falling back to the data file's pick.
  L.picks = function () {
    var p = {}; try { p = JSON.parse(localStorage.getItem('kestrel.biomeLookPick') || '{}'); } catch (e) { p = {}; }
    var B = root.BIOME_LOOK.biomes;
    Object.keys(B).forEach(function (id) { p[id] = Object.assign({}, B[id].pick, p[id] || {}); });
    return p;
  };
  L.savePicks = function (p) { try { localStorage.setItem('kestrel.biomeLookPick', JSON.stringify(p)); } catch (e) {} };

  root.LOOKLIB = L;
})(window);
