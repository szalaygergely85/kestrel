// WG-2a: WgCellPipeline + targets.js on the Node mock device. node engine/render/gpu/wg/WgCellPipeline.test.js
import assert from 'node:assert';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { WgCellPipeline, PASS_NAMES } from './WgCellPipeline.js';
import { allocWgTargets, freeWgTargets } from './targets.js';
import { DEBUG_BLOCK } from '../wgsl/debug.wgsl.js';
import { SHADE_BLOCK } from '../wgsl/shade.wgsl.js';
import { EDGE_BLOCK } from '../wgsl/edge.wgsl.js';
import { LIGHT_BLOCK } from '../wgsl/light.wgsl.js';
import { createPitchedTerms, pitchedTerms } from '../../projection.js';
import { bindShading, bindLevel } from '../../MaterialTable.js';
import { MAT_F_WIDTH, SET_I_WIDTH } from '../ShadeTextures.js';
import { loadLevel } from '../../../world/Level.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import paletteModule from '../../../../design/palette.js';
import detailPassModule from '../../../../design/detail-pass.js';

const { device, liveCount } = makeMockGpuDevice();
device.backend = 'webgpu';
let drawn = 0; const passes = [];
device.beginPass = (t, o) => { passes.push({ t, o }); };
device.draw = () => { drawn++; };
const fgTex = device.createTexture({ format: 'rgba8', width: 160, height: 60 });
const bgTex = device.createTexture({ format: 'rgba8', width: 160, height: 60 });
let hook = null;
const rt = { device, cols: 160, rows: 60, fgTex, bgTex, setCellPass(f) { hook = f; } };

// targets: 2x rgba32uint + r32uint + depth24, sub-sample sized
const t0 = allocWgTargets(device, 10, 5, 2);
assert.deepStrictEqual([t0.texSGI.desc.format, t0.texSGA.desc.format, t0.texSDepth.desc.format, t0.texRasterDepth.desc.format], ['rgba32ui', 'rgba32ui', 'r32ui', 'depth24']);
assert.deepStrictEqual([t0.texSGI.desc.width, t0.texSGI.desc.height], [20, 10]);
assert.deepStrictEqual([t0.texGI, t0.texGA, t0.texGD].map(x => [x.desc.format, x.desc.width, x.desc.height]), [['rgba32ui', 10, 5], ['rgba32ui', 10, 5], ['rgba32ui', 10, 5]], 'cell-res set (WG-3a)');
assert.deepStrictEqual([t0.texDepth.desc.format, t0.texDepth.desc.width, t0.texMask.desc.format], ['r32ui', 10, 'r8ui']);
assert.deepStrictEqual(t0.targetResolve.desc.color, [t0.texGI, t0.texGA, t0.texDepth]);
assert.deepStrictEqual(t0.targetDeriv.desc.color, [t0.texGD]);
assert.deepStrictEqual(t0.targetRaster.desc.color, [t0.texSGI, t0.texSGA, t0.texSDepth]);
assert.strictEqual(t0.targetRaster.desc.color.length, 3);
assert.strictEqual(t0.targetRaster.desc.depth, t0.texRasterDepth);
const before = liveCount();
freeWgTargets(device, t0);
assert.strictEqual(liveCount(), before - 21, 'free disposes 14 textures + 7 targets');
// alloc failure frees the partial set
{
  let n = 0; const orig = device.createTexture;
  device.createTexture = (d) => { if (++n === 3) throw new Error('oom'); return orig(d); };
  const live0 = liveCount();
  assert.throws(() => allocWgTargets(device, 4, 4, 1), /oom/);
  device.createTexture = orig;
  assert.strictEqual(liveCount(), live0, 'partial alloc freed');
}

// surface (38.1)
const p = new WgCellPipeline(rt, { rays: 2 });
assert.strictEqual(p.ready, true);
const SURFACE = ['frame', 'bind', 'bindVoxels', 'bindViewModel', 'bindInstances', 'resizeGrid', 'setEnabled', 'setPassTiming', 'setDebugMode', 'readbackGeometry', 'readbackLight', 'readbackWater', 'readbackShadowDepthBits', 'readback', 'dispose'];
for (const m of SURFACE) {
  assert.strictEqual(typeof p[m], 'function', m);
}
assert.strictEqual(p.stats.passMsP50.length, PASS_NAMES.length);
assert.deepStrictEqual(p.portedPasses, ['debug', 'raster', 'resolve', 'deriv', 'light', 'shade', 'edge', 'shadow', 'water']); // WG-3d/3e: default sun mode = map
assert.strictEqual(p.frameComplete, false, 'honest: no scene yet');
assert.strictEqual(typeof hook, 'function', 'cell-pass hook installed');
assert.strictEqual(rt.gpuActive, undefined, 'never takes over the CPU shading');

// stubs are safe
p.bind({}, {}); p.bindVoxels({}); p.bindViewModel({}); p.bindInstances({}); p.setPassTiming(true); p.frame(null, null, null, null); p.setWaterLooks([]);
{ const rl = await p.readbackLight(); assert.strictEqual(rl.length, 4 * p.cols * p.rows, 'readbackLight is cols*rows 4-wide'); }
assert.strictEqual(await p.readbackWater(), null);

// 38.10a: bindInstances(groups) with a different groups object releases both cull passes' batches (not the idle sweep).
{
  const rCull = p._rasterPass && p._rasterPass.cull, sCull = p._shadowPass && p._shadowPass.cull;
  assert.ok(rCull && sCull, 'cull passes created on the mock device (createComputePipeline present)');
  let rCalls = 0, sCalls = 0;
  const origR = rCull.releaseAll.bind(rCull), origS = sCull.releaseAll.bind(sCull);
  rCull.releaseAll = () => { rCalls++; origR(); };
  sCull.releaseAll = () => { sCalls++; origS(); };
  const groupsA = {}, groupsB = {};
  p.bindInstances(groupsA); // differs from the {} bound just above -> releases
  assert.strictEqual(rCalls, 1); assert.strictEqual(sCalls, 1);
  p.bindInstances(groupsA); // same object: no release
  assert.strictEqual(rCalls, 1); assert.strictEqual(sCalls, 1);
  p.bindInstances(groupsB); // a different object again: releases
  assert.strictEqual(rCalls, 2); assert.strictEqual(sCalls, 2);
  rCull.releaseAll = origR; sCull.releaseAll = origS;
}

// hook: debug off = raster clear + resolve + deriv (2 draws); with a mode: + one debug pass
hook(); assert.strictEqual(drawn, 2); assert.deepStrictEqual(passes.map(x => x.t), [p._t.targetRaster, p._t.targetResolve, p._t.targetDeriv]);
drawn = 0; passes.length = 0;
p.setDebugMode(0); hook();
assert.strictEqual(drawn, 3); assert.strictEqual(passes.length, 4);
assert.strictEqual(passes[0].t, p._t.targetRaster); assert.deepStrictEqual(passes[0].o, { clear: true });
hook(); assert.strictEqual(passes.length, 8, 'G-buffer cleared each frame');
{
  const pd = p._cellPass;
  assert.deepStrictEqual(pd.rTex.map(x => x.texture), [p._t.texSGI, p._t.texSGA, p._t.texSDepth, p._t.texMask]);
  assert.deepStrictEqual(pd.dTex.map(x => x.texture), [p._t.texGI, p._t.texGA, p._t.texDepth]);
  assert.strictEqual(pd.ri[0], 2, 'resolve n = rays');
  assert.deepStrictEqual([pd.di[0], pd.di[1]], [160, 60]);
  assert.ok(pd.du[2] > 0 && pd.du[3] > 0, 'deriv tanHalfHFov / planeDistY');
}
const lastBind = device._lastBind;
assert.strictEqual(lastBind.uniforms[1], 2, 'rays uniform');
assert.strictEqual(lastBind.textures.length, 3);
assert.deepStrictEqual(lastBind.textures.map((entry) => entry.texture), [p._t.texSGI, p._t.texSGA, p._t.texSDepth]);
{
  const field = DEBUG_BLOCK.field, uniforms = p._debugU, bind = p._debugBind, textures = p._debugTex;
  const created = liveCount();
  DEBUG_BLOCK.field = () => { throw new Error('per-frame field lookup'); };
  try { for (let i = 0; i < 1000; i++) { p.setDebugMode(i % 4); hook(); } }
  finally { DEBUG_BLOCK.field = field; }
  assert.strictEqual(p._debugU, uniforms); assert.strictEqual(p._debugBind, bind); assert.strictEqual(p._debugTex, textures);
  assert.strictEqual(liveCount(), created, 'warm debug hook creates no resources');
  assert.deepStrictEqual([...uniforms].slice(0, 3), [3, 2, Math.fround(0.05)]);
}

// WG-3b: light pass (fake world: no structures; ambient-only light array, then a LightSet-shaped object with the sun on)
{
  const lp = p._cellPass.lightPass, t = p._t;
  const world = { structures: [], structVersion: 1 };
  const cam = { x: 1, y: 2, z: 1.5, yawDeg: 90, pitchDeg: 0 };
  const host = { _world: world, _light: [0.1, 0.2, 0.3], _cam: cam, cols: p.cols, rows: p.rows, rt, _rasterPass: null };
  passes.length = 0; drawn = 0;
  lp.run(host, t);
  assert.deepStrictEqual(passes.map(x => x.t), [t.targetLight]); assert.strictEqual(drawn, 1);
  assert.strictEqual(device._lastBind.textures.length, 7);
  assert.strictEqual(device._lastBind.textures[6].texture, lp.texSunDummy, 'dummy depth bound until WG-3d');
  assert.strictEqual(device._lastBind.uniforms[0].toFixed(2), '0.10');
  const made = liveCount();
  const ls = { pos: new Float32Array(32), col: new Float32Array(32), count: 1, ambient: [0.5, 0.5, 0.5], sun: { on: true, dir: [0, 0, 1], col: [1, 1, 1] },
    visOx: new Float32Array(8), visOy: new Float32Array(8), visW: new Float32Array(8).fill(33), visH: new Float32Array(8).fill(33),
    visVersion: new Int32Array(8), vis: new Uint8Array(8 * 33 * 33) };
  host._light = ls; lp.run(host, t);
  assert.strictEqual(lp.texLVis._texWrites, 1, 'dirty LVIS slot uploaded once');
  lp.run(host, t); assert.strictEqual(lp.texLVis._texWrites, 1, 'unchanged LVIS slot not re-uploaded');
  assert.strictEqual(liveCount(), made, 'warm light pass creates no resources');
  // US-068b2 (38.19): ortho -> projMode 2 + halfW/halfH in the pitch tanHalf slots; pitched 1 with the perspective tanHalf; shear 0
  {
    const oc = { ...cam, pitchDeg: -35.264, yawDeg: 45, projection: 'ortho', orthoHalfH: 8, focusX: 1, focusY: 2, focusZ: 0 };
    const terms = createPitchedTerms(), W = (n) => LIGHT_BLOCK.field(n).word;
    for (const [mode, c] of [[2, oc], [1, { ...cam, pitchDeg: -20, projection: 'pitched' }], [0, cam]]) {
      if (mode) pitchedTerms(c, { cols: p.cols, rows: p.rows, pxCellW: 1, pxCellH: 2 }, terms);
      host._rasterPass = mode ? { pitched: true, ortho: mode === 2, pitch: terms } : null;
      lp.run(host, t);
      assert.strictEqual(lp.li[W('projMode')], mode);
      if (mode === 2) { assert.strictEqual(lp.lu[W('pitchA') + 3], Math.fround(terms.halfW)); assert.strictEqual(lp.lu[W('pitchC') + 1], 8); }
      if (mode === 1) assert.strictEqual(lp.lu[W('pitchA') + 3], Math.fround(terms.tanHalfX));
    }
    host._rasterPass = null;
  }
}


// WG-3c: shade + edge (real content table; fake host without a world: the source-agnostic part of the pass)
{
  const palette = paletteModule.default || paletteModule, detailPass = detailPassModule.default || detailPassModule;
  const { bundle } = await loadTestAssets();
  const table = bindShading(palette, detailPass, 16 / 9);
  bindLevel(table, loadLevel(bundle.levels.test_room));
  const sp = p._cellPass.shadePass, t = p._t;
  const host = { rt, _fb: { timeSec: 2.5 }, _cam: null, _world: null, _source: 'scene', _table: null, _palette: palette, rays: 1, cols: p.cols, rows: p.rows, _rasterPass: null };
  passes.length = 0; drawn = 0;
  assert.strictEqual(sp.run(host, t, null), false, 'no table bound: nothing runs');
  assert.strictEqual(drawn, 0);
  p.bind(table, palette); host._table = table;
  assert.strictEqual(sp.run(host, t, null), true);
  assert.deepStrictEqual(passes.map(x => x.t), [t.targetShade, t.targetFinal]); assert.strictEqual(drawn, 2);
  assert.strictEqual(sp.stats.tableUploads, 1); assert.strictEqual(sp.stats.skyBakes, 1);
  assert.deepStrictEqual([sp.texMatF.desc.width, sp.texMatF.desc.height], [MAT_F_WIDTH, table.records.length]);
  assert.strictEqual(sp.texSetI.desc.width, SET_I_WIDTH);
  assert.strictEqual(sp.texTlook.desc.width, 1, 'no terrain: TLOOK stays a 1x1 placeholder');
  // shade binds: 16 textures, GI first, LIGHT 14 = texLight, CPU layer = rt.fgTex/bgTex; edge: 6 with the dummy WATER + MAT_I (ALPHA-01d)
  const shBind = sp.shTex.map(x => x.texture);
  assert.strictEqual(shBind.length, 16); assert.strictEqual(shBind[0], t.texGI); assert.strictEqual(shBind[6], rt.fgTex); assert.strictEqual(shBind[14], t.texLight);
  assert.deepStrictEqual(sp.edTex.map(x => x.texture), [t.texGI, t.texDepth, t.texShadeFg, t.texShadeBg, sp.texWaterDummy, sp.texMatI]);
  const U = table.fog;
  assert.strictEqual(sp.su[SHADE_BLOCK.field('fogStart').word], Math.fround(U.start));
  assert.strictEqual(sp.su[SHADE_BLOCK.field('timeSec').word], 2.5);
  assert.strictEqual(sp.si[SHADE_BLOCK.field('n').word], 1); assert.strictEqual(sp.si[SHADE_BLOCK.field('gpuSky')?.word ?? 0], 0, 'no cam/world: passthrough sky');
  for (let f = 1; f <= 6; f++) assert.strictEqual(sp.su[SHADE_BLOCK.field('faceK').word + f], Math.fround(table.faceK[f]));
  assert.strictEqual(sp.eu[EDGE_BLOCK.field('edgeGlyph').word], detailPass.edges.rules.cap.glyph.charCodeAt(0) - 32);
  assert.strictEqual(sp.ei[EDGE_BLOCK.field('waterOn').word], 0); assert.strictEqual(sp.ei[EDGE_BLOCK.field('gridCols').word], p.cols);
  // warm frame: no re-pack, no sky bake, no new resources, no writes
  const made = liveCount(), w0 = sp.texMatF._texWrites;
  host._fb.timeSec = 3; sp.run(host, t, null); sp.run(host, t, null);
  assert.strictEqual(sp.stats.tableUploads, 1); assert.strictEqual(sp.stats.skyBakes, 1); assert.strictEqual(sp.texMatF._texWrites, w0);
  assert.strictEqual(liveCount(), made, 'warm shade pass creates no resources');
  // US-068b2 (38.19): ortho -> shade/edge projMode 2, fixed positive hashCell, halfH in the pitchC tanHalfY slot; pitched keeps -k
  {
    const terms = createPitchedTerms(), g = { cols: p.cols, rows: p.rows, pxCellW: 1, pxCellH: 2 };
    const base = { x: 1, y: 2, z: 1.5, yawDeg: 45, pitchDeg: -35.264 };
    const h = { ...host, _cam: base, _world: { structures: [], structVersion: 1 } };
    for (const [mode, c] of [[2, { ...base, projection: 'ortho', orthoHalfH: 8, focusX: 1, focusY: 2, focusZ: 0 }], [1, { ...base, projection: 'pitched' }]]) {
      pitchedTerms(c, g, terms);
      h._rasterPass = { pitched: true, ortho: mode === 2, pitch: terms };
      sp.run(h, t, null);
      assert.strictEqual(sp.si[SHADE_BLOCK.field('projMode').word], mode); assert.strictEqual(sp.ei[EDGE_BLOCK.field('projMode').word], mode);
      const hc = sp.su[SHADE_BLOCK.field('hashCell').word];
      if (mode === 2) { assert.ok(hc > 0); assert.strictEqual(sp.eu[EDGE_BLOCK.field('pitchC').word + 1], 8); } else assert.ok(hc < 0);
    }
  }
  // palette time-of-day change re-bakes the sky only; a new table re-uploads
  const t0 = palette.defaultTime, other = Object.keys(palette.timeOfDay).find(k => k !== t0);
  if (other) { palette.defaultTime = other; sp.run(host, t, null); palette.defaultTime = t0; assert.strictEqual(sp.stats.skyBakes, 2); assert.strictEqual(sp.stats.tableUploads, 1); }
  host._table = { ...table }; sp.run(host, t, null); assert.strictEqual(sp.stats.tableUploads, 2);
  // pipeline-level: readbackCells is null until a frame shaded, then reads the FINAL textures
  assert.strictEqual(await p.readbackCells(), null);
  p._cellsShaded = true; const seen = [];
  device.readback = (tex) => { seen.push(tex); };
  await p.readbackCells(); assert.deepStrictEqual(seen, [t.texFinalFg, t.texFinalBg]);
  p._cellsShaded = false;
}

// resizeGrid reallocates, frees old
const oldGI = p._t.texSGI;
p.resizeGrid(20, 10);
assert.notStrictEqual(p._t.texSGI, oldGI); assert.strictEqual(oldGI._disposed, true);
assert.deepStrictEqual([p._t.texSGI.desc.width, p.cols, p.rows], [40, 20, 10]);
const beforeResizeHook = passes.length;
hook(); assert.strictEqual(passes.length, beforeResizeHook + 4, 'cleared again after resize');
// successful resize drains the error scopes once (38.8a 23a/24a) and warns on errors
{
  let drained = 0; const hadCE = device.checkErrors; const w = console.warn; const warns = [];
  device.checkErrors = () => { drained++; return Promise.resolve(['bad']); };
  console.warn = (...a) => warns.push(a.join(' '));
  p.resizeGrid(20, 10);
  await Promise.resolve(); await Promise.resolve();
  console.warn = w; device.checkErrors = hadCE;
  assert.strictEqual(drained, 1, 'checkErrors drained once per good resize'); assert.ok(warns.some((m) => /validation errors/.test(m)));
}
// failed resize keeps the old set but disables the pipeline (rt/pipeline grids must not diverge)
{
  const keep = p._t; const orig = device.createTexture; let drained = 0; const hadCE = device.checkErrors;
  device.checkErrors = () => { drained++; return Promise.resolve([]); };
  device.createTexture = () => { throw new Error('oom'); };
  const w = console.warn; const warns = []; console.warn = (...a) => warns.push(a.join(' '));
  p.resizeGrid(99, 99);
  console.warn = w; device.createTexture = orig; device.checkErrors = hadCE;
  assert.strictEqual(p._t, keep); assert.strictEqual(p.ready, false); assert.strictEqual(p.cols, 20); assert.strictEqual(hook, null, 'setEnabled(false) removed the hook');
  assert.strictEqual(warns.length, 1); assert.strictEqual(drained, 0);
  p.ready = true; p.setEnabled(true); // restore for the following checks
  assert.ok(hook, 'hook restored');
}

// readbackGeometry: payload shape (4-wide GI/GA/Depth), Depth spread from the 1-wide r32uint
{
  let readCalls = 0;
  device.readback = () => { readCalls++; };
  const g2 = await p.readbackGeometry(); // rays 2 reads the resolved cell-res set
  assert.strictEqual(g2.GI.length, 4 * p.cols * p.rows); assert.strictEqual(readCalls, 3);
  const q = new WgCellPipeline({ ...rt, setCellPass() {} }, { rays: 1 });
  const cells = q.cols * q.rows;
  device.readback = (tex, rect, out) => {
    assert.deepStrictEqual(rect, { x: 0, y: 0, w: q.cols, h: q.rows });
    if (tex === q._t.texDepth) for (let i = 0; i < out.length; i++) out[i] = i + 7; else out.fill(1);
  };
  const g = await q.readbackGeometry();
  assert.strictEqual(g.GI.length, 4 * cells); assert.strictEqual(g.GA.length, 4 * cells); assert.strictEqual(g.Depth.length, 4 * cells);
  assert.strictEqual(g.Depth[4 * 3], 10); assert.strictEqual(g.Depth[4 * 3 + 1], 0); assert.strictEqual(g.GI[5], 1);
  q.resizeGrid(7, 3);
  const small = await q.readbackGeometry();
  assert.strictEqual(small.GI.length, 4 * 21); assert.strictEqual(small.GA.length, 4 * 21); assert.strictEqual(small.Depth.length, 4 * 21);
  q.dispose();
}

// WG-3f: sprites + overlay wiring (bindSprites), frameComplete / rt.gpuActive, presenter override, per-frame fade/dim, resize, dispose
{
  const { MAX_SPRITES, SPR_STRIDE } = await import('../../sprites.js');
  const { createFadeLut } = await import('../../../ui/fade.js');
  const { createSceneDim, resetSceneDim } = await import('../../../ui/sceneDim.js');
  const present = []; let hook2 = null;
  const rt2 = { device, cols: 16, rows: 8, fgTex, bgTex, setCellPass(f) { hook2 = f; }, setPresentCells(f, b) { present.push([f, b]); } };
  const q = new WgCellPipeline(rt2, { rays: 1 });
  assert.strictEqual(q.frameComplete, false); assert.strictEqual(rt2.gpuActive, undefined, 'not complete before bindSprites: gpuActive untouched');
  const pool = { count: 0, spr: new Float32Array(MAX_SPRITES * SPR_STRIDE) };
  const atlas = { width: 4, height: 2, data: new Uint8Array(32), pal: new Float32Array(8) };
  const COLS = 16, ROWS = 8;
  const overlay = { cols: COLS, rows: ROWS, ovl: new Uint8Array(COLS * ROWS * 4), ovlZ: new Float32Array(COLS * ROWS), stats: { cells: 0 }, minRow: 0, maxRow: -1, prevMinRow: 0, prevMaxRow: -1 };
  assert.strictEqual(q.bindSprites({ pool, atlas, palette: {}, particleLayer: null, overlay }), true);
  assert.deepStrictEqual(q.portedPasses.slice(-2), ['sprites', 'overlay']);
  assert.strictEqual(q.frameComplete, true, 'shadow map + water + sprites + overlay wired');
  assert.strictEqual(rt2.gpuActive, true);
  const sp = q._spritesPass, ovp = q._overlayPass;
  assert.deepStrictEqual([sp.cols, sp.rows, ovp.cols, ovp.rows], [COLS, ROWS, COLS, ROWS]);
  assert.strictEqual(ovp._fg, sp.outFg, 'overlay draws into the sprite output');
  // frame(): fade amount + LUT + dim from fb
  const lut = createFadeLut(' .:-=+*#%@', 9, 0.25), dim = createSceneDim(); resetSceneDim(dim); dim.all = 0.7;
  q.frame({ sceneFade: 0.4, fadeLut: lut, sceneDim: dim }, [0, 0, 0], null, null);
  assert.strictEqual(sp.sceneFade, 0.4); assert.strictEqual(sp._lutRef, lut); assert.strictEqual(sp.dimAll, 0.7);
  q.frame({}, [0, 0, 0], null, null); assert.strictEqual(sp.sceneFade, 1, 'no fb.sceneFade = off');
  // hook: nothing shaded (no cam/world) -> sprites do not run, presenter keeps the CPU cells
  present.length = 0; hook2();
  assert.strictEqual(sp.ran, false); assert.deepStrictEqual(present.at(-1), [null, null]);
  // shaded frame, 0 sprites: sprites still run (fade/dim/particles), then overlay skip rules; presenter gets sp.outFg/outBg
  passes.length = 0; drawn = 0;
  q._cellsShaded = true; q._runSprites(q._t);
  assert.strictEqual(sp.ran, true); assert.strictEqual(passes.at(-1).t, sp.target); assert.strictEqual(drawn, 1, 'overlay idle: only the sprite pass');
  assert.deepStrictEqual(present.at(-1), [sp.outFg, sp.outBg]);
  assert.deepStrictEqual(device._lastBind.textures.slice(0, 4).map((x) => x.texture), [q._t.texGI, q._t.texDepth, q._t.texFinalFg, q._t.texFinalBg], 'reads the edge output');
  // overlay cell: draws into the sprite output after sprites
  overlay.stats.cells = 1; overlay.minRow = 2; overlay.maxRow = 2; passes.length = 0; drawn = 0;
  q._runSprites(q._t);
  assert.deepStrictEqual(passes.map((x) => x.t), [sp.target, ovp.target]); assert.strictEqual(drawn, 2);
  // final cell readback is the sprite output
  let rbTex = null; const rb0 = device.readback; device.readback = (tex) => { rbTex = tex; };
  q._spritesRan = true; await q.readbackCells(); assert.strictEqual(rbTex, sp.outBg); device.readback = rb0;
  // debug view or a non-map sun: the CPU cells stay presented
  q.setDebugMode(1); q._runSprites(q._t); assert.deepStrictEqual(present.at(-1), [null, null], 'debug view not covered by the sprite output'); q.setDebugMode(-1);
  // resize recreates the outputs and re-targets the overlay
  const oldOut = sp.outFg; q.resizeGrid(20, 10);
  assert.notStrictEqual(sp.outFg, oldOut); assert.strictEqual(sp.cols, 20); assert.strictEqual(ovp.cols, 20); assert.strictEqual(ovp._fg, sp.outFg);
  // a failing pass disables the pipeline and hands the frame back to the CPU
  const w = console.warn; console.warn = () => {};
  sp.run = () => { throw new Error('boom'); }; q._cellsShaded = true; q._runSprites(q._t);
  console.warn = w;
  assert.strictEqual(q.ready, false); assert.strictEqual(q.frameComplete, false); assert.strictEqual(rt2.gpuActive, false); assert.deepStrictEqual(present.at(-1), [null, null]);
  q.dispose();
  assert.strictEqual(q._spritesPass, null); assert.strictEqual(q._overlayPass, null); assert.strictEqual(sp.pipe, null, 'sprites pass disposed');
  // dda sun (no shadow map on WebGPU) -> never complete, CPU keeps compositing
  const rt3 = { device, cols: 16, rows: 8, fgTex, bgTex, setCellPass() {}, setPresentCells() {} };
  const q3 = new WgCellPipeline(rt3, { rays: 1, shadows: { sun: 'dda' } });
  q3.bindSprites({ pool, atlas, palette: {}, overlay });
  assert.strictEqual(q3.frameComplete, false); assert.notStrictEqual(rt3.gpuActive, true); q3.dispose();
}

// S8-B1-09b: the constructor builds all pipelines in one compile batch; `compiled` resolves to the list, a failed entry disables
{
  const ev = [];
  const fake = { ...device, beginCompileBatch() { ev.push('begin'); }, endCompileBatch() { ev.push('end'); return Promise.resolve([{ label: 'x', ms: 1, ok: true }]); } };
  const q = new WgCellPipeline({ ...rt, device: fake, setCellPass() {} });
  assert.strictEqual(ev.join(), 'begin,end', 'one batch around pass construction');
  assert.strictEqual(q.ready, true);
  assert.deepStrictEqual(await q.compiled, [{ label: 'x', ms: 1, ok: true }]);
  assert.strictEqual(q.ready, true);
  q.dispose();
  const bad = { ...device, beginCompileBatch() {}, endCompileBatch() { return Promise.resolve([{ label: 'broken', ms: 2, ok: false }]); } };
  const w = console.warn; console.warn = () => {};
  const q2 = new WgCellPipeline({ ...rt, device: bad, setCellPass() {} });
  await q2.compiled;
  console.warn = w;
  assert.strictEqual(q2.ready, false, 'an ok:false pipeline disables the pipeline');
  q2.dispose();
}

// dispose
const debugPipeline = p._pipeDebug;
p.dispose();
assert.strictEqual(p.ready, false); assert.strictEqual(hook, null); assert.strictEqual(p._t, null);
assert.strictEqual(debugPipeline._disposed, true); assert.strictEqual(p._pipeDebug, null);
p.resizeGrid(5, 5); p.setEnabled(true); assert.strictEqual(hook, null, 'no re-enable after dispose');
p.dispose(); // idempotent

// init failure -> ready=false, no throw
{
  const bad = { ...rt, device: { ...device, createTexture() { throw new Error('nope'); } }, setCellPass() {} };
  const w = console.warn; console.warn = () => {};
  const q = new WgCellPipeline(bad);
  console.warn = w;
  assert.strictEqual(q.ready, false);
}
console.log('WgCellPipeline.test.js: all checks passed.');
