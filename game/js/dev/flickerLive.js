// AA-01 (docs/architecture.md 38.82): `?flickerlive=1&at=<x,y,0,yaw,pitch>` = measure flicker on the LIVE overworld.
// Per pose: 30 steps of 5 cm strafe + 5 cm forward in a static scene (wind speed 0, fb.timeSec 0, clock frozen by ?at),
// after each step the N vs N-1 frame is compared with flickerStep -> totalPct + colourPct, averaged over the steps.
// main.js calls `beforeRender(cam, world)` before the frame is drawn and `afterPresent()` after rt.present().
import { flickerStep, flickerReprojStep, flickerGlyphReasons, GLYPH_REASONS, M255_KEYS, glyphClassTable, pitchedTerms, createPitchedTerms } from '../../../engine/index.js';

/** AA-10 diag: what the stable pass saw this frame (its own inputs + output + OUT_HIST), read straight from the pipeline; null = stable did not run. */
export async function diagCapture(wg) {
  const t = wg && wg._t, sp = wg && wg._stablePass;
  if (!t || !sp || !wg._stableRan || !sp.outHist || !t.texLevel) return null;
  const n = wg.cols * wg.rows, rect = { x: 0, y: 0, w: wg.cols, h: wg.rows }, dv = wg.device, inp = wg._stInp || {};
  const r = { cols: wg.cols, rows: wg.rows, GI: new Uint32Array(4 * n), GA: new Uint32Array(4 * n), Depth: new Uint32Array(n), level: new Uint8Array(n),
    preFg: new Uint8Array(4 * n), finalBg: new Uint8Array(4 * n), shadeFg: new Uint8Array(4 * n), shadeBg: new Uint8Array(4 * n), outFg: new Uint8Array(4 * n), hist: new Uint32Array(4 * n) };
  const hist = sp.outHist, outFg = sp.outFg; // pin this frame's set before any await
  await dv.readback(hist, rect, r.hist); await dv.readback(outFg, rect, r.outFg);
  await dv.readback(t.texGI, rect, r.GI); await dv.readback(t.texGA, rect, r.GA); await dv.readback(t.texDepth, rect, r.Depth); await dv.readback(t.texLevel, rect, r.level);
  await dv.readback(t.texFinalFg, rect, r.preFg); await dv.readback(t.texFinalBg, rect, r.finalBg);
  await dv.readback(inp.shadeFg || t.texShadeFg, rect, r.shadeFg); await dv.readback(inp.shadeBg || t.texShadeBg, rect, r.shadeBg);
  return r;
}

export const STEP_M = 0.05, STEPS = 30, EYE_H = 1.6;

// Poses (groundEye: z = terrain ground + EYE_H). wallNear = the tower wall pose of the spec; wallFar = 14 m further back
// along the view axis (~20 m); bushes = Burl's bush (world_m1 burlBush 1470.6,1030.9) from 3.6 m; crown / grassFar are
// provisional spots (crown: a big tree 8 m north of the tower wall, looked up at; grassFar: meadow outside the tower, grass carpet + decor,
// looking over grass 10-40 m away) - the main session may retune them.
export const POSES = [
  { slug: 'wallNear', x: 1496.91, y: 1026.06, yawDeg: 333, pitchDeg: 1, groundEye: true },
  { slug: 'wallFar', x: 1503.27, y: 1038.53, yawDeg: 333, pitchDeg: 1, groundEye: true },
  { slug: 'bushes', x: 1474.2, y: 1030.9, yawDeg: 270, pitchDeg: 0, groundEye: true },
  { slug: 'crown', x: 1489.74, y: 1047, yawDeg: 0, pitchDeg: 18, groundEye: true }, // AA-01b: TwistedTree_4 (1489.74,1039.05) 8 m ahead, crown fills the centre
  { slug: 'grassFar', x: 1496, y: 1040, yawDeg: 0, pitchDeg: -5, groundEye: true },
];
// AA-19 (OB-208): the owner's complaint view = WALKING west along the straight road (1130,1068) toward Rook's ruin / the ford (road ahead, bushes + crowns right,
// ruin in the distance), sword view model in hand, 30 steps of 10 cm FORWARD only. Reported separately (poses.roadWalk.*), NOT in avg
// (avg stays over the 5 static poses so it stays comparable with older baselines).
export const ROAD_WALK = { slug: 'roadWalk', x: 1130, y: 1068, yawDeg: 273.5, pitchDeg: -2, groundEye: true, walk: true, sword: true, stepM: 0.1, inAvg: false };
// AA-24 (OB-208): 3 more FORWARD walks, same shape as ROAD_WALK (reported separately). `player: true` = the player body is moved with the camera
// (feet = eye - EYE_H) so streaming, sceneOf (outdoor/interior) and the underground post/ambient see the pose like the owner does; `z` = absolute eye z (underground).
export const FOREST_WALK = { slug: 'forestWalk', x: 1550.75, y: 550.66, yawDeg: 155, pitchDeg: -3, groundEye: true, walk: true, sword: true, stepM: 0.1, inAvg: false, player: true }; // Northwood interior (forestFloor dev pose)
export const TOWN_WALK = { slug: 'townWalk', x: 932, y: 935, yawDeg: 245, pitchDeg: 2, groundEye: true, walk: true, sword: true, stepM: 0.1, inAvg: false, player: true }; // Outwall: from inside the SE gate (Hesk behind) toward the plaza (board, relay, forge + Dorrin)
export const CRYPT_WALK = { slug: 'cryptWalk', x: 1675, y: 1375.5, z: -56.8 + EYE_H, yawDeg: 0, pitchDeg: -2, walk: true, sword: true, stepM: 0.1, inAvg: false, player: true }; // crypt room 1 (floor -56.8) north toward the corridor, torch-lit
export const WALKS_NEW = [FOREST_WALK, TOWN_WALK, CRYPT_WALK];
export const POSES_ALL = [...POSES, ROAD_WALK, ...WALKS_NEW];

/** One 5 cm strafe + 5 cm forward move for a camera with yawDeg (forward = (sin, -cos), right = (cos, sin)). */
export function stepCam(cam, m = STEP_M) {
  const r = cam.yawDeg * Math.PI / 180;
  return { ...cam, x: cam.x + (Math.sin(r) + Math.cos(r)) * m, y: cam.y + (-Math.cos(r) + Math.sin(r)) * m };
}

/** AA-19: a pure forward step of m metres along yaw (walking, no strafe). */
export function walkCam(cam, m = 0.1) {
  const r = cam.yawDeg * Math.PI / 180;
  return { ...cam, x: cam.x + Math.sin(r) * m, y: cam.y - Math.cos(r) * m };
}

export function createFlickerLive() {
  let waiters = [];
  const h = {
    cam: null, // when set, beforeRender overwrites the game's camera with it
    beforeRender(cam, world) {
      if (!h.cam) return;
      if (h.sword && world && world.get) { // AA-19: the held sword view model needs inventory.left = 'sword' + a hands.step (hands.handOf)
        const pl = world.get('player'), dbg = window.__debug;
        if (pl && dbg && dbg.hands) { pl.data.components.inventory.left = 'sword'; pl.data.components.inventory.right = null; dbg.hands.step(pl.data, false, false, true); }
      }
      if (h.player && world && world.get) { const pl = world.get('player'), t = pl && pl.data.transform; const b = pl && pl.data.components.body;
        if (t) { t.x = h.cam.x; t.y = h.cam.y; t.z = h.cam.z - EYE_H; t.yawDeg = h.cam.yawDeg; } if (b) { b.vx = 0; b.vy = 0; b.vz = 0; b.fallDistance = 0; b.peakZ = t.z; } } // AA-24: no fall damage from the teleport
      if (world && world.wind && world.wind.params) world.wind.params.speed = 0; // static scene
      cam.x = h.cam.x; cam.y = h.cam.y; cam.z = h.cam.z; cam.yawDeg = h.cam.yawDeg; cam.pitchDeg = h.cam.pitchDeg;
    },
    afterPresent() { if (waiters.length) { const w = waiters; waiters = []; for (const f of w) f(); } },
    nextFrame() { return new Promise((r) => waiters.push(r)); },
    async frames(k) { for (let i = 0; i < k; i++) await h.nextFrame(); },
  };
  return h;
}

/** OB198-DUMP-DIFF-01: opt-in dump of one consecutive frame pair (`dump: {pose, step}`), the input of tools/frame-diff.mjs.
 *  Per frame: glyph (fg alpha byte), kind, mat, pid (from GI), fg/bg packed 0xRRGGBB, as plain arrays (JSON-ready). */
export function packFrame(c, n) {
  const glyph = new Array(n), kind = new Array(n), mat = new Array(n), pid = new Array(n), fg = new Array(n), bg = new Array(n);
  for (let i = 0; i < n; i++) {
    glyph[i] = c.fg[i * 4 + 3]; kind[i] = c.GI[i * 4 + 1] & 0xff; mat[i] = (c.GI[i * 4 + 1] >>> 16) & 0xffff; pid[i] = c.GI[i * 4];
    fg[i] = (c.fg[i * 4] << 16) | (c.fg[i * 4 + 1] << 8) | c.fg[i * 4 + 2];
    bg[i] = c.bg ? (c.bg[i * 4] << 16) | (c.bg[i * 4 + 1] << 8) | c.bg[i * 4 + 2] : 0;
  }
  return { glyph, kind, mat, pid, fg, bg };
}
export function packDump(pose, step, prev, cur, cols, rows) { const n = cols * rows; return { pose, step, cols, rows, A: packFrame(prev, n), B: packFrame(cur, n) }; }

/** Runs every pose; `capture()` -> { GI, fg, bg } of the frame just presented. `capture()` also returns Depth. Returns { poses: {slug: {totalPct, kindPct, materialPct, glyphOnlyPct, colourOnlyPct, n, excluded, oldTotalPct}}, avg, ... }. */
export async function runLivePoses(h, { world, wg, cols, rows, pxCellW = 1, pxCellH = 2, capture, getGrid = null, poses = POSES_ALL, steps = STEPS, settle = 60, dump = null, diag = false, place = null }) {
  let hmap = null; const terms = createPitchedTerms();
  // AA-14a: glyph classes for the mixed255 split (line codes + the fog haze/sparse codes of the shade pass's uniforms)
  const fogU = wg && wg._cellPass && wg._cellPass.shadePass && wg._cellPass.shadePass.uniforms && wg._cellPass.shadePass.uniforms.fog;
  const gcls = glyphClassTable(fogU ? [...(fogU.hazeCodes || []), ...(fogU.sparseCodes || [])] : []);
  const out = {}, res = { poses: {}, steps, stepM: STEP_M, skippedSteps: 0 };
  // AA-01c: the grid can change mid-run (480x180 after the first frames); `getGrid()` -> {cols,rows,pxCellW,pxCellH} is read at EVERY capture,
  // the capture carries the grid it was read with, and a step whose two frames have different grids is skipped (the readback stride would be wrong).
  const cap = async () => { const g = getGrid ? getGrid() : { cols, rows, pxCellW, pxCellH }; const c = await capture(); if (diag) c.diag = await diagCapture(wg); const g2 = getGrid ? getGrid() : g; c.grid = { cols: g.cols, rows: g.rows, pxCellW: g.pxCellW, pxCellH: g.pxCellH };
    if (!sameGrid(g, g2)) c.grid.cols = -1; // the grid changed while reading back: never equal to another capture's grid
    return c; };
  const sameGrid = (a, b) => a.cols === b.cols && a.rows === b.rows && a.pxCellW === b.pxCellW && a.pxCellH === b.pxCellH;
  const KEYS = ['totalPct', 'kindPct', 'materialPct', 'glyphOnlyPct', 'glyphOnlyRawPct', 'shiftPct', 'colourOnlyPct', 'n', 'excluded'];
  const sums = {}; let nAvg = 0;
  for (const p of poses) {
    const gz = Number.isFinite(p.z) ? p.z : p.groundEye && world.terrain ? world.terrain.groundAt(p.x, p.y) + EYE_H : EYE_H; // AA-24: `z` = absolute eye z
    let cam = { x: p.x, y: p.y, z: gz, yawDeg: p.yawDeg, pitchDeg: p.pitchDeg };
    h.cam = cam;
    const swordWas = world.state ? world.state['tower.sword.taken'] : undefined;
    if (p.player && place) place({ x: p.x, y: p.y, z: gz - EYE_H, yawDeg: p.yawDeg }); // AA-24: main.js placePlayer (velocities 0, band for the target)
    h.player = !!p.player; h.sword = !!p.sword; // beforeRender keeps the sword in the left hand every frame (the game loop resets it) and re-steps the hands router
    if (p.sword && world.state) world.state['tower.sword.taken'] = true; // AA-19: show the held sword view model like the owner sees it
    if (wg && wg.invalidateHistory) wg.invalidateHistory(); // each pose starts with a camera cut
    await h.frames(settle); // streaming (meshes, carpet, shadows) settles
    let prev = await cap(); prev.cam = { ...cam };
    const acc = { oldTotalPct: 0 }; for (const k of KEYS) acc[k] = 0;
    const why = { kinds: {}, sub: {} }; // AA-DIAG-01: glyph-only flip reasons (counts; -> % of the diag's own n below)
    let used = 0;
    for (let s = 0; s < steps; s++) {
      cam = p.walk ? walkCam(cam, p.stepM || 0.1) : stepCam(cam); h.cam = cam;
      await h.frames(2); // the first may be a frame already past beforeRender; the second certainly drew `cam`
      const cur = await cap();
      if (!sameGrid(prev.grid, cur.grid)) { res.skippedSteps++; cur.cam = { ...cam }; prev = cur; continue; } // grid changed between the frames
      const gcols = cur.grid.cols, grows = cur.grid.rows;
      flickerStep(prev.GI, prev.fg, cur.GI, cur.fg, gcols, grows, out, prev.bg, cur.bg);
      acc.oldTotalPct += out.totalPct; // same-index metric (measures image motion), kept for reference
      const dOk = diag && prev.diag && cur.diag && cur.diag.cols === gcols && prev.diag.cols === gcols && cur.diag.rows === grows;
      if (dOk && (!hmap || hmap.length !== gcols * grows)) hmap = new Int32Array(gcols * grows);
      flickerReprojStep(prev, cur, prev.cam, { ...cam }, cur.grid, out, dOk ? hmap : null, gcls); // motion-compensated (AA-01b)
      if (dOk) { const tt = pitchedTerms({ ...cam }, cur.grid, terms); tt.gcls = gcls; flickerGlyphReasons(cur.diag, prev.diag, hmap, gcols, grows, tt, why); }
      for (const k of KEYS) acc[k] += out[k];
      if (dump && !res.dump && dump.pose === p.slug && dump.step === s) res.dump = packDump(p.slug, s, prev, cur, gcols, grows); // OB198-DUMP-DIFF-01
      used++;
      cur.cam = { ...cam }; prev = cur;
    }
    const pr = {}; for (const k of Object.keys(acc)) pr[k] = acc[k] / Math.max(1, used);
    if (why.n) { const w = { glyphOnlyPct: 100 * (why.flips || 0) / why.n, kinds: {} }; for (const k of [...GLYPH_REASONS, ...M255_KEYS]) w[k] = 100 * (why[k] || 0) / why.n;
      for (const k of Object.keys(why.kinds)) w.kinds[k] = 100 * why.kinds[k] / why.n;
      w.sub = {}; for (const k of Object.keys(why.sub)) w.sub[k] = 100 * why.sub[k] / why.n; pr.why = w; }
    pr.cols = prev.grid.cols; pr.rows = prev.grid.rows; pr.used = used; // diagnostics: which grid the pose was measured on
    res.poses[p.slug] = pr;
    if (p.sword && world.state) world.state['tower.sword.taken'] = swordWas;
    h.sword = false; h.player = false;
    if (p.inAvg === false) continue; // AA-19: reported separately, not part of avg
    nAvg++;
    for (const k of Object.keys(pr)) if (k !== 'why') sums[k] = (sums[k] || 0) + pr[k];
  }
  h.cam = null;
  res.avg = {}; for (const k of Object.keys(sums)) res.avg[k] = sums[k] / Math.max(1, nAvg);
  res.avgTotalPct = res.avg.totalPct;
  return res;
}

/** `&flickerdump=wallNear:3` -> { pose, step } (null when absent/invalid). */
export function parseFlickerDump(v) {
  if (!v) return null;
  const m = /^([A-Za-z0-9_]+):(\d+)$/.exec(v);
  return m ? { pose: m[1], step: +m[2] } : null;
}
