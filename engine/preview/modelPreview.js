// engine/preview/modelPreview.js (EQ-04a, docs/architecture.md 38.40): a private CPU mini-stage that renders one model lit
// (3 static point lights, closed room) and copies its cells into the UI layer. No GPU pass, no second GL context.
// Imports only core/engine, render/frameRenderer (+ pure render helpers) and world/World. Never touches the host registry.
import { createEngine } from '../core/engine.js';
import { createFrameRenderer } from '../render/frameRenderer.js';
import { KIND_MODEL } from '../render/GBuffer.js';
import { World } from '../world/World.js';
import { fitPreviewCamera } from './fitCamera.js';

export { fitPreviewCamera } from './fitCamera.js';

const ROOM = 12;            // metres; the camera sits ~2-5 m in front of the centre, inside the room
const CX = ROOM / 2, CY = ROOM / 2;
const MIN_PERIOD = 0.05;    // 20 Hz cap (and the 50 ms clip step)
const PRESET_KEY = 'previewKey', PRESET_FILL = 'previewFill', PRESET_RIM = 'previewRim';

/** Default 3-point rig around the subject: key warm front-left 45 deg up, fill cool front-right, rim behind. */
export const DEFAULT_LIGHTS = Object.freeze([
  { id: 'key', preset: PRESET_KEY, x: CX - 2, y: CY + 2, z: 2.6 },
  { id: 'fill', preset: PRESET_FILL, x: CX + 2.5, y: CY + 2, z: 1.4 },
  { id: 'rim', preset: PRESET_RIM, x: CX, y: CY - 2.2, z: 2.2 },
]);

function previewPalette(p) {
  const lights = { ...p.lights,
    ambient: { ...p.lights.ambient, intensity: 0.3 },
    sun: { ...p.lights.sun, intensity: 0 }, // closed room: the preview is lit by its own lights only
    [PRESET_KEY]: { color: 'torch', intensity: 1.0, type: 'point', radius: 9, falloff: 'smooth' },
    [PRESET_FILL]: { color: 'aether', intensity: 0.5, type: 'point', radius: 10, falloff: 'smooth' },
    [PRESET_RIM]: { color: 'lantern', intensity: 0.7, type: 'point', radius: 8, falloff: 'smooth' } };
  return { ...p, lights };
}

function boundsOf(def) {
  const v = def.voxel, m = v.cellM * (def.scale || 1);
  return { w: v.size[0] * m, d: v.size[1] * m, h: v.size[2] * m };
}

/**
 * @param {Object} baseAssets host AssetRegistry (palette, detailPass); only read
 * @param {{lights?:Array, bg?:number[], canvas?:Object, inputTarget?:Object, cols?:number}} [opts]
 */
export function createModelPreview(baseAssets, opts = {}) {
  const models = new Map(); // PRIVATE registry: key -> def
  const level = { name: '__preview', start: { x: CX, y: CY },
    rows: Array.from({ length: ROOM }, () => '.'.repeat(ROOM)),
    legend: { '.': { solid: false, floorH: 0, ceilH: 4, floorMat: 'floor', ceilMat: 'ceiling_timber', wallMat: 'stone' } },
    lights: (opts.lights || DEFAULT_LIGHTS).map(l => ({ ...l })) };
  const facade = Object.create(baseAssets);
  Object.defineProperty(facade, 'palette', { value: previewPalette(baseAssets.palette), enumerable: true });
  facade.level = (name) => (name === '__preview' ? level : baseAssets.level(name));
  facade.has = (kind, key) => (kind === 'model' ? models.has(key) : kind === 'level' && key === '__preview' ? true : baseAssets.has(kind, key));
  facade.model = (key) => models.get(key);
  facade.keys = (kind) => (kind === 'model' ? Array.from(models.keys()) : baseAssets.keys(kind));

  const canvas = opts.canvas || document.createElement('canvas');
  const engine = createEngine({ canvas, assets: facade, cols: opts.cols || 160, gpu: false, force2d: true,
    inputTarget: opts.inputTarget || document.createElement('div') });
  const rt = engine.renderTarget;
  const frame = createFrameRenderer({ engine, rt, pipeline: null, assets: facade, idleSkip: true });
  frame.fb.skipSky = true; // only KIND_MODEL cells are copied: no sky shading (about 1 ms)
  const bg = opts.bg || [16, 20, 24];

  let world = null, subject = null, subjectKey = null, def = null, cam = null, bounds = null;
  let version = 0, drawnVersion = -1, drawnStep = -1, drawnRw = -1, drawnRh = -1;
  // Doubles live in a typed array (a double in a closure variable boxes a HeapNumber on every store): [acc, clipT, drawnYaw]
  const T = new Float64Array(3); T[2] = NaN;
  const stepOpts = { animate: false, dt: 0, present: false }; // reused: step() reads it synchronously
  let hasClip = false, disposed = false, rendered = 0;

  function ensureWorld() {
    if (world) return;
    const w = World.load({ terrain: null, structures: [{ id: 'preview', level: '__preview', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }], entities: [] }, facade, {});
    engine.setWorld(w);
    world = w;
    if (frame.lightSet) frame.lightSet.setSun({ elevation: 60, azimuth: 0, on: false }); // no sun walk per cell (closed room)
  }

  // Copies the centred rect of the stage into the UI layer: model cells keep glyph + colours, everything else = panel bg.
  function copyCells(ui, rect) {
    const cells = rt.cells || rt, gk = frame.fb.gbuf.kind, cols = rt.cols;
    const sx = (cols - rect.w) >> 1, sy = (rt.rows - rect.h) >> 1;
    const gi = cells.glyphIdx, fg = cells.fg, bgb = cells.bg;
    const br = bg[0], bgG = bg[1], bb = bg[2];
    for (let r = 0; r < rect.h; r++) {
      const row = (sy + r) * cols + sx;
      for (let c = 0; c < rect.w; c++) {
        const i = row + c;
        if (gk[i] === KIND_MODEL) {
          const j = i * 4;
          ui.setCellRGB(rect.x + c, rect.y + r, gi[i], fg[j], fg[j + 1], fg[j + 2], bgb[j], bgb[j + 1], bgb[j + 2]);
        } else ui.setCellRGB(rect.x + c, rect.y + r, 0, 255, 255, 255, br, bgG, bb);
      }
    }
  }

  return {
    engine, frame,
    get version() { return version; },
    get rendered() { return rendered; },
    /** Adds/replaces `key` in the private registry and rebinds the private pool (<= 10 ms; only these models are packed). */
    setModel(key, newDef) {
      if (disposed) return;
      ensureWorld();
      models.set(key, newDef);
      def = newDef; bounds = boundsOf(newDef);
      if (subject && subjectKey !== key) { subject.remove(); subject = null; }
      frame.refreshAssets(facade);
      if (!subject) {
        subject = world.spawn('prop', { x: CX, y: CY, z: 0, yawDeg: 180 }, { voxel: { model: key } }, 'subject');
        subjectKey = key;
      }
      hasClip = !!(def.voxel.animations && def.voxel.animations.idle);
      if (hasClip) subject.play('idle', { loop: true });
      cam = null; T[1] = 0; version++;
    },
    /**
     * Re-renders the stage only when yaw / model version / 50 ms clip step / rect changed (20 Hz cap), then ALWAYS copies the
     * stage cells into `ui` (the host clears its UI layer per frame). Returns true when the stage was re-rendered.
     * @param {{yawDeg:number}} subj @param {{x:number,y:number,w:number,h:number}} rect UI cells (reused by the caller)
     */
    render(subj, dtSec, ui, rect) {
      if (disposed || !subject) return false;
      T[0] += dtSec; T[1] += dtSec;
      const yaw = subj.yawDeg;
      const step = hasClip ? (T[1] * 20) | 0 : 0;
      let did = false;
      const changed = version !== drawnVersion || yaw !== T[2] || step !== drawnStep || rect.w !== drawnRw || rect.h !== drawnRh;
      if (changed && (T[0] >= MIN_PERIOD || version !== drawnVersion)) { // new model: immediate; otherwise 20 Hz
        if (!cam || rect.w !== drawnRw || rect.h !== drawnRh) cam = fitPreviewCamera(bounds, rect, rt, { x: CX, y: CY });
        subject.data.transform.yawDeg = yaw;
        world.renderVersion++;
        frame.markDirty();
        stepOpts.animate = hasClip; stepOpts.dt = T[0];
        frame.step(world, cam, stepOpts);
        drawnVersion = version; T[2] = yaw; drawnStep = step; drawnRw = rect.w; drawnRh = rect.h; T[0] = 0;
        rendered++; did = true;
      }
      copyCells(ui, rect);
      return did;
    },
    dispose() { if (disposed) return; disposed = true; frame.dispose(); world = null; subject = null; models.clear(); },
  };
}
