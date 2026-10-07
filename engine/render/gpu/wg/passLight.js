// WG-3b (docs/architecture.md 38.8a items 20-22): the light pass as a fullscreen WebGPU pass (GpuCellPipeline._passLight +
// _uploadLightUniforms + _ensureWorldTextures twin). Reads the resolved GI/GA/Depth, the LVIS occlusion atlas and the world
// geometry/flags atlas (sun DDA); writes texLight (rgba32uint). The sun shadow MAP pass is WG-3d: until then `sunMode` is never 2
// and uSunShadow is bound to a 1x1 dummy depth texture (shadow-free path = the GL `--shadows dda` path).
// Pipeline + bind descriptor are built once (22b); per frame only uniform words change, textures upload only on change.
import { LIGHT_BLOCK, LIGHT_WGSL, LIGHT_TEXTURES } from '../wgsl/light.wgsl.js';
import { MAX_LIGHTS, MAX_VIS_DIM, MAX_VIS_CELLS } from '../../lighting.js';
import { MAX_STRUCTS, buildWorldTextures, planFrameUpdate, makeFrameUpdatePlan } from '../WorldTextures.js';
import { PROJ_HFOV_DEG } from '../../projection.js';

const W = (n) => LIGHT_BLOCK.field(n).word;
const W_AMBIENT = W('ambient'), W_SUNDIR = W('sunDir'), W_SUNCOL = W('sunCol');
const W_GRID_COLS = W('gridCols'), W_GRID_ROWS = W('gridRows'), W_LIGHT_COUNT = W('lightCount'), W_SUN_ON = W('sunOn');
const W_STRUCT_COUNT = W('structCount'), W_SUN_MODE = W('sunMode'), W_PROJ_MODE = W('projMode'), W_WORLD_MAXH = W('worldMaxH');
const W_POSX = W('posX'), W_POSY = W('posY'), W_EYEH = W('eyeH'), W_DIRX = W('dirX'), W_DIRY = W('dirY');
const W_PLANEX = W('planeX'), W_PLANEY = W('planeY'), W_HORIZON = W('horizonRow'), W_PLANEDY = W('planeDistY');
const W_PITCH_A = W('pitchA'), W_PITCH_B = W('pitchB'), W_PITCH_C = W('pitchC');
const W_LIGHT_POS = W('lightPos'), W_LIGHT_COL = W('lightCol'), W_VIS_BOX = W('visBox');
const W_STRUCT_A = W('structA'), W_STRUCT_B = W('structB');

const NO_CAM = Object.freeze({ x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 });

export class WgLightPass {
  constructor(device) {
    this.device = device;
    this.pipe = device.createPipeline({
      vertex: { src: { wgsl: LIGHT_WGSL } }, fragment: { src: { wgsl: LIGHT_WGSL }, targets: 1 },
      bindings: { uniformBytes: LIGHT_BLOCK.sizeBytes, textures: LIGHT_TEXTURES.slice() },
      targetFormats: ['rgba32ui'],
    });
    this.lu = new Float32Array(LIGHT_BLOCK.sizeWords); this.li = new Int32Array(this.lu.buffer);
    this.texLVis = device.createTexture({ format: 'r8ui', width: MAX_VIS_DIM, height: MAX_LIGHTS * MAX_VIS_DIM });
    this.texSunDummy = device.createTexture({ format: 'depth24', sampled: true, width: 1, height: 1 });
    this.texGeom = device.createTexture({ format: 'rgba32f', width: 1, height: 1 });
    this.texFlags = device.createTexture({ format: 'rg8ui', width: 1, height: 1 });
    this.geomW = 1; this.geomH = 1;
    this.lvisUploaded = new Int32Array(MAX_LIGHTS).fill(-1);
    this.atlas = null; this.atlasWorld = null; this.plan = null;
    this.tex = [0, 1, 2, 3, 4, 5, 6].map(slot => ({ slot, texture: null }));
    this.bindDesc = { uniforms: this.lu, textures: this.tex };
    this.visBox = new Float32Array(4 * MAX_LIGHTS);
    this.cam = { posX: 0, posY: 0, eyeH: 0, dirX: 0, dirY: 0, planeX: 0, planeY: 0, horizonRow: 0, planeDistY: 0 };
  }

  /** _computeCamBasis twin (scalars the light pass reads). */
  _camBasis(cam, cols, rows, rt) {
    const tanHalfHFov = Math.tan(PROJ_HFOV_DEG * Math.PI / 180 / 2);
    const yawRad = cam.yawDeg * Math.PI / 180;
    const dirX = Math.sin(yawRad), dirY = -Math.cos(yawRad);
    const screenAspect = (cols * (rt.pxCellW || 1)) / (rows * (rt.pxCellH || 1));
    const planeDistY = (rows / 2) * screenAspect / tanHalfHFov;
    const pitchRad = cam.pitchDeg * Math.PI / 180;
    const cb = this.cam;
    cb.posX = cam.x; cb.posY = cam.y; cb.eyeH = cam.z; cb.dirX = dirX; cb.dirY = dirY;
    cb.planeX = -dirY * tanHalfHFov; cb.planeY = dirX * tanHalfHFov;
    cb.horizonRow = rows / 2 + Math.tan(pitchRad) * planeDistY; cb.planeDistY = planeDistY;
    return cb;
  }

  // world atlas upload: full on a different World / structVersion bump, else only the dirty rows (GL twin _ensureWorldTextures)
  _ensureWorld(world) {
    if (!this.atlas || this.atlasWorld !== world) { this.atlas = buildWorldTextures(world); this.atlasWorld = world; this._uploadFull(); return; }
    const plan = planFrameUpdate(world, this.atlas, this.plan || (this.plan = makeFrameUpdatePlan()));
    if (plan.rebuildNeeded) { this.atlas = buildWorldTextures(world); this._uploadFull(); return; }
    const a = this.atlas, d = this.device;
    for (let k = 0; k < plan.count; k++) {
      const y0 = plan.ranges[k * 2], rows = plan.ranges[k * 2 + 1] - y0 + 1;
      const rect = { x: 0, y: y0, w: a.width, h: rows };
      d.writeTexture(this.texGeom, a.GEOM.subarray(y0 * a.width * 4, (y0 + rows) * a.width * 4), rect);
      d.writeTexture(this.texFlags, a.FLAGS.subarray(y0 * a.width * 2, (y0 + rows) * a.width * 2), rect);
    }
    if (plan.count || plan.uStructDirty) this._uploadUStruct();
  }

  _uploadFull() {
    const a = this.atlas, d = this.device;
    if (a.width !== this.geomW || a.height !== this.geomH) {
      d.dispose(this.texGeom); d.dispose(this.texFlags);
      this.texGeom = d.createTexture({ format: 'rgba32f', width: a.width, height: a.height });
      this.texFlags = d.createTexture({ format: 'rg8ui', width: a.width, height: a.height });
      this.geomW = a.width; this.geomH = a.height;
    }
    d.writeTexture(this.texGeom, a.GEOM);
    d.writeTexture(this.texFlags, a.FLAGS);
    this._uploadUStruct();
  }

  _uploadUStruct() {
    const a = this.atlas, lu = this.lu;
    let worldMaxH = 0;
    for (let i = 0; i < a.structCount; i++) {
      const m = a.uStruct[i * 8 + 2] + a.uStruct[i * 8 + 7];
      if (m > worldMaxH) worldMaxH = m;
    }
    for (let i = 0; i < MAX_STRUCTS; i++) {
      const o8 = i * 8, o4 = i * 4;
      lu[W_STRUCT_A + o4] = a.uStruct[o8]; lu[W_STRUCT_A + o4 + 1] = a.uStruct[o8 + 1];
      lu[W_STRUCT_A + o4 + 2] = a.uStruct[o8 + 2]; lu[W_STRUCT_A + o4 + 3] = a.uStruct[o8 + 3];
      lu[W_STRUCT_B + o4] = a.uStruct[o8 + 4]; lu[W_STRUCT_B + o4 + 1] = a.uStruct[o8 + 5];
      lu[W_STRUCT_B + o4 + 2] = a.uStruct[o8 + 6]; lu[W_STRUCT_B + o4 + 3] = a.uStruct[o8 + 7];
    }
    this.li[W_STRUCT_COUNT] = a.structCount;
    lu[W_WORLD_MAXH] = worldMaxH;
  }

  // _uploadLightUniforms twin; sunMode is 1 (DDA) whenever the sun is on: the map mode (2) waits for WG-3d.
  _uploadLight(light) {
    const lu = this.lu, li = this.li;
    const isSet = light && typeof light === 'object' && light.pos && light.col && typeof light.count === 'number';
    if (!isSet) {
      const a = light || [0, 0, 0];
      lu[W_AMBIENT] = a[0] || 0; lu[W_AMBIENT + 1] = a[1] || 0; lu[W_AMBIENT + 2] = a[2] || 0;
      li[W_LIGHT_COUNT] = 0; li[W_SUN_ON] = 0; li[W_SUN_MODE] = 0;
      return;
    }
    lu[W_AMBIENT] = light.ambient[0]; lu[W_AMBIENT + 1] = light.ambient[1]; lu[W_AMBIENT + 2] = light.ambient[2];
    const sun = light.sun, on = !!(sun && sun.on);
    li[W_SUN_ON] = on ? 1 : 0;
    if (sun) {
      lu[W_SUNDIR] = sun.dir[0]; lu[W_SUNDIR + 1] = sun.dir[1]; lu[W_SUNDIR + 2] = sun.dir[2];
      lu[W_SUNCOL] = sun.col[0]; lu[W_SUNCOL + 1] = sun.col[1]; lu[W_SUNCOL + 2] = sun.col[2];
    }
    li[W_SUN_MODE] = on ? 1 : 0;
    const n = Math.min(MAX_LIGHTS, light.count);
    li[W_LIGHT_COUNT] = n;
    if (n <= 0) return;
    lu.set(light.pos.length > MAX_LIGHTS * 4 ? light.pos.subarray(0, MAX_LIGHTS * 4) : light.pos, W_LIGHT_POS);
    lu.set(light.col.length > MAX_LIGHTS * 4 ? light.col.subarray(0, MAX_LIGHTS * 4) : light.col, W_LIGHT_COL);
    const vb = this.visBox;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const o = i * 4;
      vb[o] = light.visOx[i]; vb[o + 1] = light.visOy[i]; vb[o + 2] = light.visW[i]; vb[o + 3] = light.visH[i];
    }
    lu.set(vb, W_VIS_BOX);
    const d = this.device;
    for (let i = 0; i < n; i++) {
      if (light.visVersion[i] === this.lvisUploaded[i]) continue;
      d.writeTexture(this.texLVis, light.vis.subarray(i * MAX_VIS_CELLS, (i + 1) * MAX_VIS_CELLS), { x: 0, y: i * MAX_VIS_DIM, w: MAX_VIS_DIM, h: MAX_VIS_DIM });
      this.lvisUploaded[i] = light.visVersion[i];
    }
  }

  /** @param {any} p the WgCellPipeline (_light/_cam/_world/_rasterPass/rt/cols/rows) @param {any} t its targets */
  run(p, t) {
    const d = this.device, lu = this.lu, li = this.li;
    if (p._world) this._ensureWorld(p._world); else this.li[W_STRUCT_COUNT] = 0; // no world (`?gpucompare=shade` upload source): the 1x1 dummy atlases stay bound
    this._uploadLight(p._light);
    const cb = this._camBasis(p._cam || NO_CAM, p.cols, p.rows, p.rt);
    li[W_GRID_COLS] = p.cols; li[W_GRID_ROWS] = p.rows;
    lu[W_POSX] = cb.posX; lu[W_POSY] = cb.posY; lu[W_EYEH] = cb.eyeH;
    lu[W_DIRX] = cb.dirX; lu[W_DIRY] = cb.dirY; lu[W_PLANEX] = cb.planeX; lu[W_PLANEY] = cb.planeY;
    lu[W_HORIZON] = cb.horizonRow; lu[W_PLANEDY] = cb.planeDistY;
    const rp = p._rasterPass, pitched = !!(rp && rp.pitched);
    li[W_PROJ_MODE] = pitched ? 1 : 0;
    if (pitched) {
      const q = rp.pitch;
      lu[W_PITCH_A] = q.fX; lu[W_PITCH_A + 1] = q.fY; lu[W_PITCH_A + 2] = q.fZ; lu[W_PITCH_A + 3] = q.tanHalfX;
      lu[W_PITCH_B] = q.rX; lu[W_PITCH_B + 1] = q.rY; lu[W_PITCH_B + 2] = q.uX; lu[W_PITCH_B + 3] = q.uY;
      lu[W_PITCH_C] = q.uZ; lu[W_PITCH_C + 1] = q.tanHalfY; lu[W_PITCH_C + 2] = q.cosP; lu[W_PITCH_C + 3] = q.sinP;
    }
    const tx = this.tex;
    tx[0].texture = t.texGI; tx[1].texture = t.texGA; tx[2].texture = t.texDepth; tx[3].texture = this.texLVis;
    tx[4].texture = this.texGeom; tx[5].texture = this.texFlags; tx[6].texture = this.texSunDummy;
    d.beginPass(t.targetLight);
    d.bind(this.pipe, this.bindDesc);
    d.draw(3);
    d.endPass();
  }

  dispose() {
    const d = this.device;
    for (const k of ['pipe', 'texLVis', 'texSunDummy', 'texGeom', 'texFlags']) {
      if (this[k]) { try { d.dispose(this[k]); } catch (_) { /* best effort */ } this[k] = null; }
    }
  }
}
