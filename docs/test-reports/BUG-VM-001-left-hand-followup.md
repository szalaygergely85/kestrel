# BUG-VM-001 left-hand follow-up — 2026-10-04

NEEDS PC-A: the architect's required hidden-sword non-K8 count remains nonzero at both permitted camera yaws. Decision C says to try 40 after 35, then stop and report. All sword implementation remains local and unpublished.

The programmer applied the prescribed mirror helper to REST and every animation key, leadEdge -x, bob.x and signed roll; sweepRtoL reverses the sim's hit-slice order, with the previous order retained when the flag is false or missing. ARC_BOUNDS is unchanged. The trail still follows mountEye; no engine runtime change was made. Four shear poses stay at yaw 30. Both pitched poses were tested at yaw 35, then the authorized fallback 40.

Focused checks: sword sim 73/73, model data 14/14, view model 55/55. Five old right-hand fixture expectations were updated to the prescribed mirrored positions/rotations, preserving the existing tolerances and orthonormal/screen-lock tests. Isolated prospective checkout: 217/217 suites PASS, typecheck PASS, check-deps OK (382 files). It includes master 564ec59 plus only the sword follow-up, excluding the unpublished Ruins implementation.

## Real-GPU results

RTX 4060 / ANGLE D3D11, mesh renderer, 160x60. All four shear view-model poses PASS with the mirrored sword (1/2/3/3 geometry-violation cells, all kind 8). Pitched yaw 35 / pitch 0 PASS with vmOk=true; pitch 20 has vmOk=true but FAILs parity: 28 geometry-violation cells, violNonK8=26, aoViol=26. The sword is visible in both twins.

| Hidden sword | Pitch | geomViolCells | violNonK8 | aoViol |
|---|---|---|---|---|
| yaw 35 | 0 | 0 | 0 | 0 |
| yaw 35 | 20 | 26 | 26 | 26 |
| yaw 40 | 0 | 1 | 0 | 0 |
| yaw 40 | 20 | 1 | 1 | 1 |

The hidden rows' general pass flag is true because compareGeometry.pass does not gate AO. That does not satisfy the separate explicit decision-C requirement, violNonK8=0. No threshold was changed and no later yaw was tried. The shown-sword yaw-40 capture did not produce a result; its owned browser/server process tree was stopped. No shown-yaw-40 parity claim is made.

The remaining yaw-40 / pitch-20 cell is index 1367, column 87 / row 8:

| Field | JS | GPU |
|---|---|---|
| kind | 1 | 1 |
| face | 4 | 4 |
| planeId | 67108885 | 67108885 |
| depth | 5.995643615722656 | 5.995977401733398 |
| AO distance | 3.482539176940918 | 0.9997844696044922 |

This is scene kind 1, outside the existing kind-8 tie allowance, and it remains with the sword hidden. NEEDS PC-A: the next permitted action for this AO mismatch / pose gate. No sword parity runtime fix, AO change, tolerance adjustment or additional pose relocation was invented.

Decision D's report-only BUG-MESH-TIE-001 row records the previously proven yaw-30 / pitch-20 non-K8 face-4/3 scene crease tie separately; there is no fix in this item. Browser servers used tools/serve.py on ports 9830–9870; no frozen DDA checks ran. Capture JSON/PNGs were removed; local diagnostics remain untracked under .codex.
