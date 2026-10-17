# PC-B recovery - 2026-10-17

Claude stopped at its weekly API limit. Recovery inspected its last local transcript, the main checkout and the four programmer clones. Existing screenshots, profiles and third-party source packs were left untracked.

## Recovered work

- Integrated the committed QD-01..09 quest changes, chest flag wiring, EV17-15 quest editor tools and CUR-01/02/03/05 currency work.
- Finished CUR-06: all player quests pay coins; seeded chest and beast coin drops reach the wallet. Duplicate death/claim events, full packs and restored opened chests are covered. Old Tusk and Greyback use the elite reward band.
- Finished QD-15a: Downs torch herder and Heath lockbox. Painted creatures now exist before the beast sim binds their IDs; missing IDs cannot steal another creature's slot. Night-only painted groups reuse the night spawner.
- Corrected the new fox kind to append after all 33 existing kinds. Regression assertions preserve legacy kind indices. Coin gain toasts show the amount actually added at the wallet cap.
- Repaired the coin browser verifier to enter play, wait for the graphics overlay, exercise the HUD fade, and capture HUD/inventory views at a 400x150 scene grid.
- Preserved the interrupted queue draft, marking its already-implemented EV17 rows and the approved currency decision so they are not started again.

## Verification

- Browser batch: 3/3 PASS; final post-bake GPU/route batch: **2/2 PASS**; gpucompare (NVIDIA) has only the four existing known-FAIL rows (crash room, signal tower, voxel half occluded, decorFord), no PASS-to-FAIL regressions. Route walk PASS. Opening chain 7/7 PASS, console clean.
- Coin browser verifier PASS: inventory 0 -> 7, HUD appears then fades. Real-GPU stills at a 400x150 scene grid: visible yes, gold Coin text on the HUD and inventory is readable.
- Heath still at (511.8,1360.2): visible yes, brown/iron chest stands out against green ground at about 2 m; browser console clean. Captures remain in the ignored captures directory.
- Full Node run: 1056 suites (1044 PASS, 11 FAIL, 1 optional typecheck WARN). All 11 failures were investigated: three stale fixtures (Wallow yaw, corpse lifecycle, coin reward), standalone trade config registration, four editor round-trip checks, stale GI bake, fox placement clearance, and region-save determinism. After the fixes, the combined verification rerun is **39/39 PASS**, including every one of those 11 failing suites, content validation and GI freshness. No required suite remains failing; the optional typecheck warning is retained.
- Editor fix: preserve CRLF/mixed separators and unknown pack metadata; no-op saves and undo keep exact bytes. Focused editor folder: 19/19 PASS.
- Save determinism fix: exact painted creature IDs are excluded from restored authored-home avoidance. Regional beast suites: 2/2 PASS; save sweep: six regions, no failures. The sweep now drives each real elite/chest objective.
- Fox spawn homes moved to nearby verified clear ground; meadow clearance/walk-through check PASS. GI is re-baked from the final world input (five pinned zones, hash `06e24cb592c3`).
- `check-deps OK` (2491 files; existing warnings allowed). `coin-lint`: 0 errors, 0 warnings.
- Coin HUD caches its label and interpolates RGB without allocating a closure on each draw.

## Follow-up decisions resolved (D-122)

- The owner delegated the QD-15 choices after this recovery. D-122 approves real bat/wisp asset production, inventory-free horn/rope chest facts, and a two-quest Strand delivery/return chain using supported goblin archers. The implementation queue and quest specification carry these choices; they no longer need PC-A approval. These follow-up features are not implemented by this decision-only change.
- CUR-04 trade screen was not started by the interrupted agents. CUR-03 trade data/logic is integrated; its UI remains the next currency item.
- The separate sky-haze branch and parked flicker experiments were not part of the interrupted quest/currency batch; their existing owner-look/architecture requirements remain.

Recovered content awaits PC-A PO review and the owner walk-test. Quest-side simulation changes await technical review; this recovery does not claim ARCH OK or PO OK.
