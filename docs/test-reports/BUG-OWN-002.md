# Test report BUG-OWN-002 – Billboard props scale inversely with distance

Result: PASS

Fix under test: `engine/render/sprites.js` `SpritePool.project()` — `MAX_SCALE = 3` clamp removed, every LOD tier uses `scale = world.h*planeDistY/depth / lod.size.h`. Worktree `game_project_test` @ b4701c9.

Criteria:
- [x] Prop height (rows) grows monotonically as the camera approaches, 10 m → 1 m, no cap-induced shrink — verified by `sprites.test.js`'s "rect rows strictly shrink over 1/2/4/8 m" checks for lever, brazier and lantern at both 160x60 and 320x120 (81/0 passed, all "strictly shrink" and "never grow, incl. LOD switch" assertions green; the old MAX_SCALE=3 code fails these 11 checks per the architect's fix notes).
- [x] No sinking into the floor / no vanishing at close range — same suite; the old clamp caused the anchored-at-feet rect to sink and cull below screen (owner repro: lever gone at 2 m), the fix removes that failure mode; not reproduced.
- [x] No size jump up when crossing the LOD switch (small width step at the switch remains known/accepted per backlog note) — covered by the "never grow with distance incl. LOD switch" assertion.
- [x] `?gpucompare=1` 14/14 ALL PASS, incl. `world_m1: BUG-OWN-001 owner repro` and the crash-room/near-LOD scene with burner+lamp — re-ran live in browser (Chrome pane, d3d11 backend), confirmed 14/14 ALL PASS, all geometry/shading/light sub-checks 0 violations.
- [x] `node engine/render/gpu/sprites.test.js` → 81 passed, 0 failed.
- [x] No console errors in the live browser session (game/index.html, ?debug=1).

Bugs: none found.

Performance: not separately profiled (no code path affecting frame cost); debug overlay showed 14-37 fps in the Chrome automation pane (throttled/background-tab-sensitive environment, not representative of real GPU perf — see US-018 for real-GPU numbers).

Console errors: none.

Testing notes: attempted a live interactive walk (teleporting the player entity and `window.__debug.look` yaw/pitch toward `tower.brazier`/`tower.lever` and sweeping distance) to visually confirm in-game, but movement/pointer-lock is gated behind a genuine user gesture the browser-automation tool can't provide ("click to resume" stays active; `KeyW` held via `__debug.input._down` did not move the physics body), so a full manual approach-and-retreat sweep wasn't completed. Relied instead on the deterministic `sprites.test.js` coverage (which directly asserts the acceptance criterion: monotonic row growth over 1/2/4/8 m and no LOD-switch growth) plus the live `?gpucompare=1` 14/14 pass covering the same scene/entities. Suggest: if the team wants a literal walk-through next time, a small debug hook to bypass pointer-lock-gated movement (or a scripted camera-only mode) would make this reliable to automate.

Suggestions (non-blocking): none.
