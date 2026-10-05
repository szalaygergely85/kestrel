# TORCH-01a — 2026-10-05

Status: **arch-review**. Implements architecture.md 37.8's multi-handle foundation, keeping D-040/37.8a hand ownership separate from item handles.

The view-model layer supports four loaded handles, each with preallocated visibility, sampled pose, capture/blend source and bob amount. The bob phase is shared. `show` retains its signature; `hide(h)` hides one item and `hide()` hides all; `capture(h)` snapshots one item; `setBob(phase, amount, h)` optionally scopes the amount. Ordered draw items use `VM_OBJECT_ID - h`, and stats report the total. Both existing render twins consume the same list; no shader, GPU pipeline, DrawList or hand-mirror changes were needed.

Sword presentation and its hidden-state call in main.js now scope hide/capture/bob to the sword's handle. A null presentation handle returns safely. The new public `VM_MAX_HANDLES` export lets clients use the four-item bound. No torch content or game pickup was added; that remains TORCH-01b after the hand/inventory work.

Files: engine/render/viewModel.js + test; engine/index.js; game/js/quest/swordView.js + new test; one call in game/js/main.js.

## Validation

- Focused **329 checks PASS**: viewModel 72 (55 existing +17 added), sword presentation 19, sim 92, hand-param sword assets 124, pickup 22.
- The 16-pose one-handle matrix/raster SHA-256 remains `b16abe27bfe1d16803e12d7d91ef9bf66bdec1982d7e94e733355cb6d0e20d1f`, captured from the published implementation before this refactor.
- New cases cover two/four handles, independent poses/capture/blends, handle-order IDs, hide one/all, per-handle/shared bob, pure mount sampling and the four-handle load cap. Both JS-raster handles overwrite a wall 0.2 m ahead after the existing depth clear. The two-handle 1,000-frame test retains the existing <64 KiB heap gate and checks that all pose/capture/item/matrix buffers keep their identities; the original 20,000-frame allocation gate also passes.
- Full working tree **224/224 suites PASS**; isolated prospective commit **223/223 PASS**; zero FAIL/TIMEOUT/WARN. Includes typecheck and content validation. `check-deps OK`: 395 working files/1,305 advisory warnings, 394 isolated/1,303 warnings.
- Real-GPU mesh comparison: **71 rows byte-identical** to published ME-19b, including the seven unchanged known precision FAIL rows. No prior-PASS regression or threshold change. The capture helper now accepts mesh as its default after ME-19a, so the successful command omitted the obsolete `--variant mesh` argument.
- Real browser, GPU + CPU: a second probe item remains drawn while the untaken sword is hidden; after the real sword pickup, two ordered handles draw; hiding the second leaves only the sword. GPU object IDs 65535/65534 have 2,192/2,226 visible cells respectively. No runtime exceptions.
- Mesh route: **10/10 legs, end trigger reached**, 1,909 frames. Existing tower/tree/detail geometry remains present.
- Owned capture JSON deleted after recording results. Temporary browser/server processes were stopped by their own harnesses. No DDA rendering checks were run.

No spec deviation. The extra presentation test, VM_MAX_HANDLES export and main.js handle argument are integration work required by the spec. Developed in parallel with PROP-COLLIDE-01b0 using disjoint ownership; that item was separately committed/pushed as 5a67b55. Unrelated local Ruins/render/content edits are preserved.
