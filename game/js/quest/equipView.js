// game/js/quest/equipView.js (EQ-07 + EQ-09, architecture 38.41 items 4 and 9). First-person shield + bow view models on the
// LEFT hand, the block spark, and the flying / stuck arrow instances. Presentation only: it reads the sims, never writes them.
// Authored defs: design/models/equipment.js (viewModels.shield / viewModels.bow). No allocation per frame.
import { writeUnitInstance, yawFromDelta } from '../../../engine/index.js';

const STEP_MS = 1000 / 60;
const BOW_VARIANTS = Object.freeze({ rest: 'bowRest', draw1: 'bowDraw1', draw2: 'bowDraw2', draw3: 'bowDraw3' });
export const EQUIP_VIEW_MODELS = Object.freeze(['shieldHeld', 'bowRest', 'bowDraw1', 'bowDraw2', 'bowDraw3']);

function dur(def, name) { const k = def.clips[name].keys; return k[k.length - 1].t; }

export function loadShieldView(vm, def, pool) {
  const h = vm.load('shield', def, pool);
  vm.setHand(h, 'left'); vm.hide(h);
  const c = (n) => vm.clipId(h, n);
  return { vm, h, def, clip: { idle: c('idle'), raise: c('raise'), blocked: c('blocked') }, raiseMs: dur(def, 'raise'), blockMs: dur(def, 'blocked'), lastBlock: -1 };
}

/** @param {boolean} show shield set out @returns {boolean} true on the frame a new block starts (spark + clank) */
export function presentShield(v, show, shield, nowTick, simTime, moving) {
  if (!v) return false;
  const { vm, h } = v;
  if (!show) { vm.hide(h); return false; }
  const frac = shield.raiseFrac;
  const bms = (nowTick - shield.blockTick) * STEP_MS;
  let edge = false;
  if (shield.blockTick !== v.lastBlock) { if (shield.blockTick >= 0) edge = true; v.lastBlock = shield.blockTick; }
  let cid = v.clip.idle, t = simTime * 1000, bob = moving ? 1 : 0;
  if (bms >= 0 && bms < v.blockMs && frac > 0.99) { cid = v.clip.blocked; t = bms; bob = 0; }
  else if (frac > 0) { cid = v.clip.raise; t = frac * v.raiseMs; bob = (moving ? 1 : 0) * v.def.bob.raisedScale; }
  vm.show(h, cid, t, false);
  vm.setBob(simTime, bob, h);
  return edge;
}

export function loadBowView(vm, def, pool) {
  const d = { ...def, variants: BOW_VARIANTS };
  const h = vm.load('bow', d, pool);
  vm.setHand(h, 'left'); vm.hide(h);
  vm.warmVariants(h, Object.keys(BOW_VARIANTS));
  const c = (n) => vm.clipId(h, n);
  return {
    vm, h, def: d, v: { rest: vm.variantId(h, 'rest'), d1: vm.variantId(h, 'draw1'), d2: vm.variantId(h, 'draw2'), d3: vm.variantId(h, 'draw3') },
    clip: { idle: c('idle'), raise: c('raise'), draw: c('draw'), hold: c('hold'), release: c('release'), dry: c('dry') },
    ms: { raise: dur(d, 'raise'), release: dur(d, 'release'), dry: dur(d, 'dry') },
  };
}

/** @param {boolean} show bow set out; swapFrac 0..1 raise progress after a Q swap (1 = done); bow = sim/bowDraw state */
export function presentBow(v, show, bow, swapFrac, nowTick, simTime, moving) {
  if (!v) return;
  const { vm, h } = v;
  if (!show) { vm.hide(h); return; }
  let cid = v.clip.idle, t = simTime * 1000, vr = v.v.rest, bob = moving ? 1 : 0;
  const rel = (nowTick - bow.shotTick) * STEP_MS, dry = (nowTick - bow.dryTick) * STEP_MS;
  if (swapFrac < 1) { cid = v.clip.raise; t = swapFrac * v.ms.raise; }
  else if (bow.drawing) {
    const s = bow.drawSteps, ms = s * STEP_MS;
    bob *= v.def.bob.drawScale;
    if (s >= 48) { cid = v.clip.hold; t = nowTick * STEP_MS; vr = v.v.d3; }
    else { cid = v.clip.draw; t = ms; vr = s < 16 ? v.v.d1 : s < 32 ? v.v.d2 : v.v.d3; }
  } else if (rel >= 0 && rel < v.ms.release) { cid = v.clip.release; t = rel; bob = 0; }
  else if (dry >= 0 && dry < v.ms.dry) { cid = v.clip.dry; t = dry; bob = 0; }
  vm.setVariant(h, vr);
  vm.show(h, cid, t, false);
  vm.setBob(simTime, bob, h);
}

/** Block spark: a 5x3 glyph burst low-left of the crosshair for 12 frames after a block. `ui.setCellRGB(x,y,code,fg..,bg..)`. */
const SPARK = [['  |  ', '-=*=-', '  |  '], ["\\ ' /", '- + -', '/ . \\'], ['.   \'', '     ', '\'   .']];
export function drawBlockSpark(ui, cols, rows, ageMs) {
  if (ageMs < 0 || ageMs >= 140) return;
  const f = SPARK[ageMs < 40 ? 0 : ageMs < 90 ? 1 : 2];
  const cx = (cols * 0.34) | 0, cy = (rows * 0.62) | 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
    const ch = f[r][c]; if (ch === ' ') continue;
    ui.setCellRGB(cx - 2 + c, cy - 1 + r, ch.charCodeAt(0) - 32, 255, ageMs < 40 ? 255 : 200, ageMs < 40 ? 255 : 120, 0, 0, 0);
  }
}

/** Arrow instance groups (models `arrow` / `arrowStuck`): flying <= 8, stuck drawn only within 20 m, nearest 8. */
export function createArrowView(engine, maxFlying = 8, maxStuck = 8) {
  let gF = null, gS = null;
  try { gF = engine.instances.group('arrow', maxFlying); gS = engine.instances.group('arrowStuck', maxStuck); } catch (e) { console.warn('[EQ-09] arrow groups:', e && e.message); }
  const yawOf = yawFromDelta; // compass yaw, 0 = -y (north)
  const near = new Int32Array(32), nearD = new Float64Array(32); // stuck pool <= 32
  return {
    present(arrows, px, py) {
      if (!gF || !arrows) return;
      const F = arrows.flying, S = arrows.stuck;
      let n = 0;
      for (let s = 0; s < F.n; s++) {
        if (F.alive[s] === 0) continue;
        writeUnitInstance(gF.ib, n++, F.x[s], F.y[s], F.z[s], yawOf(F.vx[s], F.vy[s]), 0xA000 | s, 0);
      }
      gF.count = n;
      let c = 0; // candidates within 20 m, then the nearest maxStuck by repeated minimum (<= 16 entries)
      for (let k = 0; k < S.n; k++) {
        if (S.alive[k] === 0) continue;
        const dx = S.x[k] - px, dy = S.y[k] - py, d = dx * dx + dy * dy;
        if (d <= 400) { near[c] = k; nearD[c] = d; c++; }
      }
      let m = 0;
      while (m < maxStuck && m < c) {
        let bi = m;
        for (let i = m + 1; i < c; i++) if (nearD[i] < nearD[bi]) bi = i;
        const tk = near[bi], td = nearD[bi]; near[bi] = near[m]; nearD[bi] = nearD[m]; near[m] = tk; nearD[m] = td;
        m++;
      }
      for (let i = 0; i < m; i++) {
        const k = near[i];
        writeUnitInstance(gS.ib, i, S.x[k], S.y[k], S.z[k], yawOf(S.dx[k], S.dy[k]), 0xA100 | k, 0);
      }
      gS.count = m;
    },
    dispose() { if (gF) engine.instances.remove(gF); if (gS) engine.instances.remove(gS); gF = gS = null; },
  };
}
