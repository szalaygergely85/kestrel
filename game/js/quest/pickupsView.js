// game/js/quest/pickupsView.js (US-080b, docs/architecture.md 30.2). View-only presentation for live pickup
// drops (`components.pickup`): hover + sine bob and a last-life blink (`ASSETS.pickupStyle`), matching the
// designer's own doc comment on that data ("the bob and the last-180-step blink are view-only, no sim state").
// Outside sim/** (rule 15 only binds game/js/quest/sim/**) - trig is fine here, same precedent as vitalsView.js's
// low-HP pulse / hurt-edge kick.
//
// Rendering itself (the glyphs) is the existing SpritePool, driven by `components.sprite` on the entity
// (pickups.js sets it at spawn) - this file only adjusts the entity's rendered height (`transform.z`), reading
// the sim's own `pickup.baseZ` (the drop point, untouched by this file) rather than `transform.z` itself, so a
// render-frame-rate-dependent bob can never feed back into `stepPickups`'s fixed-step collect-distance check.
//
// Deviation flagged to the architect/PO: there is no per-entity "do not draw this frame" hook on the renderer
// without an engine change (no opacity/scale/hidden field on `components.sprite`/`billboard`). The "off" blink
// window is approximated by moving the sprite far below the scene (HIDE_Z) instead of a true hide - acceptable
// for a 20 s pickup's last ~3 s blink, revisit if the owner finds it reads wrong in game.

const HIDE_Z = -500;

/** Fixed per-id hash in [0, 1000) - a stable phase offset so two drops side by side never bob in step. */
function idPhase(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h >>> 0) % 1000;
}

/** `pickupStyle.blink`: true while the drop should be drawn this step, given `lifeLeft` steps remaining. */
export function blinkVisible(lifeLeft, blink) {
  if (!blink || lifeLeft > blink.lastSteps) return true;
  const fast = lifeLeft <= blink.fastFromSteps;
  const period = fast ? blink.fastPeriodSteps : blink.periodSteps;
  const on = fast ? blink.fastOnSteps : blink.onSteps;
  return (lifeLeft % period) < on;
}

/** `pickupStyle.hp`/`.mp`'s `bob`: metres above `hoverM`, a sine wave with a per-drop phase. Pure. */
export function bobOffset(id, simTime, bob) {
  const phaseMs = idPhase(id) * (bob.periodMs / 1000);
  return bob.ampM * Math.sin((2 * Math.PI * (simTime * 1000 + phaseMs)) / bob.periodMs);
}

/**
 * @param {import('../../../engine/index.js').World} world
 * @param {Object} pickupStyle - ASSETS.pickupStyle
 * @param {number} simTime seconds
 */
export function presentPickups(world, pickupStyle, simTime) {
  if (!world || !pickupStyle) return;
  world.forEachEntity((e, id) => {
    const p = e.components && e.components.pickup;
    if (!p) return;
    const def = p.kind === 'mp' ? pickupStyle.mp : pickupStyle.hp;
    if (!def) return;
    const t = e.transform;
    if (!blinkVisible(p.life, pickupStyle.blink)) { t.z = HIDE_Z; return; }
    t.z = p.baseZ + def.hoverM + bobOffset(id, simTime, def.bob);
  });
}
