// game/js/quest/sim/brains/ground.js (BEAST-03b, architecture.md 38.64 (2)). Layer contract: `layer(sim, i, ctx) -> true`
// when the layer handled this slot's state this step, false = the common handler (beastSim transitionOne) runs.
// No allocation, no closures, no Math.random / trig / clock (rule 15). The ground layer adds nothing on top of the
// common handler: it IS the legacy boar/wolf/bear/goblin path. BEAST-04+ layers (pack, ranged, ...) replace entries.
export function groundLayer(sim, i, ctx) { return false; }
