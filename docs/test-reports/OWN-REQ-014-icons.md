# OWN-REQ-014 implementation verification — 2026-10-04

PC-B programmer implementation of architecture 36.3a-c. Status: NEEDS PC-A: PO review. These are developer checks; owner acceptance remains with PC-A.

- Focused Node cases: iconFit 12, iconRender 5, editor frame 24; all 41 PASS. Covers projected corner margins at 0.2/2/20 m, hash invalidation, queue budget, persistence failures, real lever/tower/variant mini-worlds and empty warmup world.
- Full runner: 209/209 suites PASS, no FAIL/TIMEOUT/WARN. Dependency check: check-deps OK (378 files; existing warnings).
- Fresh-profile headless Chrome, real GPU main editor, own no-cache server 9680: six non-empty 96x96 debug-strip icons; 78 of 79 Assets rows receive 48px images. Only ferrumLights keeps the specified ASCII fallback.
- Main viewport GPU foreground/background SHA-256 unchanged across icon work. Lever G-buffer contains only sky, floor and model cells, no wall/step surfaces. Lever and farTower images visually inspected.
- One icon per animation frame. Hidden engine setup 33.3 ms, glyph warmup 19.3 ms, empty-scene warmup 40.5 ms, slowest icon task 75.5 ms (boarPlaceholder); observed browser long tasks 86/62/55 ms. This is local-machine evidence, not a guarantee on every device.
- Same-profile reload hydrates all 78 cached images immediately. Real picker/import path produces a tiny .vox icon in 175 ms. Changed-file import and same-key registry rebind both produce different image URLs. No runtime exceptions.

Evidence retained locally under `captures/asset-icons-1791107566006/` (ignored): summary.json, editor.png and six individual icons. Browser/server processes started by this check were stopped.

Implementation details needed by reviewers: `force2d:true` avoids GL probing despite `gpu:false`; the editor frame's explicit `cpuMesh` opt-in enables the existing JS mesh twin. Initialization, ASCII masks and a blank scene warm up in separate visible-Assets rAF tasks. Numeric sprite containers use the engine's first-variant convention. Mini-world outside queries remain an open neutral floor. No engine, game or design files are part of this item.

NEEDS PC-A: ferrumLights is an angular horizon sprite without physical bounds; decide an icon treatment or provide dimensions. The existing .vox import names repeated files with a suffix rather than overwriting; that behavior is preserved. Changed imported definitions render distinct icons, and explicit same-key rebind invalidates the old cache. If acceptance requires replacement of the original row, PC-A must specify that UX.
