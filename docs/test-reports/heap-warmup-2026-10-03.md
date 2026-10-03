# Heap-test warm-up correction — 2026-10-03

The two recurrent allocation-test failures can be removed by warming the complete workload before the retained-heap measurement. Runtime engine code was not changed.

- `engine/fx/particles.test.js`: the old 2k warm-up exercised only sampleWind/step, while the measured 10k loop also called burstAt and hashInto. The identical 10k workload now runs through one reusable function for warm-up and measurement, including that function's JIT compilation.
- `engine/mesh/shadowList.test.js`: warm-up now runs the same 20k frame loop as measurement instead of stopping after 500 frames.

Both tests retain their **64 KiB** limits, original measured iteration counts and workloads. Particle live/recycling assertions remain in place. This result supports inadequate warm-up/JIT retention as the test failure cause; it is not a general proof that every runtime path is allocation-free.

Validation: particles **70/70**, shadowList **13/13**, followed by **three repeat runs of each: PASS**. Temporary negative controls deliberately retained 10k arrays during the measured window; both correctly failed their original heap assertion (particles +1,833,776 bytes; shadow +1,837,608 bytes). Negative-control files were removed.

Full runner: **199 suites, 198 PASS, 0 FAIL, 0 TIMEOUT, 1 WARN**. The remaining WARN is the existing typecheck diagnostic suite. Dependency check: **check-deps OK, 363 files, 1280 existing warnings**. No allocation threshold was relaxed, assertion removed or runtime library introduced.

This is a local verification fix submitted for PC-A review, prompted by the owner's request to find useful work through the blockers. It is not an architect approval. Under AGENTS.md's literal every-suite-PASS gate, the remaining typecheck WARN still prevents claiming the gate met. The prior resolved merge remains pending; no commit/push. The independent game-boot atlas overflow remains recorded for PC-A.
