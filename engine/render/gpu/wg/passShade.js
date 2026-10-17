// WG-3c (docs/architecture.md 38.8/38.8a items 20-22): shade (pass 1) + edge (pass 2) as fullscreen WebGPU passes after light
// (GpuCellPipeline._passShade/_passEdgeOrDebug + bind/_bindStaticUniforms/_bakeSkyLUT/_ensureTerrainTextures twin).
// Shade reads the resolved GI/GA/GD/Depth, the sub-sample set, the CPU cell layer (rt.fgTex/bgTex), the material/glyph/sky/look
// textures and the light output; writes texShadeFg/Bg. Edge reads those and writes texFinalFg/Bg (fg.a = glyph/255).
// Pipelines + bind descriptors are built once (22b); the material/sky/terrain-look textures upload only on change
// (matTable bind, palette/time of day, terrain far-bake version); per frame only uniform words change.
// The water layer is WG-3e: edge gets waterOn = 0 and a 1x1 dummy WATER texture. ALPHA-01d soft edges are WGSL-only (edge.wgsl.js header, D-044), not in the shipped GLSL
// (twin: edgePass.js).
import { meshOutdoorFog, fogShapeCtx, foliageBits } from '../../fogShape.js'; // OB-089; AA-15 aaFol / AA-16 aaFolL switches
import { updateUnderState } from '../../underwater.js'; // SWIM-04c
import { SHADE_BLOCK, SHADE_WGSL, SHADE_LEVEL_WGSL, SHADE_TEXTURES, SHADE_LOOK_BLOCK, SHADE_LOOK_WGSL, SHADE_LEVEL_LOOK_WGSL, SHADE_GI_WGSL, SHADE_LEVEL_GI_WGSL, SHADE_LOOK_GI_WGSL, SHADE_LEVEL_LOOK_GI_WGSL, SHADE_GI_BUFFERS } from '../wgsl/shade.wgsl.js';
import { giBufferFor } from './giUpload.js'; // GI-PROBE-05
import { packLookTable, LOOK_TABLE_WORDS } from '../../groundLook.js'; // ENV-02d
import { EDGE_BLOCK, EDGE_WGSL, EDGE_TEXTURES } from '../wgsl/edge.wgsl.js';
import { packMaterialTable } from '../ShadeTextures.js';
import { packTerrainTextures } from '../TerrainTextures.js';
import { SKY_LUT_N } from '../wgsl/skyLut.js';
import { applySkyHaze } from '../../atmos.js'; // ENV-03c
import { sunFromWorld } from '../../lighting.js';
import { resolveLook } from '../../look.js';
import { liveCloudsRecord } from '../../sky.js';
import { skylineFor, grassTableFor, packGrassTable, makeFarGrass, farGrassFill, getGrassShade, getFarForest } from '../../terrainShade.js'; // MAP-06b: same record as the JS twin's ctx.skyline
import { PROJ_HFOV_DEG } from '../../projection.js';
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
const S_N = S('n'), S_GPUSKY = S('gpuSky'), S_PROJ = S('projMode'), S_SUNMAP = S('sunMapOn'), S_NEARDETAIL = S('nearDetailOn'), S_AACOV = S('aaCov');
const S_SPARSE_ALT = S('fogSparseAlt'), S_HAZE_ALT = S('fogHazeAlt');
const S_SPARSE_C0 = S('fogSparseCode0'), S_SPARSE_C1 = S('fogSparseCode1'), S_HAZE_C0 = S('fogHazeCode0'), S_HAZE_C1 = S('fogHazeCode1');
const S_ETA = S('etA'), S_ETID = S('etId'), S_ETC = S('etC'); // 38.23 tint words
const EMPTY_GRASS = { n: new Uint8Array(1), ramp: new Float64Array(12), glyph: new Uint8Array(5) };
const S_PITCH_A = S('pitchA'), S_PITCH_B = S('pitchB'), S_PITCH_C = S('pitchC'), S_FACEK = S('faceK'), S_SKYCAM = S('skyCam'), S_FOGVIEW = S('fogView'), S_SKYGLOWON = S('skyGlowOn'), S_SKYLINE = S('skyline'), S_GRASS = S('grass'), S_CLIFF = S('cliff'), S_FGP = S('fgP'), S_FGW = S('fgW'), S_FGT = S('fgT'), S_FGQ = S('fgQ');
const S_SHAFT = S('shaftA'); // CANOPY-SHAFT-01b: (k, iso, pw, maxM) from light.shaft
const S_CLOUD = S('cloudA'); // CLOUD-FLUFF-01b: cloudA..cloudShade are 7 contiguous vec4 words
const S_UNDER = S('under'), S_UNDER_TINT = S('underTint'), S_UNDER_CAM = S('underCam'), S_UNDER_CEIL = S('underCeil'), S_UNDER_CAUS = S('underCaus'), S_UNDER_RB = S('underRampB'), S_UNDER_RC = S('underRampC'); // SWIM-04c
/** 38.23: copy the tint table (fb.entityTints) into the ShadeU words: etA.x = count, etId (u32 view), etC rgb+k. Zero alloc; count 0 and cleared tail when absent. */
export function writeEntityTints(su, su32, tints) {
  const n = tints && tints.count > 0 ? (tints.count > 8 ? 8 : tints.count) : 0;
  su[S_ETA] = n;
  for (let i = 0; i < 8; i++) {
    su32[S_ETID + i] = i < n ? tints.ids[i] : 0;
    for (let k = 0; k < 4; k++) su[S_ETC + i * 4 + k] = i < n ? tints.rgbk[i * 4 + k] : 0;
  }
}
const E_COLS = E('gridCols'), E_ROWS = E('gridRows'), E_FOGMAX = E('fogMax'), E_RIM = E('modelRim'), E_WATER_ON = E('waterOn'), E_WOS = E('wos'), E_PROJ = E('projMode');
const E_FOG_START = E('fogStart'), E_FOG_FULL = E('fogFull'), E_TFOG_START = E('terrainFogStart'), E_TFOG_FULL = E('terrainFogFull'), E_TFOG_CURVE = E('terrainFogCurve');
const E_PITCH_C = E('pitchC'), E_GLYPH = E('edgeGlyph'), E_GAIN = E('edgeGain'), E_SOFTGAIN = E('softGain');

/** SHADE_TEXTURES slot order (shade.wgsl.js header). */
const SH = { GI: 0, GA: 1, GD: 2, DEPTH: 3, SGI: 4, SGA: 5, FG: 6, BG: 7, SKY: 8, MATF: 9, MATI: 10, SETI: 11, SETF: 12, GAIN: 13, LIGHT: 14, TLOOK: 15 };

export class WgShadePass {
  /** @param {any} device @param {{stable?: boolean}} [opts] stable (US-073b): shade writes a 3rd r8ui level target; absent = the unchanged 2-target pipeline */
  constructor(device, opts = null) {
    this.device = device;
    this.stable = !!(opts && opts.stable);
    this.aaCov = !(opts && opts.aaCov === false); // 38.82 A: coverage-weighted minority colour, default ON (?aacov=0 -> main.js passes false)
    const lvl = this.stable ? SHADE_LEVEL_WGSL : SHADE_WGSL;
    this.pipeShade = device.createPipeline({
      vertex: { src: { wgsl: lvl } }, fragment: { src: { wgsl: lvl }, targets: this.stable ? 3 : 2 },
      bindings: { uniformBytes: SHADE_BLOCK.sizeBytes, textures: SHADE_TEXTURES.slice() },
      targetFormats: this.stable ? ['rgba8', 'rgba8', 'r8ui'] : ['rgba8', 'rgba8'],
    });
    // ENV-02d (38.63): look variant of the shade pipeline (ShadeU + the look table), built lazily the first time a world with groundLook is drawn.
    // Look off (no groundLook) never touches any of this: pipeline, uniforms and binds stay exactly as before.
    // GI-PROBE-05: GI variants (lazy, one storage buffer after the 16 textures); GI off never builds or binds them.
    this.pipeShadeGI = null; this.pipeShadeLookGI = null; this.shBindG = null; this.shBindLG = null;
    this.pipeShadeLook = null; this.suL = null; this.suL32 = null; this.shBindL = null; this.lookCfg = null;
    this.pipeEdge = device.createPipeline({
      vertex: { src: { wgsl: EDGE_WGSL } }, fragment: { src: { wgsl: EDGE_WGSL }, targets: 2 },
      bindings: { uniformBytes: EDGE_BLOCK.sizeBytes, textures: EDGE_TEXTURES.slice() },
      targetFormats: ['rgba8', 'rgba8'],
    });
    this.grassCfg = undefined; this.grassTmp = null; this.su = new Float32Array(SHADE_BLOCK.sizeWords); this.si = new Int32Array(this.su.buffer); this.su32 = new Uint32Array(this.su.buffer);
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
    this.skyFogVer = 0; this.terrainFogVer = 0; // ENV-03c: liveFogVersion of the last sky bake / terrain fog upload
    this.skyClouds = null; this.skyCloudBand = null; this.skyCloudWind = null; // CLOUD-FLUFF-01b
    this.skyPalette = null; this.skyTime = null; this.skyLiveVer = -1; // DN-02: liveLookVersion of the last bake (-1 = baked from the static look)
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

  /** DN-02: the sky LUT needs a (re)bake: new palette / default time, or liveLookVersion changed (-1 = no live look = frozen path). */
  _skyStale() {
    const P = this.palette;
    return this.skyPalette !== P || this.skyTime !== P.defaultTime || this.skyLiveVer !== (P.liveLook ? (P.liveLookVersion | 0) : -1) || this.skyFogVer !== (P.liveFogVersion | 0);
  }

  /** CLOUD-FLUFF-01b: static GPU sky cloud words (once per look change, from _bakeSky); no block = zeros (off). Twin: sky.js fillSky. */
  _bakeClouds(su, C, band) {
    const o = S_CLOUD;
    if (!C || !band) { for (let i = 0; i < 28; i++) su[o + i] = 0; return; }
    su[o] = 1; su[o + 1] = C.seed; su[o + 2] = C.scale; su[o + 3] = C.bias;
    su[o + 4] = C.cover; su[o + 5] = C.puffK; su[o + 6] = C.wispCover; su[o + 7] = C.wispK;
    su[o + 8] = C.litK; su[o + 9] = C.litDy; su[o + 10] = C.bodyK; su[o + 11] = 0;
    su[o + 14] = band[0]; su[o + 15] = band[1]; su[o + 16] = band[2];
    su[o + 20] = C.lit[0]; su[o + 21] = C.lit[1]; su[o + 22] = C.lit[2]; su[o + 23] = 0;
    su[o + 24] = C.shade[0]; su[o + 25] = C.shade[1]; su[o + 26] = C.shade[2]; su[o + 27] = 0;
  }

  // GL _bakeSkyLUT twin (flat gradient, SKY_LUT_N samples over elevation [0, elevTop]); re-baked when the palette / time of day changes.
  _bakeSky() {
    const P = this.palette;
    this.skyPalette = P; this.skyTime = P ? P.defaultTime : null;
    const live = P && P.liveLook; // DN-02: day/night look (blendLook); unset = the frozen path, byte-identical to before
    this.skyLiveVer = live ? (P.liveLookVersion | 0) : -1;
    this.skyFogVer = P ? (P.liveFogVersion | 0) : 0;
    const rec = P && P.materials && P.materials.sky;
    const look0 = P ? resolveLook(P) : null; // CLOUD-FLUFF-01b: cached for _writeClouds
    this.skyClouds = look0 ? look0.clouds : null;
    // CLOUD-LIVE-01: live day/night blend carries the cloud colours (shallow copy so the cached look stays frozen)
    this.skyClouds = liveCloudsRecord(this.skyClouds, live, this._cloudCache || (this._cloudCache = { base: null, rec: null })); // shared with sky.js fillSky (reused record, no alloc)
    this.skyCloudBand = this.skyClouds && rec ? rec.cloudBand : null; this.skyCloudWind = this.skyClouds ? this.skyClouds.wind : null;
    if (this.su) this._bakeClouds(this.su, this.skyClouds, this.skyCloudBand);
    if (!rec || !P.timeOfDay) return;
    const stops = (live || P.timeOfDay[P.defaultTime]).sky;
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
    if (P.atmos) applySkyHaze(data, SKY_LUT_N, P.atmos); // ENV-03c: horizon haze (no-op when off), same rule as the JS LUT bakes
    this.device.writeTexture(this.texSky, data);
    this.skyElevTop = rec.elevTop;
    this.stats.skyBakes++;
  }

  // GL _ensureTerrainTextures + _uploadTerrainUniforms (shade/edge part) twin: TLOOK + band/fog/near-detail constants, only on a new far bake.
  _ensureTerrain(world) {
    const terrain = world && world.terrain;
    if (!terrain || !terrain.farReady || !this.palette) return;
    const fogVer = this.palette.liveFogVersion | 0; // ENV-03c: the fog uniforms also follow the live atmosphere record
    const newBake = this.terrainVersion !== terrain.farVersion || this.terrainWorld !== world;
    if (!newBake && this.terrainFogVer === fogVer) return;
    this.terrainFogVer = fogVer;
    if (newBake) { // tlook pack + upload only on a new far bake (a fog-only bump rewrites just the uniforms below, 0 alloc)
      const packed = packTerrainTextures(terrain, this.palette);
      this.texTlook = this._recreate(this.texTlook, 'rgba32f', packed.tlookWidth, Math.max(1, packed.tlookHeight));
      this.device.writeTexture(this.texTlook, packed.tlook);
      this.terrainVersion = terrain.farVersion; this.terrainWorld = world;
      this.stats.terrainUploads++;
    }
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
    // OB-104b2 (38.55): cliff look = recipe rock type id (twin: makeTerrainShadeCtx ctx.cliffType; y = 0 -> off)
    const rk = recipe && recipe.terrain && recipe.terrain.rock;
    su[S_CLIFF] = rk ? rk.id : 0; su[S_CLIFF + 1] = rk ? 1 : 0;
    si[S_NEARDETAIL] = tu.nearDetail ? 1 : 0;
    si[S_AACOV] = this.aaCov ? 1 : 0;
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
    if (this.palette && this._skyStale()) this._bakeSky(); // DN-02: re-bake only on a new liveLookVersion
    const useScene = p._source !== 'upload' && !!p._cam && !!p._world;
    if (useScene) this._ensureTerrain(p._world);
    const rp = p._rasterPass, pitched = useScene && !!(rp && rp.pitched);
    si[S_N] = p._source === 'upload' ? 1 : p.rays;
    si[S_GPUSKY] = useScene ? 1 : 0;
    const sh = p._shadowPass, sun = p._light && p._light.sun;
    si[S_SUNMAP] = sh && sh.active && sun && sun.on ? 1 : 0; // WG-3d: GL uSunMapOn = shadowActive && sun.on (light runs sunMode 2)
    const fbT = p._fb; let tSec = 0; if (fbT) { const v = fbT.timeSec; if (v) tSec = v; } // same value as (fb && fb.timeSec) || 0 without a tagged phi (boxes a HeapNumber per frame)
    su[S_TIME] = tSec;
    writeEntityTints(su, this.su32, fbT && fbT.entityTints);
    su[S_SKY_ELEV] = this.skyElevTop;
    const pm = pitched ? (rp.ortho ? 2 : 1) : 0; // US-068b2: 2 = ortho
    si[S_PROJ] = pm; ei[E_PROJ] = pm;
    if (useScene && p._cam && !pitched) { // AUD-40: shear-mode sky ray basis (same terms as sky.js fillSky)
      const yr = p._cam.yawDeg * Math.PI / 180, th = Math.tan(PROJ_HFOV_DEG * Math.PI / 360), dx = Math.sin(yr), dy = -Math.cos(yr);
      su[S_SKYCAM] = dx; su[S_SKYCAM + 1] = dy; su[S_SKYCAM + 2] = -dy * th; su[S_SKYCAM + 3] = dx * th;
    }
    // AUD-45: height fog + sun in-scatter, same gate as the CPU compositor (terrain world with a time-of-day palette).
    const fogShapeOn = useScene && !!p._world.terrain && !!(p._palette && p._palette.timeOfDay);
    su[S_FOGVIEW] = fogShapeOn ? p._cam.z : 0; su[S_FOGVIEW + 1] = fogShapeOn ? 1 : 0;
    // AA-15 (OB-208): foliage world dice (fogView.w; same gate as the twin: fog ctx on, not ortho). underCam.xy = camera x/y every frame
    // (the underwater block itself stays gated on under.x, and rewrites the same values when submerged).
    su[S_FOGVIEW + 3] = fogShapeOn && !(pitched && rp.ortho) ? foliageBits() : 0; // AA-16: bit 1 dice, bit 2 leaf light smoothing
    if (useScene && p._cam) { su[S_UNDER_CAM] = p._cam.x; su[S_UNDER_CAM + 1] = p._cam.y; }
    su[S_FOGVIEW + 2] = fogShapeOn && this.terrainU.fogOn && meshOutdoorFog(p._world, p._cam, p._palette) ? 1 : 0; // OB-089: mesh pixels fog like the terrain outdoors
    const liveK = this.palette && this.palette.liveLook; su[S_SKYGLOWON + 1] = liveK && liveK.floorEff > 0 ? liveK.floorEff : 0; // DN-02 night glyph-luminance floor (0 = off)
    const atm = this.palette && this.palette.atmos; su[S_SKYGLOWON + 2] = fogShapeOn && atm && atm.farSkyW > 0 ? atm.farSkyW : 0; // VISQA-02: far fog sky shift weight (twin: fogShape.js farSkyPrep)
    su[S_FACEK + 7] = getFarForest(); // OB-222 candidate (?farforest=1)
    su[S_SKYGLOWON + 3] = getGrassShade(); // OB-217 (?grassshade=0 -> 0)
    su[S_SKYGLOWON] = fogShapeOn ? 1 : 0; // AUD-40: same gate, written every frame (sunDir/sunI are stale outside terrain worlds)
    if (this.skyClouds) { const o = S_CLOUD + 12, w = this.skyCloudWind; su[o] = (w[0] * tSec) % 256; su[o + 1] = (w[1] * tSec) % 256; } // drift = sky.js cloudDriftOffset (f32 store = fround)
    if (pitched) {
      const q = rp.pitch;
      su[S_PITCH_A] = q.fX; su[S_PITCH_A + 1] = q.fY; su[S_PITCH_A + 2] = q.fZ; su[S_PITCH_A + 3] = q.tanHalfX;
      su[S_PITCH_B] = q.rX; su[S_PITCH_B + 1] = q.rY; su[S_PITCH_B + 2] = q.uX; su[S_PITCH_B + 3] = q.uY;
      su[S_PITCH_C] = q.uZ; su[S_PITCH_C + 1] = q.tanHalfY; su[S_PITCH_C + 2] = q.cosP; su[S_PITCH_C + 3] = q.sinP;
      eu[E_PITCH_C] = q.uZ; eu[E_PITCH_C + 1] = q.tanHalfY; eu[E_PITCH_C + 2] = q.cosP; eu[E_PITCH_C + 3] = q.sinP;
      su[S_HASHCELL] = rp.ortho ? orthoHashCell(q, p.cols) : -(2 * q.tanHalfX / p.cols); // BUG-FP-002: per-cell mode on every pitched frame
    } else su[S_HASHCELL] = 0;
    // MAP-06b (38.42): far-terrain fog cap, written every frame (cached record; x = 0 = off, the JS twin's ctx.skyline === null)
    const skl = useScene && p._world.terrain && this.palette ? skylineFor(p._world.terrain, this.palette) : null;
    su[S_SKYLINE] = skl ? skl.fogMax : 0; su[S_SKYLINE + 1] = skl ? skl.fromZ : 0; su[S_SKYLINE + 2] = skl ? skl.seaFogMax : 0; su[S_SKYLINE + 3] = skl ? skl.seaLevel : 0;
    // SWIM-04c (38.54): underwater look words, written every frame (under.x = 0 = block skipped; fb.under = makeUnderState, absent = dry)
    const U = useScene && fbT ? fbT.under : null;
    if (U && p._world.water) updateUnderState(p._world, p._cam.x, p._cam.y, p._cam.z, U); else if (U) U.on = 0;
    if (U && U.on) {
      su[S_UNDER] = 1; su[S_UNDER + 1] = U.waterZ; su[S_UNDER + 2] = U.fogM; su[S_UNDER + 3] = U.causticK;
      su[S_UNDER_TINT] = U.tint[0]; su[S_UNDER_TINT + 1] = U.tint[1]; su[S_UNDER_TINT + 2] = U.tint[2]; su[S_UNDER_TINT + 3] = U.swapAt;
      su[S_UNDER_CAM] = p._cam.x; su[S_UNDER_CAM + 1] = p._cam.y; su[S_UNDER_CAM + 2] = p._cam.z; su[S_UNDER_CAM + 3] = U.lightK;
      su[S_UNDER_CEIL] = U.ceil[0]; su[S_UNDER_CEIL + 1] = U.ceil[1]; su[S_UNDER_CEIL + 2] = U.ceil[2];
      su[S_UNDER_CAUS] = U.causticCol[0]; su[S_UNDER_CAUS + 1] = U.causticCol[1]; su[S_UNDER_CAUS + 2] = U.causticCol[2];
      for (let k = 0; k < 4; k++) { su[S_UNDER_RB + k] = U.bubble[k]; su[S_UNDER_RC + k] = U.ceilRamp[k]; }
    } else su[S_UNDER] = 0;
    // OB-073 D2e: carpet variant ramp/glyph table (rewritten only when the carpet config object changes; null = zeros, kind 10 never appears)
    const gcfg = useScene && p._world.carpet && p._world.carpet.cfg ? p._world.carpet.cfg : null;
    if (gcfg !== this.grassCfg) {
      this.grassCfg = gcfg;
      if (!this.grassTmp) this.grassTmp = new Float32Array(80 * 4);
      packGrassTable(gcfg ? grassTableFor(gcfg) : EMPTY_GRASS, this.grassTmp);
      su.set(this.grassTmp, S_GRASS);
    }
    // G2 + P3 (D-075 step 4): far grass tier, per frame (same record + fill as the JS twin's ctx.farGrass; on = 0 without a carpet)
    {
      const fgr = this.fgRec || (this.fgRec = makeFarGrass()), w = useScene ? p._world : null;
      if (gcfg && w.terrain && w.terrain.typeNames) farGrassFill(fgr, gcfg, w.terrain.typeNames, w.carpetQuality, w.wind && w.wind.params ? w.wind.params : null, tSec); else fgr.on = 0;
      su[S_FGP] = fgr.on * (1 + fgr.under); su[S_FGP + 1] = fgr.startM; su[S_FGP + 2] = fgr.fadeM; su[S_FGP + 3] = fgr.mix;
      su[S_FGW] = fgr.dirX; su[S_FGW + 1] = fgr.dirY; su[S_FGW + 2] = fgr.cyc; su[S_FGW + 3] = fgr.invTravel;
      su.set(fgr.types, S_FGT);
      su[S_FGQ] = fgr.qb; su[S_FGQ + 1] = fgr.tPrev; su[S_FGQ + 2] = fgr.qt; // AA-22 wind hold (twin: shadeTerrain)
    }
    { // CANOPY-SHAFT-01b: lift on only with march steps > 0 and k > 0 and the shadow-map sun (same gate as the light pass); else k = 0 -> shade skips it
      const shf = p._light && p._light.shaft, on = !!(shf && shf.steps > 0 && shf.k > 0 && si[S_SUNMAP] && !shf.liftOff); // liftOff: dev-only (gpucompare frame A, 38.76 rule 8a): march stays on, lift off
      su[S_SHAFT] = on ? shf.k : 0; su[S_SHAFT + 1] = on ? shf.iso : 0; su[S_SHAFT + 2] = on ? shf.pw : 0; su[S_SHAFT + 3] = on ? shf.maxM : 0;
    }
    if (useScene && lightCam) { su[S_HORIZON] = lightCam.horizonRow; su[S_PLANEDY] = lightCam.planeDistY; }
    if (useScene && p._world.terrain && this.palette) { // US-026a S5: the sun for the terrain look, per frame (a few trig calls)
      const sun = sunFromWorld(p._world, this.palette, this.sunScratch);
      su[S_SUN_DIR] = sun.dirX; su[S_SUN_DIR + 1] = sun.dirY; su[S_SUN_DIR + 2] = sun.dirZ;
      su[S_AMBIENT_I] = sun.ambientI; su[S_SUN_I] = sun.sunI;
    }
    // ENV-02d: look on = the terrain raster wrote the look word into GA.w (rp.lookActive, set by the raster host) AND the world has groundLook
    const lkCfg = useScene && rp && rp.lookActive && p._world.terrain && p._world.terrain.groundLook ? p._world.terrain.groundLook.cfg : null;
    const tx = this.shTex;
    tx[SH.GI].texture = t.texGI; tx[SH.GA].texture = t.texGA; tx[SH.GD].texture = t.texGD; tx[SH.DEPTH].texture = t.texDepth;
    tx[SH.SGI].texture = t.texSGI; tx[SH.SGA].texture = t.texSGA; tx[SH.FG].texture = rt.fgTex; tx[SH.BG].texture = rt.bgTex;
    tx[SH.SKY].texture = this.texSky; tx[SH.MATF].texture = this.texMatF; tx[SH.MATI].texture = this.texMatI;
    tx[SH.SETI].texture = this.texSetI; tx[SH.SETF].texture = this.texSetF; tx[SH.GAIN].texture = this.texGain;
    tx[SH.LIGHT].texture = t.texLight; tx[SH.TLOOK].texture = this.texTlook;
    wgSpanBegin(p, WG_PASS_SLOT.shade);
    try { d.beginPass(this.stable ? t.targetShadeLevel : t.targetShade); const gsto = p._light && p._light.gi ? giBufferFor(d).sync(p._light.gi) : null; if (lkCfg) this._bindLook(lkCfg, p._world, gsto); else if (gsto) this._bindGI(gsto); else d.bind(this.pipeShade, this.shBind); d.draw(3); d.endPass(); } finally { wgSpanEnd(p); }
    // WG-3e: water composite between shade and edge (GL order); a no-op when the layer is inactive
    if (water && water.active) {
      wgSpanBegin(p, WG_PASS_SLOT.water);
      try { water.runComposite({ shadeFg: t.texShadeFg, shadeBg: t.texShadeBg, gi: t.texGI, depth: t.texDepth, light: t.texLight, shadowActive: !!(sh && sh.active) }, p); } finally { wgSpanEnd(p); }
    }

    const wOn = !!(water && water.active); // WG-3e: composite output replaces the shade fg/bg; WATER texture + per-slot opaqueAt/seeThrough
    ei[E_COLS] = p.cols; ei[E_ROWS] = p.rows; ei[E_WATER_ON] = wOn && !(U && U.on) ? 1 : 0; // SWIM-04c: submerged = no surface composite, so no water edge suppression (JS twin: waterMask null)
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

  /** ENV-02d: bind the look pipeline. The plain su words are copied bit-exact into the bigger look block (no alloc), the table is packed only on a new cfg, wind01 written per frame. */
  _bindLook(cfg, world, gsto = null) {
    const d = this.device;
    if (!this.pipeShadeLook) {
      const src = this.stable ? SHADE_LEVEL_LOOK_WGSL : SHADE_LOOK_WGSL;
      this.pipeShadeLook = d.createPipeline({
        vertex: { src: { wgsl: src } }, fragment: { src: { wgsl: src }, targets: this.stable ? 3 : 2 },
        bindings: { uniformBytes: SHADE_LOOK_BLOCK.sizeBytes, textures: SHADE_TEXTURES.slice() },
        targetFormats: this.stable ? ['rgba8', 'rgba8', 'r8ui'] : ['rgba8', 'rgba8'],
      });
      this.suL = new Float32Array(SHADE_LOOK_BLOCK.sizeWords); this.suL32 = new Uint32Array(this.suL.buffer);
      this.shBindL = { uniforms: this.suL, textures: this.shTex };
      this.lookWords = new Float32Array(LOOK_TABLE_WORDS); this.lookTW = SHADE_LOOK_BLOCK.field('lookT').word; this.lookPW = SHADE_LOOK_BLOCK.field('lookP').word;
    }
    if (this.lookCfg !== cfg) { packLookTable(cfg, this.lookWords); this.suL.set(this.lookWords, this.lookTW); this.lookCfg = cfg; this.stats.lookUploads = (this.stats.lookUploads || 0) + 1; }
    this.suL32.set(this.su32);
    const wp = world.wind && world.wind.params; // wind01: strength 0..1 of the world wind (0 = calm = look output is time-independent)
    this.suL[this.lookPW] = wp && wp.amp > 0 ? (wp.amp < 1 ? wp.amp : 1) : 0;
    if (gsto) this._bindLookGI(gsto); else d.bind(this.pipeShadeLook, this.shBindL);
  }

  // GI-PROBE-05: GI variants of the plain / look shade pipelines (same uniform block + textures, plus the probe storage buffer).
  _giPipe(src) {
    return this.device.createPipeline({
      vertex: { src: { wgsl: src } }, fragment: { src: { wgsl: src }, targets: this.stable ? 3 : 2 },
      bindings: { uniformBytes: (src === SHADE_LOOK_GI_WGSL || src === SHADE_LEVEL_LOOK_GI_WGSL ? SHADE_LOOK_BLOCK : SHADE_BLOCK).sizeBytes, textures: SHADE_TEXTURES.slice(), buffers: SHADE_GI_BUFFERS.slice() },
      targetFormats: this.stable ? ['rgba8', 'rgba8', 'r8ui'] : ['rgba8', 'rgba8'],
    });
  }
  _bindGI(gsto) {
    if (!this.pipeShadeGI) { this.pipeShadeGI = this._giPipe(this.stable ? SHADE_LEVEL_GI_WGSL : SHADE_GI_WGSL); this.shBindG = { uniforms: this.su, textures: this.shTex, storageBuffers: gsto }; }
    this.device.bind(this.pipeShadeGI, this.shBindG);
  }
  _bindLookGI(gsto) {
    if (!this.pipeShadeLookGI) { this.pipeShadeLookGI = this._giPipe(this.stable ? SHADE_LEVEL_LOOK_GI_WGSL : SHADE_LOOK_GI_WGSL); this.shBindLG = { uniforms: this.suL, textures: this.shTex, storageBuffers: gsto }; }
    this.device.bind(this.pipeShadeLookGI, this.shBindLG);
  }

  dispose() {
    const d = this.device;
    for (const k of ['pipeShade', 'pipeShadeLook', 'pipeShadeGI', 'pipeShadeLookGI', 'pipeEdge', 'texMatF', 'texMatI', 'texSetI', 'texSetF', 'texGain', 'texSky', 'texTlook', 'texWaterDummy']) {
      if (this[k]) { try { d.dispose(this[k]); } catch (_) { /* best effort */ } this[k] = null; }
    }
  }
}
