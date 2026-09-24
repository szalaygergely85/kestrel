# BUG-LIGHT-002 test report

Date: 2026-09-24. Commit 185e7a6. Tested by the main session on the local server (port 8000, cache-busted).

- `?gpucompare=1`: 14/14 PASS, ALL PASS, with light compare now gating the result (incl. BUG-OWN-001 pose).
- `?gpucompare=1&sun=0`: 14/14 PASS, ALL PASS.
- Node: lighting 120/120, gpuCompare 35/35, check-deps OK (programmer + architect runs).

**Result: PASS -> done.**
