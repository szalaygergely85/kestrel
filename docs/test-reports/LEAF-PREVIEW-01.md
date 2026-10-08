# LEAF-PREVIEW-01

Standalone `game/leaf-preview.html?backend=webgpu` draws the existing alphaLeaves
checkerboard fixture through public engine exports. The soft-edge button selects
the shipped ALPHA-01d soft-test materials or their original leaf materials. The
distance button uses the existing 6 m / 30 m eye poses at 1.6 m height. WebGL2
is explicitly labelled opaque by design. This is a test fixture, not authored
tree content or a change to production leaf materials.

Run `node tools/verify-leaf-preview.mjs 9886` for both backends. The harness starts
and cleans up its own server, browser and profile; saves captures under the
ignored `docs/test-reports/captures/` directory.

Real GPU: WebGPU NVIDIA/lovelace, complete cell pipeline; WebGL2 NVIDIA GeForce
RTX 4060 / ANGLE D3D11. Both use 400x150 scene cells. Physical mouse clicks
toggle soft edges and distance; resolved geometry is nonempty; no browser
exceptions. GPU harness PASS.

Visible: yes - inspected `leaf-webgpu-soft.png`, `leaf-webgpu-hard.png`,
`leaf-webgpu-far-hard.png` and `leaf-webgl2-soft.png`. Dark green cards and their
cutout holes are clear against the blue sky at 6 m; labels are readable. At
30 m the fixture is appropriately smaller. Soft-edge appearance changes are
subtle; owner/PC-A look approval remains separate from this harness check.

Initial captures were blank because the newly created UI layer had not been
cleared; the standalone frame now clears the UI and overlay before presenting.
Canvas sizing uses the public resize API with the space below the controls.

Validation: full suite 334/334 PASS, zero FAIL/TIMEOUT/WARN; check-deps OK (588 files, 1358 existing warnings).
No engine, game main, design or production world changes. Final sync with
origin/master and origin/pc-a fda08fa was already up to date.

Ready for PC-A PO review. QUAT-TREES-01 remains dependent on ALPHA-01e and
the authored species data; this preview does not waive that dependency.
