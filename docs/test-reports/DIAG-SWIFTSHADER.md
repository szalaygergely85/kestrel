# DIAG-SWIFTSHADER — PC-B diagnosis, 2026-10-07

The PC-A `chrome-error` crash did **not** reproduce on PC-B. The full game loaded all three presentdiff poses with the existing launch flags, reached `window.__debug.engine`, and completed the WebGPU presenter harness. A direct `?backend=webgpu&gpu=0&pose=crash` boot also succeeded. No capture flag fix is supported by this evidence; `tools/capture-browser.mjs` and gate thresholds are unchanged. The original crash's cause remains unconfirmed and needs PC-A evidence.

## Configuration and method

- PC-B: Windows 11 Pro 64-bit, version `10.0.26300`; NVIDIA GeForce RTX 4060, driver `32.0.16.1088`.
- Binary: `C:/Program Files/Google/Chrome/Application/chrome.exe`.
- CDP `Browser.getVersion`: `Chrome/154.0.8037.98`, revision `@b859317bf11f6be47f9b7799ec690a0a42a1fb33`, V8 `15.4.80.20`.
- Fresh temporary browser profile per run. Own HTTP port 9590, CDP port 9591; only those spawned processes stopped. No capture JSON/PNG files were written into the tracked captures directory.
- Existing `buildLaunchFlags({mode:'presentdiff', backend:'webgpu', swiftshader:true})` returns `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`. These select Dawn's SwiftShader adapter; they do not force ANGLE/WebGL to SwiftShader. Presentdiff deliberately loads its CPU oracle with `backend=webgl2&gpu=0` and builds a second WebGPU canvas.
- Diagnostic run used `CAP_LOG=1`, the same launch flags, and Chrome `--enable-logging=stderr --v=1`. Other flags: `--headless=new --remote-debugging-port=9591 --user-data-dir=<fresh temporary profile> --no-sandbox about:blank`.
- Recorded page navigation/load, console, exception, and `Inspector.targetCrashed` CDP events, plus Chrome stderr. Used the capture tool's query, pose list, CDP helpers, and the actual `game/js/dev/presentDiff.js` harness. Then repeated the unmodified `runLiveCapture` path without extra Chrome logging flags as a control.

The normal command to repeat the control is:

```powershell
$env:CAP_LOG='1'
node tools/capture-browser.mjs --mode presentdiff --swiftshader --backend webgpu --port 9590 --timeout-ms 120000
```

The local diagnostic wrapper and evidence are ignored scratch artifacts: `.codex/pcb-swiftshader-diag.mjs`, `pcb-swiftshader-presentdiff.log/.json`, `pcb-swiftshader-presentdiff-chrome.log`, `pcb-swiftshader-boot.log/.json`, `pcb-swiftshader-boot-chrome.log`, and `pcb-swiftshader-capture.log`. The wrapper reproduces the logging run; it writes no permanent capture assets.

## Measurements

Every pose was 160×60 cells, rendered into 1280×780 pixels (998,400 pixels). Each reported the adapter `{vendor:'google', architecture:'swiftshader', description:'', fallback:true}` and `gpuErrors:[]`.

| Pose | Distinct glyphs | Exact pixels, logging run | Exact pixels, unmodified capture control | Within 2 | Max channel difference | Pixels over 2 / bad cells |
|---|---:|---:|---:|---:|---:|---:|
| crash | 31 | 98.8322% | 98.8759% | 100% | 1 | 0 / 0 |
| brazier | 32 | 98.7632% | 98.8081% | 100% | 1 | 0 / 0 |
| roadSouth | 25 | 99.1702% | 99.1702% | 100% | 1 | 0 / 0 |

The unchanged strict presentdiff criterion requires at least 99.5% **exact** pixels, so these are three FAIL rows despite every pixel differing by at most one channel value. This is a measured presenter parity failure on this configuration, not a reproduced tab crash. This diagnosis does not establish the source of that one-value difference.

Logging-run stage sequence for each pose: `Page.loadEventFired` → game URL retained → `window.__debug.engine` available, backend `gl2` → harness called → pose result returned. Across that run: zero `Runtime.exceptionThrown` and zero `Inspector.targetCrashed` events. Chrome stderr had no FATAL, Check-failed, GPU-process-exit, or GPU/Dawn error lines. Chrome emitted extension-registry, GCM registration, and updater errors while all poses completed; those logs do not establish the reported PC-A crash's cause.

Direct WebGPU control: `?backend=webgpu&gpu=0&pose=crash` retained its game URL, exposed backend `webgpu`, 160×60 cells, the same SwiftShader adapter and `gpuErrors:[]`. Zero page exceptions or target-crash events; no fatal/GPU-process-exit/GPU/Dawn error lines.

## Required PC-A follow-up

Shipping checks after merging PC-A `1a2f092` / PREC-04b1: 263/263 Node suites, `check-deps OK` (462 files, 1,309 existing warnings), content validation 3,233 checks. The same-machine WebGL2 gpucompare baseline improved from 124 PASS / 20 FAIL to 137 PASS / 7 FAIL; no PASS-to-FAIL rows. This precision improvement is PC-A's work and does not resolve the separate SwiftShader presenter parity failure or establish its crash cause.

NEEDS PC-A: provide the original failing Chrome binary/version, complete launch flags, last page stage/URL, and Chrome `--enable-logging=stderr` output alongside `CAP_LOG=1`. Recommend comparing the same version and flags on PC-A, because the current PC-B configuration reaches every harness and gives no crash stack; alternative: reproduce using PC-A's original failing binary and preserve its stderr/CDP crash evidence before updating it. Until that evidence exists, neither an Intel-driver cause nor a SwiftShader flag cause is justified. This story's crash-cause acceptance criterion remains open.
