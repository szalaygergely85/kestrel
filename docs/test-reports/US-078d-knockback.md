# US-078d knockback - 2026-10-05

Status: **arch-review**, per PC-B QUEUE 16 item 8. NEEDS PC-A: diff-only review and PO/owner sword feel check.

The published runtime already implements D-034 / architecture.md 30.1. This step adds integration regression coverage to `game/js/quest/sim/beastSim.test.js` and `sword.test.js`; it does not retune the specified constants. Generic body targets receive a horizontal 3 m/s impulse. Heavy hits assign beast velocity 4 m/s, decelerate at 12 m/s², freeze facing and interrupt any brain state for exactly 36 steps before chase/return. Fixed-step Euler displacement on open ground is 19/30 m (0.633333 m); the older approximately 1.5 m AC is superseded by the architecture number.

## Validation

- Focused **198/198 checks PASS** with GC: beast sim 100, sword sim 98. Existing allocation checks remain green.
- Actual mesh World arc/LOS hits from both hands interrupt windup/charge. The integration follows main.js's beast-before-sword order and verifies single damage-3 hit, assigned velocity rather than addition, timer/facing, deceleration, chase/return, light tap and mana-short release boundaries. Heavy/light checks cover all eight prior brain states, clearing the charge wall counter on heavy. Mid-slide save/load remains hash-identical through recovery.
- Moving generic bodies receive exactly one normalized radial 3 m/s addition with zero vertical impulse. The real mesh integrator moves a body toward the tower wall without crossing it.
- Full working tree **225/225 suites PASS**, isolated prospective commit **223/223 PASS**, zero FAIL/TIMEOUT/WARN, including typecheck/content checks. The working run also contains the independently developed tower collider item. Explicit `check-deps OK`: 396 working files/1,305 advisory warnings; 394 isolated/1,303.
- Real browser on the isolated mesh world: actual sword pickup and mouse hold/release hit boar1 exactly once, heavy=1, damage=3; maximum displacement **0.6333333333327573 m**; one visible sword handle and no runtime exceptions. Owned server/browser stopped by the probe.

No runtime/config/view or spec change. The owner still needs to judge shove and recovery feel with the now-visible left-hand sword; programmer tests do not supply PO approval. Developed beside PROP-COLLIDE-01b using disjoint ownership. Unrelated local Ruins/render/content work preserved; no DDA checks run.
