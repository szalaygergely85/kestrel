# ASCII Quest – Architecture & Design Decision Records

Numbered, append-only. Newest at the bottom. Format: Title / Date / Context / Options / Decision / Consequences.

---

## D-001 Awakening location: the Hollow Watchtower ("The Sunken Beacon")

**Date:** 2026-09-22
**Status:** Accepted

### Context
Round 1 kick-off. We need the first place the player wakes up. It must set tone and the world hook, be small enough to be the entire first vertical slice, show off the ASCII 3D look (dynamic lighting, physics), teach move / look / jump / interact, and open naturally into the overworld.

### Options considered
1. **Shrine / crypt under the earth (BotW-style Shrine of Resurrection).** Pro: strong "who am I" hook, fully enclosed = tiny render load, torchlight looks great. Con: pure interior; sun/outdoor shading and the "open world" promise are not shown until the very end; heavily derivative.
2. **Village house / bedroom (OoT/LttP-style).** Pro: warm, safe, immediate NPCs. Con: NPCs, dialogue, and a village are big scope; a flat room with a bed shows almost nothing of 3D lighting or physics; low drama.
3. **Beach / shipwreck (Wind Waker / Link's Awakening).** Pro: iconic, outdoors from frame one. Con: water rendering and a wide-open horizon are the hardest things to do well in ASCII; no natural "contained tutorial" walls; performance risk on frame one.
4. **Hollow ruined watchtower on a hilltop.** The player wakes on a stone floor at the bottom of a crumbled, roofless round tower. A fire-pit/torch lights the interior; sunlight falls in a shaft through the broken roof and gaps in the wall. A collapsed spiral stair climbs the inner wall; the final gap requires a jump. At the top the wall is breached and the whole overworld is visible below: the tower is a "beacon" that has gone dark. Pro: combines the enclosed tutorial of (1) with the outdoor payoff of (3), in one small space (~12x12 cell footprint, 3 floors). Torch (warm point light) + sun shaft (cool directional) in one shot is the best possible demo of our lighting model. Rubble, a rolling boulder/barrel, and stair gaps show physics. Vertical layout teaches jump organically. The dark beacon is the world hook: "the beacons are out, relight them." Con: needs a heightmap/multi-level interior (more than a flat room), and the summit reveal needs an LOD'd far view.

### Decision
**Option 4: the player awakens at the bottom of the Hollow Watchtower** (working name "The Sunken Beacon"), a roofless ruined stone tower on a hill at the edge of the world. Interior is torch-lit, pierced by a sun shaft; a broken spiral stair leads up; a breach at the top opens onto the overworld view and a descending path outside.

### Rationale
- Best tone/hook per unit of scope: solitude, ruin, a dead beacon, and one clear question ("why is the light out?") without a single line of dialogue.
- One scene demonstrates every technical pillar we are selling: ASCII 3D, two lighting types (warm point light + cool directional sun with shadow), physics (gravity, jump, rubble, a rolling object), verticality.
- Controls are taught by geometry, not text: walk to torch (move), look up at the sun shaft (look), climb stairs and jump the gap (jump), pull the lever / pick up the lantern (interact).
- The exit is the reward: the first view of the open world is earned by climbing, and the slice ends the moment the player steps out. Clean cut for Milestone 1.

### Consequences
- The world engine must support multi-level interiors from day one (not just a flat outdoor heightmap). This constrains D-002.
- The summit view requires a cheap far-distance overworld render (fog/LOD) even in Milestone 1; it may be a static-ish low-detail heightmap.
- No NPCs, dialogue, combat, or inventory in Milestone 1. The lantern is the only pickup and is purely a light source.
- Story canon fixed: the world has beacons; ours is dark; the player is its (forgotten) keeper. PO owns the details.

---

## D-002 Rendering approach for Milestone 1: column-raycast walls + per-column floor/ceiling casting, glyph density shading on a single canvas

**Date:** 2026-09-22
**Status:** Accepted

### Context
D-001 requires an enclosed multi-level interior with a point light, a directional sun shaft, and a far outdoor view. We must hit 60 fps in a browser with no build step, drawing a grid of colored glyphs.

### Options considered
1. **Wolfenstein-style grid raycaster** (one ray per screen column, walls only, flat floor/ceiling). Pro: trivial, fast. Con: no verticality, no stairs, no roof holes; cannot do the tower.
2. **Heightmap / voxel-column projection (Comanche-style)**. Pro: great for outdoor terrain, cheap. Con: poor for interiors with overhangs and multi-level floors; walls look like terraces.
3. **Full software rasterizer (triangles, z-buffer) into the char grid.** Pro: fully general, any geometry, correct lighting per cell. Con: most code, most risk; at ~160x60 cells it is actually cheap per-pixel, but the pipeline (clipping, z-buffer, meshes) is large for round 1.
4. **Hybrid: tile/grid raycaster with variable wall heights + per-row floor/ceiling casting per level, plus sector-based multi-floor ("Doom-lite" sectors).** Pro: enough verticality for stairs, ledges and a roofless tower; per-column cost is O(depth) so 160x60 at 60 fps is easy; lighting is computed per hit-point (distance to torch, sun-shaft test) and mapped to a glyph density ramp. Con: no true look-up/down (use y-shearing), no arbitrary meshes; entities are billboards.

### Decision
**Option 4 for Milestone 1**: a sector-based raycaster (Doom-lite) with per-sector floor and ceiling heights, y-shear for look up/down, billboard sprites for the player-visible props, and a separate cheap heightmap-projection pass for the far overworld seen through the breach. All output goes to one `<canvas>` as a grid of (glyph, fg, bg) cells; brightness -> glyph ramp (` .:-=+*#%@`), hue from light color. Lighting = ambient + sun (directional, with a shadow test against the roof-hole polygon) + N point lights (torch, carried lantern) with distance falloff and flicker.

Revisit for Milestone 3 (open world): expect to add or switch to heightmap projection outdoors; the char-grid renderer interface (`RenderTarget.setCell(x,y,glyph,fg,bg)`) is kept stable so the back-end can be swapped.

### Consequences
- Level data = 2D grid of sectors (floor height, ceiling height, wall/floor/ceiling material, light id). Designer authors tilesets/materials; Programmer authors the tower grid from the PO/Designer layout.
- Physics is 2.5D: capsule on XY, height on Z per sector, step-up threshold for stairs, gravity, jump. Rolling boulder = sphere on the same model.
- Target grid: 160x60 cells (adjust to window), fixed 60 Hz sim, render decoupled.
- Known limits accepted: no arched geometry (arches are faked with sector height steps), no true 6DOF look.

---

## D-003 US-022 "Light the summit beacon" is IN Milestone 1 as P1 (optional final beat)

**Date:** 2026-09-22
**Status:** Accepted (amends D-001 consequence "the lantern is purely a light source")

### Context
The PO's GDD makes "relight the beacons" the core loop. D-001 left the summit bowl cold so the slice ends on a question. PO proposes US-022: at the bowl, `[E] Light the beacon` with the carried lantern starts a large fire. Cost: one more point light + one large fire animation.

### Options
(a) Keep it cold (D-001 as written). Cheapest; ending is a pure question, but the player never performs the game's core verb.
(b) Add to M1 as P1, after all P0 stories (PO recommendation). Small cost: the point-light system already supports 4 lights and the brazier already needs a fire animation; the beacon fire is the same asset scaled up.
(c) Opening beat of M2. Defers cost, but M2 then opens with a backtrack up the tower, and M1 never demonstrates the loop.

### Decision
**(b).** US-022 is in M1 as **P1**, built only after every P0 story is `done`. Constraints:
- Lighting the beacon is **optional**; the breach end trigger works either way. The lantern is not consumed (light is shared, the player keeps it).
- End text varies: unlit = `The beacons are dark.`; lit = `One beacon burns. The others are dark.` then `The world waits.` (US-017 gets this small extension).
- Beacon fire art = brazier flame frames scaled to the 12x4 bowl (Designer reuses US-011 frames; no new design story).
- Beacon light: radius 12 m, warm, but it must pass the US-018 budget at the summit view; if it costs the 60 fps target, cut the radius before cutting the feature.
- The distant tower stays dark after lighting (the hook survives).

### Consequences
- Backlog: US-022 status `todo`, P1, dependencies US-011, US-012, US-017. Roadmap M1 "In" list updated; M1 exit criteria unchanged (P0 only).
- D-001 consequence "no pickups beyond the lantern, purely a light source" is amended: the lantern also lights the beacon.

---

## D-004 Sound is P2 in Milestone 1, procedural only, never an exit criterion

**Date:** 2026-09-22
**Status:** Accepted

### Context
Roadmap said sound is "out / nice-to-have if trivial". PO filed US-020 (brazier, footsteps, boulder, lever, grate, wind) as P2 after all P0.

### Options
(a) Keep out of M1 entirely. (b) Confirm P2 after P0, with a scope cap. (c) Raise to P1.

### Decision
**(b), confirmed with a cap:** US-020 stays P2, picked up only when every P0 is `done` and US-022 (P1) is done or explicitly deferred. Scope cap: WebAudio procedural synthesis only (noise-based crackle, wind, clicks), **no audio asset files** in M1, one story of effort; if it grows, cut sounds rather than extend. M key mute required. Sound is not an M1 exit criterion and testers do not fail M1 on audio.

### Consequences
- Roadmap M1 wording changed from "Out" to "P2 stretch, not exit criterion".
- `game/assets/audio/` is not created in M1.

### Manager notes on PO gap-fills (no separate ADR)
- Lever raises an iron grate (portcullis) on the upper stair: **agreed**; it is the single mechanism D-001 asked for and animating a sector ceiling is cheap.
- Lantern as a *soft* gate for the gap (stairs readable without it): **agreed**, and I want it enforced in testing: the slice must be completable without ever taking the lantern.
- Boulder rolls down a slope into the NW hollow at -0.3 m: **agreed**. Flag: with radius 0.6 m the boulder is a *hard* gate at the stair base (jump apex 1.05 m). Acceptable because a walk-into push clears it, but US-013 must guarantee it can never come to rest somewhere that blocks the stair or the wake area again (the hollow must be the only stable resting place, and restart resets it).
- Minor disagreement: US-012 "lantern cannot be dropped" plus US-022 must not read as "lantern consumed" - the player keeps it (fixed in D-003).
