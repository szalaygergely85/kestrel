// WG-3c (docs/architecture.md 38.8/38.8a items 20-22): shade (pass 1) + edge (pass 2) as fullscreen WebGPU passes after light
// (GpuCellPipeline._passShade/_passEdgeOrDebug + bind/_bindStaticUniforms/_bakeSkyLUT/_ensureTerrainTextures twin).
// Shade reads the resolved GI/GA/GD/Depth, the sub-sample set, the CPU cell layer (rt.fgTex/bgTex), the material/glyph/sky/look
// textures and the light output; writes texShadeFg/Bg. Edge reads those and writes texFinalFg/Bg (fg.a = glyph/255).
// Pipelines + bind descriptors are built once (22b); the material/sky/terrain-look textures upload only on change
// (matTable bind, palette/time of day, terrain far-bake version); per frame only uniform words change.
// The water layer is WG-3e: edge gets waterOn = 0 and a 1x1 dummy WATER texture. ALPHA-01d soft edges are WGSL-only (edge.wgsl.js header, D-044), not in the shipped GLSL
// (twin: edgePass.js).
import { SHADE_BLOCK, SHADE_WGSL, SHADE_TEXTURES } from '../wgsl/shade.wgsl.js';
import { EDGE_BLOCK, EDGE_WGSL, EDGE_TEXTURES } from '../wgsl/edge.wgsl.js';
import { packMaterialTable } from '../ShadeTextures.js';
import { packTerrainTextures } from '../TerrainTextures.js';
import { SKY_LUT_N } from '../glsl/common.js';
import { sunFromWorld } from '../../lighting.js';
import { orthoHashCell } from '../../projection.js'; // US-068b2
import { WG_PASS_SLOT, wgSpanBegin, wgSpanEnd } from '../device/WebGpuTimer.js'; // S8-B1-07: per-pass GPU timer slots

const S = (n) => SHADE_BLOCK.field(n).word;
const E = (n) => EDGE_BLOCK.field(n).word;
const S_FOG_FG = S('fogFg'), S_FOG_BG = S('fogBg'), S_FOG_START = S('fogStart'), S_FOG_FULL = S('fogFull');
const S_SUN_DIR = S('sunDir'), S_AMBIENT_I = S('ambientI'), S_SUN_I = S('sunI');
const S_TFOG_NEAR = S('terrainFogNearRGB'), S_TFOG_FAR = S('terrainFogFarRGB'), S_TFOG_START = S('terrainFogStart'), S_TFOG_FULL = S('terrainFogFull'), S_TFOG_CURVE = S('terrainFogCurve');
const S_BAND_NEAR = S('bandNear'), S_BAND_MID = S('bandMid'), S_SKY_ELEV = S('skyElevTop'), S_HORIZON = S('horizonRow'), S_PLANEDY = S('planeDistY');
const S_TIME = S('timeSec'), S_CELL_ASPECT = S('cellAspect'), S_CUTOFF = S('cutoff'), S_LIFT = S('lift'), S_FGMIN = S('fgMin');
const S_FGMAXGAIN = S('fgMaxGain'), S_TINTK = S('tintK'), S_OVERBRIGHT = S('overbright'), S_OVERBRIGHT_MAX = S('overbrightMax');
const S_AOR = S('aoR'), S_AOK = S('aoK'), S_STIP0 = S('fogStipple0'), S_STIP1 = S('fogStipple1'), S_SPARSE = S('fogSparse');
const S_HASHCELL = S('hashCell'), S_CLOSEBAND = S('closeBand'), S_HANDOVER = S('handover');
const S_N = S('n'), S_GPUSKY = S('gpuSky'), S_PROJ = S('projMode'), S_SUNMAP = S('sunMapOn'), S_NEARDETAIL = S('nearDetailOn');
const S_SPARSE_ALT = S('fogSparseAlt'), S_HAZE_ALT = S('fogHazeAlt');
const S_SPARSE_C0 = S('fogSparseCode0'), S_SPARSE_C1 = S('fogSparseCode1'), S_HAZE_C0 = S('fogHazeCode0'), S_HAZE_C1 = S('fogHazeCode1');
const S_PITCH_A = S('pitchA'), S_PITCH_B = S('pitchB'), S_PITCH_C = S('pitchC'), S_FACEK = S('faceK');
const E_COLS = E('gridCols'), E_ROWS = E('gridRows'), E_FOGMAX = E('fogMax'), E_RIM = E('modelRim'), E_WATER_ON = E('waterOn'), E_WOS = E('wos'), E_PROJ = E('projMode');
const E_FOG_START = E('fogStart'), E_FOG_FULL = E('fogFull'), E_TFOG_START = E('terrainFogStart'), E_TFOG_FULL = E('terrainFogFull'), E_TFOG_CURVE = E('terrainFogCurve');
const E_PITCH_C = E('pitchC'), E_GLYPH = E('edgeGlyph'), E_GAIN = E('edgeGain'), E_SOFTGAIN = E('softGain');

/** SHADE_TEXTURES slot order (shade.wgsl.js header). */
const SH = { GI: 0, GA: 1, GD: 2, DEPTH: 3, SGI: 4, SGA: 5, FG: 6, BG: 7, SKY: 8, MATF: 9, MATI: 10, SETI: 11, SETF: 12, GAIN: 13, LIGHT: 14, TLOOK: 15 };

export class WgShadePass {
  constructor(device) {
    this.device = device;
    this.pipeShade = device.createPipeline({
      vertex: { src: { wgsl: SHADE_WGSL } }, fragment: { src: { wgsl: SHADE_WGSL }, targets: 2 },
      bindings: { uniformBytes: SHADE_BLOCK.sizeBytes, textures: SHADE_TEXTURES.slice() },
      targetFormats: ['rgba8', 'rgba8'],
    });
    this.pipeEdge = device.createPipeline({
      vertex: { src: { wgsl: EDGE_WGSL } }, fragment: { src: { wgsl: EDGE_WGSL }, targets: 2 },
      bindings: { uniformBytes: EDGE_BLOCK.sizeBytes, textures: EDGE_TEXTURES.slice() },
      targetFormats: ['rgba8', 'rgba8'],
    });
    this.su = new Float32Array(SHADE_BLOCK.sizeWords); this.si = new Int32Array(this.su.buffer);
    this.eu = new Float32Array(EDGE_BLOCK.sizeWords); this.ei = new Int32Array(this.eu.buffer);
    this.shTex = SHADE_TEXTURES.map((_, slot) => ({ slot, texture: null }));
    this.edTex = EDGE_TEXTURES.map((_, slot) => ({ slot, texture: null }));
    this.shBind = { uniforms: this.su, textures: this.shTex };
    this.edBind = { uniforms: this.eu, textures: this.edTex };
    // data textures: 1x1 placeholders until bind(); re-created on a table of a different size
    this.texMatF = device.createTexture({ format: 'rgba32f', width: 1, height: 1 });
    this.texMatI = device.createTexture({ format: 'rgba32i', width: 1, height: 1 });
    this.texSetI = device.createTexture({ format: 'rgba32i', width: 1, height: 1 });
    this.texSetF = device.createTexture({ format: 'r32f', width: 1, height: 1 });
    this.texGain = device.createTexture({ format: 'r32f', width: 256, height: 1 });
    this.texSky = device.createTexture({ format: 'rgba32f', width: SKY_LUT_N, height: 1 });
    this.texTlook = device.createTexture({ format: 'rgba32f', width: 1, height: 1 });
    this.texWaterDummy = device.createTexture({ format: 'rgba32ui', width: 1, height: 1 });
    this.dims = { matF: [1, 1], matI: [1, 1], setI: [1, 1], setF: [1, 1], tlook: [1, 1] };
    this.skyData = new Float32Array(4 * SKY_LUT_N);
    this.skyElevTop = 0;
    this.table = null; this.palette = null; this.uniforms = null; this.packed = null;
    this.tableDirty = false; this.nRec = 0;
    this.skyPalette = null; this.skyTime = null;
    this.terrainWorld = null; this.terrainVersion = -1;
    this.terrainU = { bandNear: 0, bandMid: 0, fogOn: false, fogStart: 0, fogFull: 0, fogCurve: 1, nearRGB: null, farRGB: null, nearDetail: false, handover: null, closeBand: 0 };
    this.sunScratch = { dirX: 0, dirY: 0, dirZ: 0, ambientI: 0, sunI: 0 };
    this.stats = { tableUploads: 0, skyBakes: 0, terrainUploads: 0 };
  }

  /** bind(table, palette): remembered; the textures/uniforms are (re)built lazily on the next run (only when this changes). */
  bind(table, palette) {
    this.table = table; this.palette = palette || this.palette;
    this.tableDirty = true;
    this.skyPalette = null; // force a sky re-bake (GL bind() bakes the LUT too)
  }

  _recreate(tex, fmt, w, h) {
    const d = this.device;
    if (tex.width === w && tex.height === h) return tex;
    d.dispose(tex);
    return d.createTexture({ format: fmt, width: w, height: h });
  }

  // GL bind() + _bindStaticUniforms twin: pack once, upload the five data textures, write the static uniform words.
  _uploadTable() {
    const d = this.device, table = this.table;
    this.tableDirty = false;
    this.nRec = table && table.records ? table.records.length : 0;
    if (!table || !table.records || !table.sets) { this.packed = null; return; } // test stubs / no content bound yet
    const packed = packMaterialTable(table);
    const dm = packed.dims;
    this.texMatF = this._recreate(this.texMatF, 'rgba32f', dm.matFWidth, Math.max(1, dm.nMat));
    this.texMatI = this._recreate(this.texMatI, 'rgba32i', dm.matIWidth, Math.max(1, dm.nMat));
    this.texSetI = this._recreate(this.texSetI, 'rgba32i', dm.setIWidth, Math.max(1, dm.nSet));
    this.texSetF = this._recreate(this.texSetF, 'r32f', dm.setFWidth, Math.max(1, dm.nSet));
    d.writeTexture(this.texMatF, packed.matF);
    d.writeTexture(this.texMatI, packed.matI);
    d.writeTexture(this.texSetI, packed.setI);
    d.writeTexture(this.texSetF, packed.setF);
    d.writeTexture(this.texGain, packed.gain);
    this.packed = packed; this.uniforms = packed.uniforms;
    this.stats.tableUploads++;
    const U = packed.uniforms, su = this.su, si = this.si, eu = this.eu, ei = this.ei;
    su[S_CELL_ASPECT] = U.cellAspect;
    su[S_CUTOFF] = U.shading.cutoff; su[S_LIFT] = U.shading.lift; su[S_FGMIN] = U.shading.fgMin; su[S_FGMAXGAIN] = U.shading.fgMaxGain;
    su[S_TINTK] = U.shading.tint; su[S_OVERBRIGHT] = U.shading.overbright; su[S_OVERBRIGHT_MAX] = U.shading.overbrightMax;
    su[S_AOR] = U.ao.r; su[S_AOK] = U.ao.k;
    su.fill(0, S_FACEK, S_FACEK + 8);
    for (let i = 0; i < 7; i++) su[S_FACEK + i] = U.faceK[i];
    for (let k = 0; k < 3; k++) { su[S_FOG_FG + k] = U.fog.fgRGB[k]; su[S_FOG_BG + k] = U.fog.bgRGB[k]; }
    su[S_FOG_START] = U.fog.start; su[S_FOG_FULL] = U.fog.full;
    su[S_STIP0] = U.fog.stipple0; su[S_STIP1] = U.fog.stipple1; su[S_SPARSE] = U.fog.sparse;
    si[S_SPARSE_C0] = U.fog.sparseCodes[0]; si[S_SPARSE_C1] = U.fog.sparseCodes[1] || 0;
    si[S_HAZE_C0] = U.fog.hazeCodes[0]; si[S_HAZE_C1] = U.fog.hazeCodes[1] || 0;
    si[S_SPARSE_ALT] = U.fog.sparseAlt; si[S_HAZE_ALT] = U.fog.hazeAlt;
    // edge statics
    eu[E_FOGMAX] = U.edges ? U.edges.fogMax : 1;
    eu[E_RIM] = U.edges ? U.edges.modelRim : 1;
    eu[E_SOFTGAIN] = U.edges ? U.edges.softGain : 0.85; // ALPHA-01d
    eu[E_FOG_START] = U.fog.start; eu[E_FOG_FULL] = U.fog.full;
    for (let i = 0; i < 8; i++) { eu[E_GLYPH + i] = U.edges ? U.edges.ruleGlyph[i] : 0; eu[E_GAIN + i] = U.edges ? U.edges.ruleGain[i] : 1; }
  }

  // GL _bakeSkyLUT twin (flat gradient, SKY_LUT_N samples over elevation [0, elevTop]); re-baked when the palette / time of day changes.
  _bakeSky() {
    const P = this.palette;
    this.skyPalette = P; this.skyTime = P ? P.defaultTime : null;
    const rec = P && P.materials && P.materials.sky;
    if (!rec || !P.timeOfDay) return;
    const stops = P.timeOfDay[P.defaultTime].sky;
    const data = this.skyData;
    for (let i = 0; i < SKY_LUT_N; i++) {
      const t = i / (SKY_LUT_N - 1);
      let k = 0;
      for (; k < stops.length - 1; k++) if (t <= stops[k + 1].t) break;
      if (k >= stops.length - 1) k = stops.length - 2;
      const a = P.rgb[stops[k].c], b = P.rgb[stops[k + 1].c];
      const kk = (t - stops[k].t) / ((stops[k + 1].t - stops[k].t) || 1);
      data[i * 4] = a[0] + (b[0] - a[0]) * kk;
      data[i * 4 + 1] = a[1] + (b[1] - a[1]) * kk;
      data[i * 4 + 2] = a[2] + (b[2] - a[2]) * kk;
      data[i * 4 + 3] = 0;
    }
    this.device.writeTexture(this.texSky, data);
    this.skyElevTop = rec.elevTop;
    this.stats.skyBakes++;
  }

  // GL _ensureTerrainTextures + _uploadTerrainUniforms (shade/edge part) twin: TLOOK + band/fog/near-detail constants, only on a new far bake.
  _ensureTerrain(world) {
    const terrain = world && world.terrain;
    if (!terrain || !terrain.farReady || !this.palette) return;
    if (this.terrainVersion === terrain.farVersion && this.terrainWorld === world) return;
    const packed = packTerrainTextures(terrain, this.palette);
    this.texTlook = this._recreate(this.texTlook, 'rgba32f', packed.tlookWidth, Math.max(1, packed.tlookHeight));
    this.device.writeTexture(this.texTlook, packed.tlook);
    this.terrainVersion = terrain.farVersion; this.terrainWorld = world;
    this.stats.terrainUploads++;
    const recipe = terrain.recipe, P = this.palette, fogRec = P && P.fog && P.fog.far, tu = this.terrainU;
    tu.bandNear = recipe && recipe.bands ? recipe.bands.near : tu.bandNear;
    tu.bandMid = recipe && recipe.bands ? recipe.bands.mid : tu.bandMid;
    tu.fogOn = !!(fogRec && P.rgb);
    if (tu.fogOn) {
      tu.fogStart = fogRec.start; tu.fogFull = fogRec.full; tu.fogCurve = fogRec.curve || 1;
      tu.nearRGB = P.rgb[fogRec.color] || null; tu.farRGB = P.rgb[fogRec.colorFar] || null;
    }
    const nl = recipe && recipe.nearLOD;
    tu.nearDetail = !!(nl && nl.bands && nl.handover);
    if (tu.nearDetail) { tu.handover = nl.handover; tu.closeBand = nl.bands.close; }
    const su = this.su, si = this.si, eu = this.eu;
    su[S_BAND_NEAR] = tu.bandNear; su[S_BAND_MID] = tu.bandMid;
    if (tu.fogOn) {
      su[S_TFOG_START] = tu.fogStart; su[S_TFOG_FULL] = tu.fogFull; su[S_TFOG_CURVE] = tu.fogCurve;
      if (tu.nearRGB) for (let k = 0; k < 3; k++) su[S_TFOG_NEAR + k] = tu.nearRGB[k];
      if (tu.farRGB) for (let k = 0; k < 3; k++) su[S_TFOG_FAR + k] = tu.farRGB[k];
      eu[E_TFOG_START] = tu.fogStart; eu[E_TFOG_FULL] = tu.fogFull; eu[E_TFOG_CURVE] = tu.fogCurve;
    }
    si[S_NEARDETAIL] = tu.nearDetail ? 1 : 0;
    if (tu.nearDetail) { su[S_HANDOVER] = tu.handover[0]; su[S_HANDOVER + 1] = tu.handover[1]; su[S_CLOSEBAND] = tu.closeBand; }
  }

  /**
   * Runs shade then edge. @param {any} p the WgCellPipeline (_fb/_cam/_world/_rasterPass/_palette/rays/cols/rows/rt/_source)
   * @param {any} t its targets (needs texShadeFg/Bg, texFinalFg/Bg, targetShade, targetFinal)
   * @param {{cam:any}} lightCam the light pass cam basis (horizonRow / planeDistY)
   */
  run(p, t, lightCam, water = null) {
    const d = this.device, rt = p.rt, su = this.su, si = this.si, eu = this.eu, ei = this.ei;
    if (p._table !== this.table || (p._palette && p._palette !== this.palette)) { this.table = p._table; this.palette = p._palette || this.palette; this.tableDirty = true; this.skyPalette = null; }
    if (this.table && this.table.records && this.table.records.length !== this.nRec) this.tableDirty = true; // bindLevel appended materials in place
    if (this.tableDirty) this._uploadTable();
    if (!this.packed) return false; // nothing bound: no shade possible (the CPU present is unaffected)
    if (this.palette && (this.skyPalette !== this.palette || this.skyTime !== this.palette.defaultTime)) this._bakeSky();
    const useScene = p._source !== 'upload' && !!p._cam && !!p._world;
    if (useScene) this._ensureTerrain(p._world);
    const rp = p._rasterPass, pitched = useScene && !!(rp && rp.pitched);
    si[S_N] = p._source === 'upload' ? 1 : p.rays;
    si[S_GPUSKY] = useScene ? 1 : 0;
    const sh = p._shadowPass, sun = p._light && p._light.sun;
    si[S_SUNMAP] = sh && sh.active && sun && sun.on ? 1 : 0; // WG-3d: GL uSunMapOn = shadowActive && sun.on (light runs sunMode 2)
    const fbT = p._fb; let tSec = 0; if (fbT) { const v = fbT.timeSec; if (v) tSec = v; } // same value as (fb && fb.timeSec) || 0 without a tagged phi (boxes a HeapNumber per frame)
    su[S_TIME] = tSec;
    su[S_SKY_ELEV] = this.skyElevTop;
    const pm = pitched ? (rp.ortho ? 2 : 1) : 0; // US-068b2: 2 = ortho
    si[S_PROJ] = pm; ei[E_PROJ] = pm;
    if (pitched) {
      const q = rp.pitch;
      su[S_PITCH_A] = q.fX; su[S_PITCH_A + 1] = q.fY; su[S_PITCH_A + 2] = q.fZ; su[S_PITCH_A + 3] = q.tanHalfX;
      su[S_PITCH_B] = q.rX; su[S_PITCH_B + 1] = q.rY; su[S_PITCH_B + 2] = q.uX; su[S_PITCH_B + 3] = q.uY;
      su[S_PITCH_C] = q.uZ; su[S_PITCH_C + 1] = q.tanHalfY; su[S_PITCH_C + 2] = q.cosP; su[S_PITCH_C + 3] = q.sinP;
      eu[E_PITCH_C] = q.uZ; eu[E_PITCH_C + 1] = q.tanHalfY; eu[E_PITCH_C + 2] = q.cosP; eu[E_PITCH_C + 3] = q.sinP;
      su[S_HASHCELL] = rp.ortho ? orthoHashCell(q, p.cols) : -(2 * q.tanHalfX / p.cols); // BUG-FP-002: per-cell mode on every pitched frame
    } else su[S_HASHCELL] = 0;
    if (useScene && lightCam) { su[S_HORIZON] = lightCam.horizonRow; su[S_PLANEDY] = lightCam.planeDistY; }
    if (useScene && p._world.terrain && this.palette) { // US-026a S5: the sun for the terrain look, per frame (a few trig calls)
      const sun = sunFromWorld(p._world, this.palette, this.sunScratch);
      su[S_SUN_DIR] = sun.dirX; su[S_SUN_DIR + 1] = sun.dirY; su[S_SUN_DIR + 2] = sun.dirZ;
      su[S_AMBIENT_I] = sun.ambientI; su[S_SUN_I] = sun.sunI;
    }
    const tx = this.shTex;
    tx[SH.GI].texture = t.texGI; tx[SH.GA].texture = t.texGA; tx[SH.GD].texture = t.texGD; tx[SH.DEPTH].texture = t.texDepth;
    tx[SH.SGI].texture = t.texSGI; tx[SH.SGA].texture = t.texSGA; tx[SH.FG].texture = rt.fgTex; tx[SH.BG].texture = rt.bgTex;
    tx[SH.SKY].texture = this.texSky; tx[SH.MATF].texture = this.texMatF; tx[SH.MATI].texture = this.texMatI;
    tx[SH.SETI].texture = this.texSetI; tx[SH.SETF].texture = this.texSetF; tx[SH.GAIN].texture = this.texGain;
    tx[SH.LIGHT].texture = t.texLight; tx[SH.TLOOK].texture = this.texTlook;
    wgSpanBegin(p, WG_PASS_SLOT.shade);
    try { d.beginPass(t.targetShade); d.bind(this.pipeShade, this.shBind); d.draw(3); d.endPass(); } finally { wgSpanEnd(p); }
    // WG-3e: water composite between shade and edge (GL order); a no-op when the layer is inactive
    if (water && water.active) {
      wgSpanBegin(p, WG_PASS_SLOT.water);
      try { water.runComposite({ shadeFg: t.texShadeFg, shadeBg: t.texShadeBg, gi: t.texGI, depth: t.texDepth, light: t.texLight, shadowActive: !!(sh && sh.active) }, p); } finally { wgSpanEnd(p); }
    }

    const wOn = !!(water && water.active); // WG-3e: composite output replaces the shade fg/bg; WATER texture + per-slot opaqueAt/seeThrough
    ei[E_COLS] = p.cols; ei[E_ROWS] = p.rows; ei[E_WATER_ON] = wOn ? 1 : 0;
    if (wOn) eu.set(water.waterOS, E_WOS);
    const et = this.edTex;
    et[0].texture = t.texGI; et[1].texture = t.texDepth;
    et[2].texture = wOn ? water.edgeFg : t.texShadeFg; et[3].texture = wOn ? water.edgeBg : t.texShadeBg;
    et[4].texture = wOn ? water.edgeWaterTexture : this.texWaterDummy;
    et[5].texture = this.texMatI; // ALPHA-01d: F_SOFT_EDGE flag per material
    wgSpanBegin(p, WG_PASS_SLOT.edge);
    try { d.beginPass(t.targetFinal); d.bind(this.pipeEdge, this.edBind); d.draw(3); d.endPass(); } finally { wgSpanEnd(p); }
    return true;
  }

  dispose() {
    const d = this.device;
    for (const k of ['pipeShade', 'pipeEdge', 'texMatF', 'texMatI', 'texSetI', 'texSetF', 'texGain', 'texSky', 'texTlook', 'texWaterDummy']) {
      if (this[k]) { try { d.dispose(this[k]); } catch (_) { /* best effort */ } this[k] = null; }
    }
  }
}
