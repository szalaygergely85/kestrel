# Test report BUG-OWN-005 – End of Chapter One card, exit/grate hints, restart re-arm

Result: PASS

Criteria:
- [x] End card text matches verbatim: `The signal is still calling.` / `Someone is out there.` / `- End of Chapter One: The Tower -` / `Thank you for playing.` (dim) / `[R] Play again from the wreck`, per-line colours distinct. Verified on screen at 240x90 after the end trigger fired.
- [x] `exit` hint (`Out there. Step through the breach.`) fires once on first entering the summit before the breach: fired at z=6.0 inside the `hintExit` circle, did NOT fire when tested below `zMin` (z=2.0) at the same x/y. Verified via `world.state['hints.shown']` and on screen at 240x90; hint mechanism (load/fire, no console errors) also confirmed at 160x60.
- [x] `grate` hint (`Something rattles above.`) fires once on the lever pull, via `world.fireInteraction('lever.pull', ...)`: `hints.shown` went from `[...]` to include `"grate"` after the call, `tower.lever.pulled` set true.
- [x] `quest.end` / end card fires from the `trigger:end` cell (world (1485.99,1025.63,6.0), tower origin (1480,1018,0) + level (5.99,7.63)): `quest.endT` started counting and the end card rendered after the walk+fade.
- [x] `R` restart re-arms everything: after pressing R, `hints.shown`→`["capture"]`, `hints.done`→`[]`, `quest.endT`→`-1`, `tower.lever.pulled`→`false`, world respawned at the wake pose; re-teleporting into the `exit` zone fired `"exit"` again.
- [x] `node game/js/quest/tower.test.js` → 90 passed, 0 failed.
- [x] `node game/js/ui/endCard.test.js` → 17 passed, 0 failed.
- [x] `node tools/check-deps.mjs` → OK (133 files).

Bugs: none found.

Performance: 240x90 grid ~17-60 fps (GPU path, varies with scene), 160x60 grid loaded and rendered fine. No stutters observed during the end sequence.

Console errors: none (checked via `read_console_messages` at both resolutions).

Suggestions (non-blocking): none.

Notes: pointer lock does not engage in the headless browser tool, so player movement/triggers were driven directly through `window.__debug` (teleporting `world.get(playerId).data.transform`, calling `world.fireInteraction('lever.pull', ...)` for the lever) per the task instructions, matching the precedent the programmer used in their own browser verification (port 9053). Tested from worktree `C:\dev\projects\game_project_test` at commit 205fc2f, own server on port 9065 (stopped after testing; port 8000 untouched).
