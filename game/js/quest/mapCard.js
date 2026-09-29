// game/js/quest/mapCard.js (US-015, docs/architecture.md 7.6 item 8). The
// map-card panel: first show (0.5 s after the title fades out, minimum
// 1.0 s on screen before it can be dismissed), then a plain `M` toggle from
// the first dismissal until the end trigger. Uses the generic
// `engine/ui/panel.js` primitive - this module owns every game rule
// (timing, gating, the `M` binding) the panel itself knows nothing about.
import { buildPanelArt, createPanel } from '../../../engine/index.js';
import { request as requestHint } from './hints.js';

let art = null;   // PanelArt, built once (palette/model are load-time constants)
let panel = null; // runtime Panel, rebuilt every 'world:loaded' (7.6 item 6)

/** Call from the 'world:loaded' handler (first load AND every restart). */
export function initMapCard(assets, sceneCols, sceneRows) {
  const model = assets.model('mapCard');
  if (!art) art = buildPanelArt(model, assets.palette, 'show');
  const cfg = assets.uiStyle.mapCard;
  panel = createPanel(art, {
    fadeIn: cfg.fadeIn, fadeOut: cfg.fadeOut,
    sceneMul: cfg.sceneDim.bgMul, plateMul: cfg.plate.bgMul, platePad: cfg.plate.pad,
  });
  panel.layout(sceneCols, sceneRows, model.layout.top, model.layout.centerX, assets.uiStyle.uiGrid);
  return panel;
}

export function getMapPanel() { return panel; }
export function isMapOpen() { return !!panel && panel.state !== 'closed'; }

/**
 * `wakeTitleDoneAtSec` = the wake timeline's fixed "title has fully faded
 * out" time (seconds since world load, from `wakeTitleDoneAtSec(cfg)` in
 * wake.js) - the first-show delay (`cfg.showOnce.delaySec`) is measured
 * from there, off the same `quest.wakeT` clock the wake sequence uses (kept
 * running after the wake ends - see main.js).
 * @param {import('../../../engine/index.js').World} world
 * @param {Object} assets - AssetRegistry (palette/uiStyle)
 * @param {number} dt
 * @param {import('../../../engine/index.js').Input} input
 * @param {number} wakeT
 * @param {number} titleDoneAtSec
 */
export function stepMapCard(world, assets, dt, input, wakeT, titleDoneAtSec) {
  if (!panel) return;
  panel.step(dt);
  const uiStyle = assets.uiStyle;
  const cfg = uiStyle.mapCard;
  const ending = typeof world.state['quest.endT'] === 'number' && world.state['quest.endT'] >= 0;

  // Owner request (2026-09-27): no automatic first show - the card is
  // `M`-only from the start. The old showOnce/minShowSec/dismiss timeline
  // (cfg.showOnce/minShowSec/dismiss, design/models/title.js) is unused now;
  // left in uiStyle for the moment rather than editing a shared content file
  // for a behaviour-only change. Latches `dismissed` true (without ever
  // calling panel.open()) at the same relative moment the auto-open used to
  // fire (title fade + delaySec), purely to keep the "Press M to read the
  // chart" hint's pacing unchanged. Also covers restored/legacy state where
  // `shown` is already true but `dismissed` isn't (the old mid-first-show
  // case) - latches immediately rather than ever locking `M` out.
  if (!world.state['ui.mapCard.dismissed']) {
    if (!world.state['ui.mapCard.shown']) {
      if (wakeT < titleDoneAtSec + cfg.showOnce.delaySec) return; // not yet
      world.state['ui.mapCard.shown'] = true;
    }
    world.state['ui.mapCard.dismissed'] = true;
    world.state['hints.chartT'] = 0; // arms the "Press M to read the chart" 20 s timer (hints.js stepHints)
    requestHint(world, uiStyle, 'move');
    return;
  }

  if (ending) return; // never during the end sequence/screen
  if (panel.state === 'closed') {
    if (input.pressed('KeyM')) {
      input.consumePressed();
      panel.open();
      world.state['ui.mapCard.opened'] = true;
    }
  } else if (input.anyPressed()) {
    // `M`, Esc (the browser drops pointer lock itself - accepted, 7.6 item
    // 5) or any other key closes it.
    input.consumePressed();
    panel.close();
  }
}
