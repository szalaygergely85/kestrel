# Material response (MAT-RESPONSE-01) - designer proposal, owner pick

Preview: `design/preview/material-response.html` (static page, loads `../palette.js` + `look-lib.js`). Picks are saved in the browser (localStorage `kestrel.matRespPick`); the Summary tab shows them and a JSON export for the programmer.

## Idea
No full PBR. Every material names one **response type**: `matte`, `shiny`, `wet`, `metal` or `glow`. The light pass looks up the type's **preset row** (picked by the owner) and applies it the same way everywhere. A preset says how a lit cell answers: highlight glyph steps and their thresholds, highlight colour, rim / fresnel edge, wet darkening and sheen, self-light. Per-material data stays tiny: `resp` (+ `soft` / `aniso` flags) and the existing `spec` / `emissive` numbers.

Today: the light pass is Lambert + ambient (+ GI probes per 38.72, post per 38.73). `spec` only pushes colour toward the light hue when a cell is bright (palette `shade`, no N.H, no glyph change). Emissive ignores light; the glow pass adds a screen-space halo.

## The options (each shown on rock, wall corner, sword blade, puddle on stone, lamp; noon / dusk / night; rotating light; carried hand fire on)
| Type | A | B | C |
|---|---|---|---|
| **Matte** | Plain Lambert (today) | Soft wrap (light wraps 30 % past the terminator) | Wrap + fuzz rim (backlit edge glow, tinted by the material) |
| **Shiny / polished** | Pin glint: one `*` cell, light colour, high threshold | Two-step sheen `'` then `*`, 25 % material tint, faint cool rim | Colour sheen only (glyph unchanged) + sky-coloured fresnel edge |
| **Wet** | Darken (albedo x0.58, darker bg) + light-coloured streak `- ~ =` | Darken + fresnel **sky mirror** (live sky colour) + `~ =` highlight | Darken + twinkling `'` `*` on lit wet cells (4 Hz) |
| **Metal** | Dark diffuse, strong highlight tinted 75 % by the metal (brass glints gold), top glyphs `# M` | Highlight streak along the long axis, glyph follows the axis `- / | \` | Fake sky bands: bright above the reflected horizon, dark below, `=` on the horizon |
| **Glowing** | Flat emissive (today) | Emissive + coloured bg halo (glow pass) + slow 12 % breathing, `*` cores | Lit from inside: centre bright, edges darker, still takes outside light + a small `*` glint |

## Recommended defaults
- **Matte: A for hard materials** (stone, wood, ash, canvas - keeps today's crisp look) and **C for soft ones** (skin, fur, leaves, moss, leather: the fuzz rim makes animals and the hand read as organic when backlit). Two picks.
- **Shiny: B.** Stable under motion; A flickers when the light or camera moves, C is too quiet at 160x60.
- **Wet: B.** Puddles take the sky colour (blue noon, orange-pink dusk, near black at night) - the strongest "wet" read for its cost. A is the fallback if the light pass cannot get the sky colour. C only for rain weather, later.
- **Metal: A for all metal, B for blades** (`aniso: true` on `steel_edge`, `steel_old`). Tinted glints keep brass apart from steel (style guide: brass is the only saturated yellow); the blade streak is the "take me" sword glint the style guide already describes. C looks great at dusk but is noisy on small props.
- **Glowing: B.** The halo is the existing glow pass, so the cost is the breathing only. C is the alternative for crystals and lamp glass if the owner wants them to look solid.

## Per-material data (proposal, `palette.js` materials[key])
`resp` (matte | shiny | wet | metal | glow; missing = matte), `soft` (matte), `aniso` (metal), existing `spec` = strength multiplier (0.6 = preset as shown), optional `hiTint` / `hiGlyphs` overrides, optional `wet` 0..1 blend (also wanted per cell from weather / the shore band), existing `emissive`. The mapping of every current material is in the Summary tab: about 50 matte hard, 26 matte soft, 4 shiny (`crystal_dead`, `mirror_dark`, `skin_nail`, `mushroom_cap`), 10 metal + 2 blade, 13 glowing. Wet has no material yet: proposed new keys `stone_wet`, `floor_wet`, `mud_wet`, `water_puddle`.

## Engine needs (for the PO / architect; not designer work)
1. Per-cell view vector for N.H and fresnel (camera to cell; the light pass has N and the position).
2. The live sky colour stops in the light pass (for wet B, metal C, shiny C rim) - `liveLook` already holds them.
3. A per-cell tangent for `aniso` (mesh long axis or one constant per part).
4. A **highlight glyph channel** from the light pass to the shade pass: glyph steps override the ramp glyph (only above `glyphOverrideMinIndex`).
5. Cell hash + time for the wet sparkle (only if C is picked). Halo = the existing glow pass.

## Owner must pick
One option per slot: matte hard, matte soft, shiny, wet, metal, metal blade, glowing (7 picks; defaults above). Also: is a wet-weather / rain look wanted soon (then the `wet` per-cell blend is in scope), or puddles only.

`design/README.md` gets a format section once the picks are final (no data format changes yet).
