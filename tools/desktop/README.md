# Electron disk-loading spike

This development tool opens the existing `game/index.html` from disk with
`backend=webgpu`. Electron is pinned to 44.7.0 (Chromium 152), above D-047's
Electron 32 floor. It adds no dependency to the browser game and builds no
release package. Install and run from this directory:

```powershell
npm ci
node node_modules/electron/install.js
npm start
```

The explicit install step downloads Electron's binary; it and node_modules
stay untracked. The launcher uses `.codex/desktop-profile` for its own save
profile, with Node integration off, context isolation and sandbox on. Windows
uses native WebGPU without unsafe flags; Linux adds `enable-unsafe-webgpu`
per architecture 38.7. Linux and macOS were not tested by this spike.

The current game loads and renders, but its browser `file://` notice covers
the window. The requested 400x150 grid also starts at 160x60. These are recorded
B1 follow-ups; this report-only spike leaves game/engine code untouched.

An automated probe runs in an offscreen window, refuses renderer HTTP(S)
requests and writes JSON plus two screenshots. From the repository root:

```powershell
node tools/desktop/node_modules/electron/cli.js tools/desktop --probe=.codex/desktop.json --profile=.codex/desktop-probe-profile
```

It checks disk content fetches, WebGPU device creation and the shipped save
adapter's write/read/delete in the isolated profile. Run twice with the same
profile to verify storage persistence across app exit; the second run removes
the probe marker. Any previous slot 2 value is restored. `desktop.png` records
the unmodified notice. `desktop-scene.png` is a diagnostic view ONLY: the probe
temporarily removes that notice and requests 400x150 through public
`engine.setGrid` at the existing roadSouth player pose. The normal launcher
does neither. No static server or debug port is needed.

Findings and release follow-ups: `docs/test-reports/EP-DESKTOP-SPIKE.md`.
