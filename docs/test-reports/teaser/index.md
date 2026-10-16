# Teaser stills - TEASER-QA 2026-10-16

Build: pc-b 3e972a4d (+ TEASER-QA path fixes). `node tools/teaser-stills.mjs --port 95xx` (quality=ultra, grid 480x180, view 1920x1080, `clean=1`, `cinehour` per path). Per path: `<id>-start/mid/end.png` + `<id>-sheet.png` (3-up, magenta box = the 9:16 portrait crop). Run data: stills.json.

| path | hour | verdict | defects (in the 9:16 crop unless noted) |
|---|---|---|---|
| teaser-crypt-drone | 22 | weak | very dark/low contrast, crypt small; grass a flat green fill; diagonal lighter band in the sky (left) |
| teaser-crypt-night | 22 | fixed (end framing) | before: last frame all wall, door right of crop centre (`-before-sheet`). Now centred. Left: crypt is a facade only, the doorway shows sky/fence behind; fence rows float above the horizon (left) |
| teaser-dawn-sea | 6.25 | OK | warm dawn (DAWN-COLOUR-01 OK); dark bar / step on the horizon right of the crop |
| teaser-fire | 22 | OK | room dark, fire lit; small sky/window patch top-right corner of the crop at the end |
| teaser-grass | 17 | defects | dark building block on the horizon (mid, in crop, brief says no buildings); sun drawn as a light cone/wedge from the top edge; green specks floating above the horizon; lower half murky |
| teaser-leaves | 15.5 | broken | start+mid nearly black (no ferns/saplings/trunks visible); end shows rooftops/landmarks on the horizon; sun disc huge at the top. Needs re-authoring |
| teaser-river-falls | 11 | defects | falls sheet reads as a beige stone wall (no water colour); end: flat grey slab across the horizon (Glasswater surface sits above the river = water-level step) |
| teaser-sky | 19 | OK | dusk clouds, no ground |
| teaser-strand-dawn | 6.5 | defects | coast is a stair-stepped dark silhouette (coarse terrain) with a thin dark tongue floating at its tip |
| teaser-water | 12 (was 17) | fixed (hour) | at 17:00 the lake rendered near-black brown (`-h17-before-sheet`); at 12:00 it reads blue. Far shore = flat stepped slab band at the top |

No HUD/pause overlays and no camera-inside-geometry frames in any path. Note: in a single run the 10th page load (leaves) timed out at 120 s; the load wait is now 240 s.
