// game/js/deviceLost.js - S8-B1-10 (docs/architecture.md 38.10c "This story (~0.5 d)", docs/sprints/sprint-8-queue.md
// S8-B1-10): device-lost card. RE-SCOPED: no renderer rebuild (that is DEVICE-LOST-2); this just stops the sim,
// autosaves once and shows a reload card. Pure module (no DOM / GPU / storage imports) so the Node AC can drive
// it with a mock device + fake callbacks - main.js wires `freeze`/`autosave`/`showCard` to the real sim loop,
// gameHooks.ctx.requestSave()/saveRelay.save(), and a DOM card respectively.
//
// `device.lost` is the GpuDevice shape's Promise<{reason, message?}> (GpuDeviceWebGPU.js), resolved exactly once.
// `reason === 'destroyed'` without `forced` is our own dispose (normal teardown) and is ignored; any other
// reason - or a forced 'destroyed' (the dev hook can pass one) - triggers the card exactly once. Because a
// Promise settles once, and `handled` below also guards a caller that (mis)invokes this twice on the same
// device, later losses are a guaranteed no-op: freeze/autosave/showCard each run at most once per device.

/**
 * @param {{lost?: Promise<any>}} device
 * @param {{freeze?: () => void, autosave?: () => void, showCard?: () => void}} [hooks]
 * @returns {{triggered: boolean}} a live status object (`triggered` flips to true once the card hooks have run)
 */
export function watchDeviceLost(device, hooks = {}) {
  const { freeze, autosave, showCard, canSave } = hooks;
  const status = { triggered: false };
  if (!device || !device.lost || typeof device.lost.then !== 'function') return status;
  let handled = false;
  device.lost.then((info) => {
    const reason = info && info.reason;
    const forced = !!(info && info.forced);
    if (reason === 'destroyed' && !forced) return; // our own dispose (38.10c) - never shows the card
    if (handled) return; // a Promise settles once; this also covers a double-subscribe on the same device
    handled = true;
    status.triggered = true;
    if (typeof freeze === 'function') freeze(); // stop stepping the sim BEFORE the (synchronous) autosave
    // Save only when the game says it is safe (not on the title menu / wake / death): else the reload loads the last good save.
    if (typeof autosave === 'function' && (typeof canSave !== 'function' || canSave())) autosave(); // one synchronous save
    if (typeof showCard === 'function') showCard();
  });
  return status;
}
