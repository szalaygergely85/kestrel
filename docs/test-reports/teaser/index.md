# Teaser stills - TEASER-QA 2026-10-16

Build: pc-b 3e972a4d (+ TEASER-QA path fixes). `node tools/teaser-stills.mjs --port 95xx` (quality=ultra, grid 480x180, view 1920x1080, `clean=1`, `cinehour` per path). Per path: `<id>-start/mid/end.png` + `<id>-sheet.png` (3-up, magenta box = the 9:16 portrait crop). Run data: stills.json.

| path | hour | verdict | defects (in the 9:16 crop unless noted) |
|---|---|---|---|
| teaser-crypt-drone | 22 | weak | very dark/low contrast, crypt small; grass a flat green fill; diagonal lighter band in the sky (left) |
| teaser-crypt-night | 22 | fixed (end framing) | before: last frame all wall, door right of crop centre (`-before-sheet`). Now centred. Left: crypt is a facade only, the doorway shows sky/fence behind; fence rows float above the horizon (left) |
| teaser-dawn-sea | 6.25 | OK | warm dawn (DAWN-COLOUR-01 OK); dark bar / step on the horizon right of the crop |
| teaser-fire | 22 | OK | room dark, fire lit; small sky/window patch top-right corner of the crop at the end |
| teaser-grass | 17 | defects | dark building block on the horizon (mid, in crop, brief says no buildings); sun drawn as a light cone/wedge from the top edge; green specks floating above the horizon; lower half murky |
| teaser-leaves | 10 (was 15.5) | fixed (path, TEASER-QA-01) | old path (`-before-sheet`): ONE real tree within 15 m of the push, camera looked at bare forest-type floor into the 15:30 sun, village roofs on the end horizon. Re-authored into the 12-trunk stand at 1406,916, hour 10, tilt -20 -> -8: trunks/crowns/sky gaps in every frame, no buildings. Open: shaded forest floor under the stand still renders near-black (render, not path) |
| teaser-river-falls | 11 | fixed (TEASER-QA-03) | (`-before-sheet`) beige wall = per-cell sheet hash 0.25 x 0.6 m (noise from 20 m) + near-white over brown rock: hash cell now 0.25 x 2 m along the fall (FALL_STREAK_M, JS + WGSL + glslref; gpucompare waterfall rows PASS) + blue-white shallow -> falling streaks. Slab: no level bug (lake -58, outlet -58 -> -59.6, banks -57.2); from 2.7 m over the banks only a grazing band showed; end key z -51 pitch -11 -> open lake. Open: lake mirrors the grey cliffs (pale grey, TEASER-QA-02 territory) |
| teaser-sky | 19 | OK | dusk clouds, no ground |
| teaser-strand-dawn | 6.5 | defects | coast is a stair-stepped dark silhouette (coarse terrain) with a thin dark tongue floating at its tip |
| teaser-water | 12 (was 17) | fixed (hour) | at 17:00 the lake rendered near-black brown (`-h17-before-sheet`); at 12:00 it reads blue. Far shore = flat stepped slab band at the top |

No HUD/pause overlays and no camera-inside-geometry frames in any path. Note: in a single run the 10th page load (leaves) timed out at 120 s; the load wait is now 240 s.
