# Batch review 2026-10-08 (lanes B + C)

Kept in its own file so no backlog conflicts arise before the merges; copy verdicts into the rows at merge time.
Sources: `origin/pc-b` (+pc-b2), `origin/pc-c`.

## Architect verdicts
| Item | Verdict |
|---|---|
| WG-2b, WG-2c, WG-3b, WG-3c | ARCH OK -> po-review (carry-overs landed in PC-A 92b2133) |
| WG-3d (sun shadow map) | ARCH OK -> po-review |
| WG-3e (water) | ARCH OK -> po-review |
| WG-3f (sprites + overlay) | ARCH OK -> po-review. Nit: `rendererString` still says "WG-3d". Owner to-do: check `drawEyelid` wake blink under WebGPU (CPU writes to `rt.cells` hidden when `frameComplete`). |
| WG device follow-ups (83723d5) | ARCH OK -> po-review |
| WG-4a part 1 | ARCH CHANGES (B2): (1) `WgCullPass.run()` allocates per frame via `argsCpu.subarray` - cache view, rebuild when `_nextSlot` changes; (2) `setStatic(group)` before `add()` keeps only one group in `_pendingStatic` - use a Set or throw. |
| GFX-01a | ARCH OK -> po-review (GFX-01w main.js wiring + settings whitelist go to B1) |
| US-096a | ARCH OK -> po-review |
| US-089a | ARCH OK -> po-review |
| US-112a | ARCH CHANGES (C): `tools/demo/build-demo.mjs` top-level `import ts from 'typescript'` fails without node_modules -> dynamic import like `tools/typecheck.mjs`; test prints SKIP + exit 0; CLI says "npm i first". |
| MAP-01b | ARCH CHANGES (C): `tools/bake-chart.test.mjs` 35.7 s -> keep fixture bake, determinism, input-hash `--check` in default suite; move full world_m1 rebake/freshness to `node tools/bake-chart.mjs --check --index` at merge time; document "edit world_m1/terrain -> rebake" in `tools/editor/README.md` + lane file. |
| ED-MESH-01 help/viewport | ARCH OK -> po-review |

## Merge order
pc-b first (gpucompare: WebGPU = WebGL2 140/6, no PASS->FAIL), then pc-c after US-112a + MAP-01b fixes (else run-tests red on PC-A). No shared files between the lanes.

## PO verdicts
PO sonnet, claims-only, nothing run. CAVEAT: this session had no git/Bash, so `origin/pc-b` / `origin/pc-c` rows and reports could not be read. ACs come from the local `docs/backlog.md` rows and `docs/lanes/*.md`; the lanes' reported results for these items were NOT seen. Verdicts rest on ARCH OK plus those ACs and are provisional until the main session confirms the reported results match.

| Item | PO verdict | Owner walk-test (2 lines) |
|---|---|---|
| WG-3d sun shadow | PO OK -> testing (provisional) | Open `?backend=webgpu` (or the WebGPU toggle) next to WebGL2 on `?pose=towerShadowGrass` and a forest pose: sun shadows of tower/trees must be present and match WebGL2.<br>Walk 20 s: no shadow flicker, no acne stripes on slopes. |
| WG-3e water | PO OK -> testing (provisional) | WebGPU, stand at the world_m1 pond and the river: water colour, shimmer, edge foam and the below-surface tint look like WebGL2.<br>Walk in and out of the water; no missing or inverted water plane. |
| WG-3f sprites + overlay | PO OK -> testing (provisional) | WebGPU: fire, particles, HUD hearts/mana, prompt text and F3 overlay all draw and are readable.<br>Check the wake-up eyelid blink (`drawEyelid`) under WebGPU (architect to-do). |
| GFX-01a presets data (resolver only) | PO OK for the data/resolver step only; settings UI + wiring + full gate still open (lane log: 'UI/wiring and full gate remain open') | No walk-test: Node test only. Row stays open until GFX-01w / settings UI land. |
| US-096a quest flags + objectives (sim) | PO OK -> testing (provisional) | No in-game view until US-096w: run the quest Node test and confirm the 600-step replay hash is stable.<br>Open `content/quests/m1.quest.json`: chain wake -> lantern -> breach -> sword -> 2 beasts -> waystone, placeholder texts (writer pass still owed). |
| US-089a save data (sim) | PO OK -> testing (provisional) | No in-game view until US-089w: run the save Node test, byte-stable round trip, `saveVersion: 1`, localStorage and in-memory adapters.<br>Confirm saved fields cover player, hearts, mana, inventory, hands, flags, chests, beasts. |
| ED-MESH-01 help/viewport | PO OK -> testing, with a LOOK RISK | Editor: select a placed rock, drag it; the real mesh stays visible and the release matches the preview (undo and Esc restore it).<br>Press H on the focused canvas: the help text MUST show on screen (the lane log says it did not appear in the real-GPU capture). |

## Owner to-dos (not verified headless or in a browser)
1. WebGPU vs WebGL2 visual side-by-side for WG-3d/3e/3f (shadows, water, sprites, overlay). Gate numbers are gpucompare only (WebGPU = WebGL2 140/6); no human look yet.
2. `drawEyelid` wake blink under WebGPU (CPU writes to `rt.cells` hidden when `frameComplete`).
3. Editor H help overlay visibility, and the placed-mesh drag look (gold corner marks were "thin" in captures).
4. GFX-01a: data only; settings Quality row and rendering effect come with GFX-01w.
5. US-096a/US-089a have no player-visible effect until the B1 hooks US-096w/US-089w; objective texts still need the writer.
6. Nit for B1: `rendererString` still says "WG-3d".
7. Main session check done 2026-10-08: WG-3d/3e/3f rows + test reports exist on origin/pc-b; GFX-01a, US-096a, US-089a, ED-MESH-01 have 'ready for review' entries in docs/lanes/pc-c.md (their backlog rows still say todo -> update at merge). PO verdicts confirmed; GFX-01a narrowed to data step.
