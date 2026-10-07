# EDITOR-LOAD-01: visible editor startup (PC-B, 2026-10-07)

The reproduced failure was a missing `?world=` id. The editor's top-level module rejected during asset/world initialization before `createRenderer`; no outer boot handler updated the initially blank status/gate or the `(loading...)` outliner. That left a silent placeholder indefinitely.

The original built-in browser delay of about ten seconds was not reproduced. Chrome 154 baseline boots completed in 5,304 ms on WebGL2 and 3,921 ms on WebGPU without page exceptions. These measurements do not establish pane throttling, a renderer regression, or why manually importing the module appeared to help the original session.

A classic `boot.js` runs before design scripts and creates one cached dynamic-import promise for `main.js`. Dependency-import and top-level-await failures now show the current stage and error in the existing gate, outliner and status, and log the exception. Stage logs cover design assets, module import, content fetch, asset/world initialization, renderer initialization, scene setup and ready. A pending boot after ten seconds displays its current stage without treating it as failed. Success cancels that timer and preserves an existing backend gate. There is no retry or forced re-import.

Focused VM tests execute the actual classic bootstrap with a deterministic clock and minimal DOM: single importer call, dependency rejection before main executes, asynchronous initialization rejection, synchronous importer exception, stage logs, slow pending notice, timer cancellation, populated-outliner preservation through pending/ready, and backend-gate preservation. Pending writes only the status and gate so a tree already built before asset-folder loading completes keeps its DOM and handlers. Focused tests PASS; check-deps OK (464 files, 1,309 warnings).

Main-session browser validation used Chrome 154 on RTX 4060. WebGL2 at the actual 400x150 grid reached the ready stage in 4,812 ms; the 7,398 ms probe measurement also includes the first GPU frame. WebGPU reached ready in 2,022 ms and preserved the existing WebGL2-only editor gate. The unknown-world case reached failed at asset/world initialization in 624 ms probe time, with its descriptive error visible in gate, status and outliner and zero page exceptions. The renderer stage took 54 ms on WebGL2 (820→874 ms) and 625 ms on WebGPU (611→1,236 ms); scene setup dominated the WebGL2 boot.

Visible: yes — the main session inspected normal and failure screenshots; the scene/tree are visible, and the white failure stage/message is readable on the dark viewport.

Remaining uncertainty: the original built-in browser delay requires a reproducible session or a timing trace. This change makes future failures and slow stages observable; it does not claim a startup performance fix.

Final checks: 264/264 Node suites PASS; `check-deps OK` (464 files, 1,309 existing warnings); content validation 3,233 checks. A real-GPU delayed asset-folder fetch (11.5 seconds injected by the browser harness) displayed the pending stage and then reached ready. The existing 59 outliner nodes remained present throughout; the pending gate cleared on success. Screenshot inspected: visible yes, pending stage readable against the dark viewport.
