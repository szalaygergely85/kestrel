# PO batch review 2026-10-13 (PC-B, D-066) - claims-only

Sources: lane entries in docs/lanes/pc-b1.md / pc-b2.md, bugs.md OB-103/113..118, decisions D-075..D-077. Commit messages were not readable (no shell in this review); verdicts rest on the lane entries. Nothing was run. OB rows stay "fix in - OWNER TO TEST" until the owner says verified.

## WM-01 184478ea - PO OK -> testing
Byte-identical geo bake speed-up, 11 pinned hashes, targets met on bake (340 -> 165 ms, 145 -> 73 ms). Not measured: full BandBakeJob incl. scatter. Gate still owed by the main session: gpucompare once.
Walk-test: walk/run across a band border (e.g. strand -> keep) and watch for hitches. Terrain looks identical to before (no new seams or height jumps).

## OB-103b de64208f - PO OK -> testing
Preset carpet knob (low off ... extreme 1.4/1.5), live switch in Settings, tests pass. Owed: tools/verify-ob103b.mjs, iGPU medium bench, gpucompare, owner look.
Walk-test: Settings > Quality, cycle low/medium/high/ultra on a meadow; grass carpet is off on low and grows denser and farther on higher presets, with no reload.
Check that the frame rate stays acceptable on medium.

## PERF-R2P4 26e117e1 - PO OK -> testing
Per-species tree lodCells (LOD1 at ~15-20 m), per-species detail maxDistM, 26-check test. Triangle budget down (forestWalk 184k -> 174k). Owed: gpucompare (D-039 note) and the owner look at the LOD switch (D-075 asks for it).
Walk-test: walk through a forest; trees should not visibly pop or change shape at 15-20 m.
Logs and stumps may thin out beyond ~50-70 m, which is intended.

## PERF-R4 3ae3802f - PO OK -> testing
New 'ultra' shadow tier (meshLod0M 16, instCastM 32), ultra/extreme lodScale 1.0, 'high' unchanged, added to the Settings shadows cycle. Tests 16/16. Owed: gpucompare, bench-presets at ultra, owner look at far shadows.
Walk-test: Settings: set Shadows to ultra (and the Ultra preset) at dusk or dawn with long shadows.
Far shadows should look sharp and stay stable, and fps should not collapse.

## G2 df362bda - PO OK -> testing (pending the gpucompare gate)
Far grass glyph tier with a WGSL twin and JS==WGSL probes. The zero-alloc item was shown to be a flaky test, not G2 code. Open and accepted: the P3 class-cell tint is NOT done (ASK ARCHITECT, stays in the backlog). Old grass poses beyond 12 m change, so gpucompare needs a D-039 re-baseline.
Walk-test: stand on a grass meadow with the carpet on (medium or higher) and look to the horizon.
Beyond ~12 m the ground should show soft grass glyphs (, " ') swaying with the gust, blending smoothly into the carpet with no hard ring.

## OB-117 + OB-118 f0d59890 - PO REJECT (one small gap)
OB-118 is fine (Extreme label and choice added). OB-117: the Settings row, persistence, live `setAspect` and tests exist, but the lane's own "NEEDS B1-main" is still undone. `setAspect` / `aspectRatio` do not appear in game/js/main.js, so a saved non-default ratio (4:3, 21:9, 16:10, Fill) is not applied at boot. It applies only after the row is changed again. D-077 says the picture is fixed to the chosen ratio. Required: in main.js call `engine.renderTarget.setAspect(aspectRatio(loadSettings().aspect))` after the render target exists, import from ./settings/options.js, and run verify-ob117 (4:3 and fill cases). Then PO OK.
Owner walk (after the fix): Settings > Aspect ratio > 4:3, restart the page, and the picture must still be 4:3 with bars. Also check Quality now lists Extreme with a label.

## OB-113 80a74d63 - PO OK -> testing
Beast potion goes into the pack as `potion.hp` / `potion.mp` through addItem (normal toast), no instant heal. A full pack keeps the potion in orbHeld, nothing lost. Rolls unchanged. 300-kill test and loot suites 9/9. This matches D-077.
Walk-test: kill several boars and goblins; a potion toast appears and the potion is in the pack (at full HP too), and nothing is healed on its own.
Goblin mp orbs give a mana potion. Fill the pack and check you get the "pack full" message.

## OB-114 7e110f12 - PO OK -> testing (partial; row stays open for the facets)
Green/flat cause found: the Quaternius moss_cap slot covered the underside and lower flanks. Fixed in data (moss only where nz >= 0.5) for Rock_Medium_1..3, tests pass. NOT fixed and recorded as OPEN: the huge flat facets / hard seams (low-poly source, 244-522 tris, rock texture). It is also unconfirmed which placement is the owner's boulder. The owner's second complaint ("rock shader") is therefore not yet answered, so the owner decides whether it is enough or needs a smoothing/detail pass (a designer or ASK ARCHITECT item).
Walk-test: go to the meadow boulder by the stone wall. Moss/grass colour should be only on the top, with grey rock on the sides and underside. Then say whether the faceting is acceptable. Stills are in docs/test-reports/ob114/.

## OB-115 f2c7b81c - PO OK -> testing
Kill objectives count any beast of the kind killed after accept (D-077). Applied to burl.boars, sq.ow.boars, the ch3 wolves and ch3b. Old accepted saves are seeded once from the dead set. quest-sim 73/73, 149/150 suites (the one failure is the known flaky wading alloc test), validate-content OK. Note: the Burl boar quest and ch3/ch3b objectives changed to a "kind after accept" count.
Walk-test: accept the Burl boar quest, then kill boars anywhere (woods, meadow, living-world boars); the journal counter goes up for each one.
Kills made before accepting do not count. Load an old save with the quest accepted and check the counter is sensible.

## OB-116 fb56d0ff - PO OK -> testing
Sword reach 2.2 (light) / 2.4 (hard), z band down to ~0.6 m below the feet, and terrain hits no longer count as walls. The Node test with a stub world shows every slope case HIT at 1.0-2.5 m and a miss at 3.2 m. Walls still block. 15/15 sword/combat suites. Browser/real-terrain check is an owner to-do.
Walk-test: swing at a boar about 2 m away on flat ground, uphill and downhill; the hit lands each time.
A boar 3+ m away is still missed, and a wall between you and the boar still blocks the hit.

## Owner walk list (http://localhost:8000/game/index.html)
1. OB-113: kill boars and goblins; a potion toast and a pack item appear, with no instant heal.
2. OB-115: accept the Burl boar quest, kill boars anywhere; the journal counts each one.
3. OB-116: swing at a boar 2 m away on flat, uphill and downhill ground; every swing hits, and 3+ m or behind a wall misses.
4. OB-114: at the meadow boulder by the stone wall, check the green is only on top, then say whether the faceting is OK (still open).
5. OB-118: Settings quality cycle shows a labelled Extreme.
6. OB-117: blocked until the main.js boot fix; then pick 4:3, reload, and the ratio must persist.
7. OB-103b / G2: cycle low to extreme on a meadow; carpet off on low, denser and farther higher up, soft far-grass glyphs beyond ~12 m, no ring.
8. PERF-R2P4: walk a forest; no visible tree pop at 15-20 m.
9. PERF-R4: Shadows set to ultra; far shadows look good and fps holds.
10. WM-01: cross band borders (strand -> keep); no hitches and no terrain change.
11. Main session owes: gpucompare (WM-01, R2P4, R4, G2 with D-039 re-baseline), bench-presets at ultra, verify-ob103b / ob117.
