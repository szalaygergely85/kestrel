# PO batch 2026-10-15c (PC-A, claims-only, nothing run)

Source: docs/test-reports/batch-review-2026-10-15-pca-E.md (arch verdicts final), lane entries in docs/lanes/pc-b1.md, D-107.

| Item | Verdict |
|---|---|
| NIGHT-SKY-01 (stars + moon) | PO OK (PC-A 2026-10-15c) -> testing. Arch ratified; probes exact, day untouched, stars proven on screen at 23h. The open NIGHT-HAZE-01 bug (bright far fog at night) is NOT a reason to reject. |
| CLOUD-FLUFF-01b/c/d (deck, day/night clouds, ground shadows) | PO OK (PC-A 2026-10-15c) -> testing. Arch ratified, probes exact. Owed (explicit owner/main-session to-dos): full `?gpucompare=1` after merge (default morning deck changes every terrain row), Intel-high GPU ms with the default deck. |
| WATER-FINISH-01b (GPU reflection + caustics) | PO OK (PC-A 2026-10-15c) -> testing. Arch ratified, rows present. Owed: bench on-off (<= 0.05 ms RTX / <= 0.12 ms Intel high), not recorded. |
| UNDER-04 / OB-191 bear den on the Northwood hillside | PO OK (PC-A 2026-10-15c) -> testing. Arch ratified, bearDen/regionalBeasts/chest suites PASS. OB-191 set to `fixed (PO OK 2026-10-15c) - owner to test` (bear den only; other EP-UNDER stories still planned). |
| CANOPY-SHAFT-01a (engine oracle only) | done (PO, no owner test). Oracle + WGSL strings exact, not visible in game. Note: CANOPY-SHAFT-01b is ARCH CHANGES (shaftForest frame-B rows fail), not part of this batch. |

## Owner walk steps
- NIGHT-SKY-01: wait for / set night (about 22:00-23:00): look up, stars and a moon should show and clouds should be dark. Known open bug NIGHT-HAZE-01: the far horizon fog band is still bright at night, so do not report that again.
- CLOUD-FLUFF-01b/c/d: at morning/noon look at the sky, then walk across open meadow: puffy cloud deck, and soft cloud shadows drifting over the ground; at dusk and night clouds should be darker/tinted, not white.
- WATER-FINISH-01b: stand at the Ford toward the far treeline: trees mirrored in the water; at noon look at the shallow bank: moving caustic light on the bed. Check frame rate stays fine.
- UNDER-04 / OB-191: go to the Northwood hillside bear den: find the entrance, check torch/lighting, no stuck walls, bear fight, chest locked until the fight is won.
