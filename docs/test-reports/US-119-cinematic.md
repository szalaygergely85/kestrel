# US-119 cinematic playback and capture

PC-B, 2026-10-04. Gameplay and capture share the mesh render path. Capture frame zero is the initial scene; each later frame advances 60/fps ticks. Camera time comes from the integer tick count. Player physics, interaction, combat and HUD are disabled; water, cloth, prop animations and particles continue.

US-119a: 33 Node assertions cover key endpoints, Catmull-Rom positions, shortest yaw arc, smooth easing, pitch limits, validation and sequential fixed-tick stepping. Full runner: 206/206 suites PASS, dependencies OK. Real GPU: three presented frames, unchanged player transform, water tick 4, no page exceptions. Mesh route reaches the end trigger. Route launcher corrected to tools/serve.py.

NEEDS PC-A: timeOfDay has no clock/sun mapping until US-122 is specified. It fails explicitly rather than silently ignoring lighting. Paths must use an fps dividing 60, since capture requires integer fixed ticks. PC-A must author the showcase paths in design/cinematics; verification uses temporary test fixtures only.

Use `game/index.html?renderer=mesh&cinematic=<id>` for playback, add `&capture=1` for manual sequential `await __cine.step(i)`.

US-119b: `node tools/capture-cinematic.mjs --cinematic <id> --port 9650` saves each presented PNG and GPU fg/bg cell data into git-ignored `captures/`. MP4/GIF encoding runs only when ffmpeg is available. `--compare a,b` captures both and encodes hstack; matching fps required, shorter path determines the comparison length. `--frames 3 --no-encode` runs a short probe. Existing output directories are rejected to preserve captures.

Full runner: 207/207 suites PASS, dependencies/typecheck OK. Node CLI/hash/export tests: 18 assertions. Permanent headless regression: set `CINE_BROWSER_PORT=9668`, then run `node tools/capture-cinematic.test.mjs`. Three cell hashes and PNG hashes match across two fresh real-GPU browsers; first/third frame cells differ, proving animation/camera progression. Single and side-by-side MP4/GIF encode successfully. Test output single video: 1280x780, three frames; comparison width doubles to 2560. HTML player browser verification: loads 9600 coloured spans, seeks to frame 3, plays from start and stops at the end. Generated camera data is removed after verification; showcase assets remain PC-A's responsibility.

Initial capture startup timed out intermittently; diagnostics now include page state and network/console errors. The expected optional design/local/voxel_pack.js 404 is retained as a diagnostic, not a capture failure. Both final deterministic and comparison browser checks pass. One full run flaked in the pre-existing meshStructures.render suite; isolation and subsequent full runs pass, with no engine changes.
