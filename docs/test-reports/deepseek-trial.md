# DeepSeek PC-B trial - log

One line per trial item, per `DEEPSEEK.md`. Order taken from `docs/pc-b-queue.md`.

| Date | Item | Model | Peak/off-peak | Rounds needed | USD | Sent back by PC-A |
|---|---|---|---|---|---|---|
| 2026-10-06 | TOWER-BOULDER-01 | deepseek-flash (agent: DSH) | off-peak (00:13 CEST = 22:13 UTC) | 0 code-test failures. 1 environment retry: the first `capture-browser --mode gpucompare` timed out because a `route-walk-browser` run was still using the GPU; the same command run alone finished in 60 s. | owner: fill in from the DeepSeek dashboard | not yet (row is `testing`) |
| 2026-10-06 | ED-PLACE-BUG | deepseek-v4-pro (agent: DSH) | off-peak | 0 code-test failures. Root cause needed a live-browser repro (DOM `dispatchEvent` swallows listener exceptions, which hid the real `TypeError`); the fix itself passed its suites first try. | owner: fill in from the DeepSeek dashboard | not yet |
| 2026-10-06 | UI-XHAIR-01 | deepseek-v4-pro (subagent) | off-peak | 0 code-test failures; subagent pass reviewed by the main session. | owner: fill in from the DeepSeek dashboard | not yet (row `arch-review`) |
| 2026-10-06 | READ-01 | deepseek-v4-pro (subagent) | off-peak | 0 code-test failures; subagent finished all but noteRead.test.js, which the main session wrote (1 assertion fix). Main session also fixed a perf-test fake (`setGlyph`) and the crosshair size source (`rt.sx`). | owner: fill in from the DeepSeek dashboard | not yet |
| 2026-10-06 | US-079b0 | deepseek-v4-pro (subagent) | off-peak | 0 code-test failures. | owner: fill in from the DeepSeek dashboard | not yet (row `arch-review`) |
| 2026-10-06 | ED-DND-01 | deepseek-v4-pro (subagent) | off-peak | 0 code-test failures. | owner: fill in from the DeepSeek dashboard | not yet |
| 2026-10-06 | US-079b | deepseek-v4-pro (subagent) | off-peak | 0 code-test failures; main session added the missing `main.js` `boarFx.attach()` wiring. | owner: fill in from the DeepSeek dashboard | not yet (row `arch-review`) |
| 2026-10-06 | Quaternius imports (round-2 item 5) | deepseek-v4-pro (subagent) | off-peak | 0 code-test failures. | owner: fill in from the DeepSeek dashboard | not yet |
| 2026-10-06 | ART-01a (look + roof map, JS) | deepseek-v4-pro (subagent) | off-peak | 0 code-test failures. | owner: fill in from the DeepSeek dashboard | not yet (row `arch-review`) |

## Notes for this item

- The engine test coverage needed a test-only stand-in, because three suites (`engine/world/world.test.js`,
  `engine/world/scale.test.js`, `engine/physics/roller.test.js`) used the **real** tower boulder as their
  dynamic-prop fixture, including the ME-11b grid-vs-mesh roll-trace gate. Instead of a new fixture file the
  existing `tools/testing/dynamic-tower.mjs` (TOWER-LEVER-01) now re-adds the prop, so those suites are
  behaviourally unchanged.
- The gpucompare baseline was captured in a throwaway `git worktree` at HEAD and removed afterwards; the
  capture JSON was deleted. No repo history was rewritten, and no `stash`/`reset`/`checkout --` was used.
- Before this item the working tree was blocked by a Windows file-permission problem on the workspace root
  (DSH could not provision its write grant). The one bundled repair command fixed it; recovery files are in
  `C:\MyFiles\CodingProjects\kestrel-acl-recovery\`.
