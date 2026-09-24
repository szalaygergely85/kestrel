# Retro evidence (main session notes, collected during sprints)

## Sprint 0 (2026-09-24)
- GLSL in JS template literals: backticks inside broke the shader module silently (US-006, twice) - `node --check` doesn't catch it; only a browser load does.
- New prop models broke 4 Node suites (WorldTextures, sectorAnim, serialize, triggers) that no one re-ran after US-011; found by the janitor's full run. Lesson: run ALL suites, not a hand-picked list.
- Programmers stopped with partial work several times (US-016 step 1 only, US-015 without GPU dim / browser check); reports sounded done. Lesson: list ACs not met explicitly; main session checks test counts.
- A programmer claimed "4 named tests added" when the count hadn't changed (US-007). Main session caught it by the unchanged test count.
- A tester delegated to a nested agent against the rule (US-015).
- A PO had no Bash and couldn't run tests / edit status once; main session patched the backlog.
- Port 8000 (owner's server) went down several times; stale browser cache showed old files (preview pages "broken" until cache-busted).
- Owner walk-tests found the most important issues (see-through props, camera-facing billboards, props shrinking up close, dark terrain, end trigger feels like a reset) that no automated check caught. Lesson: an owner walk-test belongs in every sprint review; gpucompare can't catch bugs shared by both paths (BUG-OWN-002).
- Good: architect reviews caught real bugs every time (JS/GPU mismatches, allocations, version collisions); small fixes applied by the architect directly saved a round-trip.
