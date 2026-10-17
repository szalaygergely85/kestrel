# SIGNAL-ALIVE-TEXT — owner correction, 2026-10-18

The intro described the old distress rhythm while the actual signal already blinked Morse ALIVE. D-112 explicitly supersedes that rhythm and the draft name “Factor's Code.”

Updated intro slides 3–5, the keeper's log, the chapter journal, Signal Hill wake text, and both Rook blink counts. The word is ALIVE (`.- .-.. .. ...- .`), with thirteen marks; Maren taught Wick Morse with a shuttered lamp in the Factory. Updated the story source, current GDD signal paragraph, and design documentation to match. The existing light animation and renderer are unchanged.

Regression coverage extends the existing signal test to the intro, notes, relay text and Rook dialogue, rejecting obsolete descriptions and checking the correct word, counts, ASCII and caption limits.

- Focused signal/intro suites: 2/2 PASS.
- Full run: 1,056 suites — 1,052 PASS, 3 FAIL, 0 TIMEOUT, 1 optional typecheck WARN. All three failures passed their focused rerun (3/3 PASS); no product-code changes were needed for them.
- `passDecor` and `deathFade` allocation probes pass with `NODE_OPTIONS=--max-semi-space-size=64`. The generic runner forces `--expose-gc`, bypassing the decor test's own relaunch with that heap setting. Both test/product files are unchanged from HEAD.
- `meshPlace` compared canonical LF output with the Windows CRLF checkout of `world_m1.world.json`. Normalizing that local file to the LF bytes already stored in Git makes the test pass; `git diff --exit-code -- content/worlds/world_m1.world.json` is empty.
- Dependency check: `check-deps OK (2491 files)`, 89 existing warnings. Content validation: 25,323 checks PASS, no R19 or dialogue-graph hits. `git diff --check` passes.
- Real WebGPU browser check at 400x150: visible, yes — the corrected pale caption is readable against the dark intro image. Screenshot: `signal-alive-intro-2026-10-18.png`. No browser exceptions.
- Owner-visible text remains ready for PC-A PO review; the correction follows the owner's explicit request and existing D-112.

Separate requested media: the fourteen-second lake clip now has the original title-card glyph reveal, brass colours, subtitle, signal pulse and shine, using the game's title-card code. Portrait and landscape MP4s are local capture artifacts; no game code was changed for the video.
