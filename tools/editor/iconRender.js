// OWN-REQ-014: one detached Canvas2D engine, using the real mesh CPU twin.
import { createEngine, World, HFOV_DEG, createPitchedTerms, pitchedTerms, worldToCell, KIND_MODEL } from '../../engine/index.js';
import { createFrame } from './frame.js';
import { modelBounds, fitIconCamera, iconCacheKey, iconModel, kindBounds } from './iconFit.js';

export function createIconWorld(assets, key = null) {
  const source = key === null ? {} : assets.model(key), model = iconModel(source);
  const voxel = model.voxel, anchor = voxel ? voxel.anchor : null;
  const level = { name: '__icon', start: { x: 3, y: 3 },
    rows: ['......', '......', '......', '......', '......', '......'],
    legend: { '.': { solid: false, floorH: 0, floorMat: 'floor', ceilH: 'sky', ceilMat: 'sky', wallMat: 'stone' } },
    props: key === null ? [] : [{ id: 'icon', model: key, facing: 180, ...(source !== model ? { variant: 0 } : {}),
      x: 3 - (anchor ? (anchor[0] - voxel.size[0] / 2) * voxel.cellM : 0),
      y: 3 - (anchor ? (anchor[1] - voxel.size[1] / 2) * voxel.cellM : 0),
      z: anchor ? anchor[2] * voxel.cellM : 0 }] };
  // Registry facade keeps the in-memory sector out of the editor's asset library.
  const miniAssets = { palette: assets.palette, level: () => level,
    model: name => assets.model(name), has: (kind, name) => kind === 'level' || assets.has(kind, name),
    keys: kind => assets.keys(kind) };
  const world = World.load({ terrain: null, structures: [{ id: 'icon', level: '__icon',
    origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }], entities: [] }, miniAssets, {});
  // The gameplay no-terrain default is a solid outside wall; preview lighting
  // and sector queries instead see the same open floor beyond this tiny sector.
  const open = world.structures[0].level.sectorAt(3, 3);
  world.outsideSector = () => open;
  world.structures[0].level.outsideSector = () => open;
  return world;
}

export function createIconRenderer(assets) {
  const canvas = document.createElement('canvas');
  const engine = createEngine({ canvas, assets, cols: 160, gpu: false, force2d: true,
    inputTarget: document.createElement('div') });
  const rt = engine.renderTarget;
  const frame = createFrame({ engine, assets, rt, gpuParam: false, renderer: 'mesh', cpuMesh: true });
  const boundModels = new Map(assets.keys('model').map(key => [key, iconCacheKey(key, assets.model(key))]));
  const output = document.createElement('canvas');
  output.width = output.height = 96;
  const ctx = output.getContext('2d');
  const terms = createPitchedTerms(), cell = new Float64Array(3);
  let rendered = 0;
  let warmed = false, sceneWarmed = false;
  return {
    engine, frame,
    get warmed() { return warmed; },
    get sceneWarmed() { return sceneWarmed; },
    get rendered() { return rendered; },
    warmup() {
      if (warmed) return;
      engine.ui.clear();
      // Canvas2D caches printable ASCII masks lazily; prepare them before the first scene.
      for (let code = 32; code <= 126; code++) rt.setCell(code - 32, 0, String.fromCharCode(code), '#ffffff', '#101418');
      rt.present();
      warmed = true;
    },
    warmupScene() {
      if (sceneWarmed) return;
      const world = createIconWorld(assets);
      const cam = fitIconCamera({ w: 1, d: 1, h: 1 }, HFOV_DEG, rt.cols * rt.pxCellW / (rt.rows * rt.pxCellH));
      cam.x += 3; cam.y += 3;
      engine.setWorld(world);
      frame.markDirty();
      frame.step(world, cam, { animate: false, dt: 0 });
      sceneWarmed = true;
    },
    renderIcon(key) {
      const model = assets.model(key), bounds = modelBounds(model);
      const world = createIconWorld(assets, key);
      const hash = iconCacheKey(key, model);
      if (boundModels.get(key) !== hash || boundModels.size !== assets.keys('model').length) {
        frame.voxelPool.bind(assets, frame.fb.matTable);
        boundModels.clear();
        for (const name of assets.keys('model')) boundModels.set(name, iconCacheKey(name, assets.model(name)));
      }
      engine.setWorld(world);
      const cam = fitIconCamera(bounds, HFOV_DEG, rt.cols * rt.pxCellW / (rt.rows * rt.pxCellH));
      cam.x += 3; cam.y += 3;
      frame.markDirty();
      frame.step(world, cam, { animate: false, dt: 0 });
      pitchedTerms(cam, rt, terms);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const x of [-bounds.w / 2, bounds.w / 2]) for (const y of [-bounds.d / 2, bounds.d / 2]) for (const z of [0, bounds.h]) {
        worldToCell(terms, x + 3, y + 3, z, cell);
        x0 = Math.min(x0, cell[0]); x1 = Math.max(x1, cell[0]);
        y0 = Math.min(y0, cell[1]); y1 = Math.max(y1, cell[1]);
      }
      // Model cells (kind 8): blank every other cell (floor, walls, sky) and crop to the model's own cells.
      const gbuf = frame.fb.gbuf;
      const own = gbuf.cols === rt.cols && gbuf.rows === rt.rows
        ? kindBounds(gbuf.kind, rt.cols, rt.rows, KIND_MODEL) : null;
      if (own) {
        const g = canvas.getContext('2d');
        g.fillStyle = '#101418';
        for (let r = 0; r < rt.rows; r++) for (let c = 0; c < rt.cols; c++) {
          if (gbuf.kind[r * rt.cols + c] !== KIND_MODEL) g.fillRect(c * rt.pxCellW, r * rt.pxCellH, rt.pxCellW, rt.pxCellH);
        }
        x0 = own.x0; y0 = own.y0; x1 = own.x1; y1 = own.y1;
      }
      // Two-cell padding includes edge glyphs at the projected bounds.
      const sx = Math.max(0, Math.floor(x0 - 2) * rt.pxCellW);
      const sy = Math.max(0, Math.floor(y0 - 2) * rt.pxCellH);
      const sw = Math.min(canvas.width - sx, Math.ceil(x1 + 3) * rt.pxCellW - sx);
      const sh = Math.min(canvas.height - sy, Math.ceil(y1 + 3) * rt.pxCellH - sy);
      const scale = 96 / Math.max(sw, sh);
      ctx.fillStyle = '#101418'; ctx.fillRect(0, 0, 96, 96);
      // The icon scene is lit like a dim interior; lift it so small props read (owner 2026-10-04: "too dark").
      ctx.filter = 'brightness(1.9) contrast(1.1)';
      ctx.drawImage(canvas, sx, sy, sw, sh, (96 - sw * scale) / 2, (96 - sh * scale) / 2, sw * scale, sh * scale);
      ctx.filter = 'none';
      rendered++;
      return output.toDataURL('image/png');
    },
  };
}
