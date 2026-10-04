# US-119 cinematic playback and capture

PC-B, 2026-10-04. Gameplay and capture share the mesh render path. Capture frame zero is the initial scene; each later frame advances 60/fps ticks. Camera time comes from the integer tick count. Player physics, interaction, combat and HUD are disabled; water, cloth, prop animations and particles continue.

US-119a: 33 Node assertions cover key endpoints, Catmull-Rom positions, shortest yaw arc, smooth easing, pitch limits, validation and sequential fixed-tick stepping. Full runner: 206/206 suites PASS, dependencies OK. Real GPU: three presented frames, unchanged player transform, water tick 4, no page exceptions. Mesh route reaches the end trigger. Route launcher corrected to tools/serve.py.

NEEDS PC-A: timeOfDay has no clock/sun mapping until US-122 is specified. It fails explicitly rather than silently ignoring lighting. Paths must use an fps dividing 60, since capture requires integer fixed ticks. PC-A must author the showcase paths in design/cinematics; verification uses temporary test fixtures only.

Use `game/index.html?renderer=mesh&cinematic=<id>` for playback, add `&capture=1` for manual sequential `await __cine.step(i)`.
