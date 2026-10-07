---
name: arch-batch-review
description: How to run kestrel's cheap batched review passes (architect opus batch of arch-review diffs, PO sonnet batch po-review) and write the verdicts into backlog rows. Use when several stories sit in arch-review or po-review.
---

# Batch review (token-lean; CLAUDE.md "Lean process")

**Architect batch (one opus agent, never fable for re-reviews):**
- Prompt names the commits (`git show <sha>`) and the exact doc sections (e.g. architecture.md 37.10); says "diff-only, run probes only if something looks wrong, do it yourself, don't delegate"; asks for **one line per item**: `ARCH OK -> po-review` / `ARCH CHANGES: <required changes>`.
- Checks: module boundaries (`check-deps`, `engine/physics/` stand-alone), JS-twin parity, zero allocs in hot paths, tests that would fail with the fix reverted, test runtime (< ~5 s each; the `run-tests` suite limit is 60 s), no threshold widening (D-039).
- It edits only the row status cells in `docs/backlog.md` (small local edits, no table reflow), uncommitted; main session batches that into the next commit.
- Skip items the owner is still judging by look (art); skip pure engine bugs for the PO.

**PO batch (one sonnet agent; opus only for new epics / owner-visible first reviews):**
- Claims-only: check each row's reported results against its ACs, run nothing. Output per item: `PO OK -> testing` + a 2-line owner walk-test, or `PO REJECT: <why>`.
- Gaps (e.g. an AC measured in the browser only) become explicit owner to-dos, not silent passes.

**Main session after both:** commit docs in one commit, push the branch, list the owner to-dos. One agent at a time (weekly limit).
