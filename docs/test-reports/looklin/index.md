# LOOK-LINEAR-01 - biome ground look colours: old sRGB->linear decode (off) vs as authored (`&looklin=1`, on)

Owner decides the default. Live clock, quality medium, WebGPU, `tools/visqa-sweep.mjs` (HOURS=9,19, OUTDIR/SUFFIX/EXTRA env).
Numbers = mean RGB of the ground band (rows 62-90 % of the frame), off -> on. Only look-ground colours change (fg, bg, accents, far-grass tint); trees, sky, paths, props are identical.

| spot @ hour | off | on | what changed |
|---|---|---|---|
| forest-in 09 | ![](forest-in-09-off.png) | ![](forest-in-09-on.png) | forest floor 41,46,32 -> 46,55,36: dark gaps between glyphs become visible moss green; small change (mostly in tree shade) |
| forest-in 19 | ![](forest-in-19-off.png) | ![](forest-in-19-on.png) | 48,30,21 -> 53,37,24: slightly lighter, less near-black under the canopy |
| forest-edge 09 | ![](forest-edge-09-off.png) | ![](forest-edge-09-on.png) | 27,43,16 -> 57,86,35: biggest change, ground about 2x brighter, olive/moss instead of near-black green |
| forest-edge 19 | ![](forest-edge-19-off.png) | ![](forest-edge-19-on.png) | 31,27,14 -> 54,56,25: dusk meadow reads as grass (olive) instead of dark brown |
| meadow-road 09 | ![](meadow-road-09-off.png) | ![](meadow-road-09-on.png) | 43,53,29 -> 62,81,40: meadow greener and brighter, less saturated-dark; road (look 0) unchanged |
| meadow-road 19 | ![](meadow-road-19-off.png) | ![](meadow-road-19-on.png) | 47,34,20 -> 62,54,27: dusk grass lighter, warm sunset tint still on top |
| cemetery 09 | ![](cemetery-09-off.png) | ![](cemetery-09-on.png) | 32,49,23 -> 58,87,39: grass around the graves ~1.8x brighter |
| cemetery 19 | ![](cemetery-19-off.png) | ![](cemetery-19-on.png) | 38,31,19 -> 60,59,31: grass reads green at dusk instead of brown-black |
