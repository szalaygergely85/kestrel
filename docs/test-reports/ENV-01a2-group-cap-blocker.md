# ENV-01a2 group-cap blocker — 2026-10-04

Queue16 item2, architecture37.4. Programmer implementation and local checks completed, but canonical content cannot bind under the specified group cap. Code remains unpublished; default game wiring was removed to preserve boot. Complete implementation snapshots are retained locally in `.codex/ENV-01a2/`; scatterFeed source/test remain local untracked files.

Canonical world_m1 has17,003 detail placements:13,644 tufts,2,800 shrubs,559 rocks. Every one of42 speciesDefs is active; the same models occur in separate ground-type/layer entries. The specification requires one group per species. `bindDetailInstances` therefore throws `over32 groups` even without trees; with six tree groups,48 groups are required. This is a load failure, not a precision failure eligible for D-039.

**NEEDS PC-A: choose a scoped solution:** deduplicate compatible render groups by model/shadow/lodCells while preserving species indices and collider data, revise authored recipe to fit26 detail groups, or explicitly raise MAX_INSTANCE_GROUPS after checking its consumers. PC-B has not guessed a change to the32-group spec or silently dropped placements.

Completed local changes: bind-time master instance words/unique0x40000 IDs; nearest-tile radius/cap feeder; camera memo and force refresh; castShadow flag/skip;4096 instance cap; core load/unload integration; main flag/model-script/F3 feed counts; isolated detailWalkout comparison pose. No shaders or comparison thresholds changed. Focused feeder45 checks PASS, including20 brute-force eyes, exact words, caps/guards, no-write cache, force, unload and1000-frame heap gate (retained delta−5680 bytes). Instance55 and shadow-list16 assertions PASS; core binding26 checks PASS including detail lifecycle. Synthetic tests do not establish canonical game readiness.

Canonical browser oracle was stopped after the group-cap blocker was confirmed; no detailWalkout parity, screenshot, shadow-map result or GPU budget is claimed. Existing forest-only baseline retained locally. All tools' browser/server processes stopped; clean test worktree restored. After withdrawing default wiring, full working-tree checks226/226 PASS and check-deps OK; these verify the runnable published base plus local feeder tests, not the blocked integrated feature.

Next Queue16 item: TOWER-LEVER-01. Ground-detail draw step remains **NEEDS PC-A** pending the grouping decision.
