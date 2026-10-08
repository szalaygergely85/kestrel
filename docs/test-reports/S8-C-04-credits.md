# S8-C-04 Credits view step

## Result

New createCreditsView(inventory,{style:ASSETS.uiStyle.menu}) uses the supplied brass menu frame, opaque plate and colour tokens. The existing licence inventory's 1,111 files appear exactly once in the copied entry model, in source order, with group and complete path wrapped across cached pages. No publisher names or licence claims are inferred. The approved CREDITS / Third-party assets / Thanks for flying. / Esc back strings are adopted; Voxel assets by StickyBizcuit appears when that group is present and is omitted otherwise.

Arrow keys, PageUp/PageDown and Enter change pages, bounded at either end; Home/End jump. Esc emits a one-shot back action for the host. Build/input/snapshot are cold paths; draw reuses pages, formatted page counts and bounds. No storage writes, title/main/seam/engine/design edits or production boot wiring. The preview fetches the audit inventory; a future host passes its bundled inventory data directly, rather than requiring docs/ in the released game.

## Validation

Focused Node PASS: exact inventory coverage and uniqueness, copied immutable evidence, conditional attribution, opaque backgrounds throughout the frame, cached draw bounds, long paths spanning pages, boundary navigation, consumed/unknown keys, one-shot Back, empty inventory, duplicate/invalid entries, unchanged input inventory. Full 313/313 suites PASS, zero FAIL/TIMEOUT/WARN. check-deps OK (553 files, 1,356 existing warnings). Pre-push master/pc-a merges already up to date at c2fbe55; no code changed after the full gate. Diff check clean.

Real NVIDIA/lovelace WebGPU and RTX 4060/D3D11 WebGL2 at 400x150, physical Enter/ArrowUp/End/Esc verify paging and Back, zero browser exceptions. Repeat: node tools/verify-credits.mjs 9886 webgpu (or webgl2). Owned browser/server/profile cleaned after each run. Inspected captures/credits-webgpu.png and credits-webgl2.png: visible yes on WebGPU, cream attribution/file rows and gold frame/Esc readable against dark plate; no clipped frame or overlapping footer. **LOOK RISK / NEEDS B1:** the WebGL2 screenshot again omits the frame/title/footer and many text cells, including HTML controls outside the engine canvas, despite the same view data and passing input. Recommend compare live presentation, CPU UI and CDP compositor output; alternative retain explicit Arc owner-walk risk. No claim of WebGL2 visual acceptance.

## Remaining S8-C-04 scope

Credits is a separate reviewable step; S8-C-04 as a whole remains partial. Settings full-style adoption/options round trip and title subview integration remain. **NEEDS PC-A:** shadow values conflict: writer docs/story.md says off/soft/sharp, designer menu_ui.js says off/low/mid/high (mock mid), and existing options.js defines neither. Recommend explicitly adopt designer values off/low/mid/high and amend writer values to match; alternative amend designer data to off/soft/sharp. Their renderer mapping also belongs to B1's persistence/application story. Volume is already stored as 0..1 by platform/web.js while the writer/full-style slider is 0..10; retain storage units and map display by x10 in the Settings step. Do not silently invent a second Settings module or renderer behavior.

Title menu geometry/actions are unchanged in this step. NEEDS B1: production host loads inventory and mounts Credits through its title state machine; recommend route the supplied view's key/back contract, alternative defer title integration until that host seam lands. Existing title confirmation/icon capture risk remains explicit. Owner world placements unchanged and excluded: SHA256 3A6EF838193922AFC30C0B7200FC7A78259B4796C06D1932AB128848BB5D3B40.
