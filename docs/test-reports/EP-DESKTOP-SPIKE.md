# EP-DESKTOP-SPIKE — Electron disk loading

2026-10-08 ARCH follow-up: dependency checker now skips nested node_modules,
with clean/installed/scoped-package and similarly named project-directory
fixtures. Installed Electron no longer expands the project's scan: check-deps
OK (521 project files, existing warnings). Full 305/305 PASS, zero
FAIL/TIMEOUT/WARN. No scanner rules or warning thresholds were relaxed.

2026-10-08, lane C, after merging PC-A/master 3989731 (WG-3f + WG-4a/4b). Report-only development
launcher under `tools/desktop/`; game and engine code unchanged. No release
archive, installer or third-party asset was generated or committed.

Observed runtime: Electron 44.7.0, Chromium 152.0.7977.130, Node 24.21.0,
Windows x64, NVIDIA GeForce RTX 4060. The WebGPU adapter reported NVIDIA/
lovelace, 128 color-attachment bytes/sample and successful device creation.
`rt.backend=webgpu`, `gpuActive=true`; no software-renderer override. Windows
needed no WebGPU flag. Linux's architecture-prescribed unsafe-WebGPU switch
is in the launcher; Linux/macOS were not tested.

| Check | Observed result |
|---|---|
| Direct `loadFile(game/index.html)` | World loads over `file://`, ES modules execute with Node integration off, sandbox/context isolation on. |
| Relative content fetches | Manifest and owner working world return 200, 2,144 and 50,495 text characters; the world is only read, never saved or bundled. |
| Offline boot | Renderer HTTP(S) requests blocked in the probe; world and WebGPU still load. No attempted HTTP(S) requests recorded. |
| Visibility on normal launch | **LOOK RISK:** the browser-only file-protocol notice covers the entire game, even though the Electron world has loaded. |
| Requested startup grid | `?grid=400x150` starts at 160x60: `createRenderer` still creates WebGPU at its CPU grid. |
| Public live grid change | `engine.setGrid(400,150)` accepted, applied, WebGPU remained active; no error log. |
| Save adapter | Shipped `createStorageAdapter(localStorage)` write/read/delete succeed; fixture slot 2 restored to its prior value. |
| Persistence | Probe marker read after Electron exit/relaunch with the same isolated profile, then removed. This tests platform storage, not automatic game-save wiring. |
| Logs | No error-level console messages; development CSP warning and existing voxel LOD build-budget warnings. |

Inspected screenshots: `captures/desktop-file-notice.png` (unmodified boot)
and `captures/desktop-file-scene.png` (diagnostic only). The latter is a real
WebGPU 400x150 view from the shipped roadSouth pose: x 1466, y 1035, yaw 240,
pitch 6. Visible: yes — tree trunks/branches, ground and sky render; cream
pause/settings text is readable on its dark plate. The diagnostic temporarily
removes the notice in memory and uses public setGrid; normal launch does
neither. Offscreen Electron rendering was necessary for reliable capture;
a hidden non-offscreen window initially captured a black canvas. This is a
probe capture limitation, not evidence of an engine rendering failure.

**NEEDS B1:** recommend a trusted desktop boot seam that handles the browser
file notice and honours requested WebGPU startup grid after pipeline readiness;
alternative use a secure standard app protocol for disk files and explicit host
setGrid. No C edit to `game/index.html`, `main.js` or render code. **NEEDS PC-A:**
recommend choose a stable app origin/profile and native platform save adapter
for EP-DESKTOP; alternative retain file origins for the development spike only.
US-089w automatic save/load hooks are still separate work. Changed install path,
native save-file backup/recovery and cross-platform storage were not tested.

Release packaging remains subject to US-112a's dependency/licence gate. The
working repo uses local/unverified packs; this private development run does not
grant redistribution rights or constitute a distributable demo.

Reproduce with `tools/desktop/README.md`. Raw JSON/profile files stay in ignored
`.codex/`; no static server/debug port was started. Owner port 8000 untouched.
Node syntax checks pass; final merged full suite 304/304 PASS, zero
FAIL/TIMEOUT/WARN; check-deps OK (710 files with local Electron dev dependencies
installed, 1,356 existing warnings); diff check clean. Owner world SHA256 stays
`3A6EF838193922AFC30C0B7200FC7A78259B4796C06D1932AB128848BB5D3B40`.
No game render change, gpucompare run or dda check in this story.

Primary references: [Electron stable releases](https://releases.electronjs.org/?channel=stable),
[loadFile, console events and capturePage](https://www.electronjs.org/docs/latest/api/web-contents),
[standard secure protocols for bundled files](https://www.electronjs.org/docs/latest/api/protocol).
