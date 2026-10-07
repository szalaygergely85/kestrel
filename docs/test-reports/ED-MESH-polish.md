# ED-MESH-01 polish

The inspector retains an explicit `castShadow: true` when its mesh asset defaults to false. Previously canonicalisation deleted that override and the next load turned shadows off again. True flags still inherit when the asset default is true. Existing false flags remain unchanged.

The collision control reflects an asset's hard collision-off gate and cannot offer an unsupported enable action for that asset. The inspector explains that placement collision edits save correctly but await gameplay support: `World.load` passes the shadow flag into `placeMesh`, but does not retain the authored collision flag on the runtime placement. `buildWorldColliders` therefore cannot see it. No engine files changed.

README and H-help describe actual geometry during Move drag, release/Escape, and mesh scale availability. No authored content changed.

Focused meshPlace/meshPanel suites pass. The shadow regression exercises the actual public `World.placeMesh` API with an asset-default-off mesh and the edited override. DOM fixtures check default-off shadows, unchanged inputs, edited flags and the unavailable collision control.

Physical browser: NVIDIA RTX 4060 / ANGLE D3D11, grid 400x150. Actual rendered checkboxes preserve shadow true against asset false; runtime reload and undo/redo agree. Collision edits and undo/redo preserve authored flags. A separate mesh-physics load exposed the loader gap described above; collision gameplay is not reported as passing. Screenshot `captures/ed-mesh-polish.png` inspected: rock geometry large and clearly visible, inspector checkboxes and collision support note readable. H on the focused canvas opens `helpOn`, but the overlay text is absent in the GPU screenshot: **LOOK RISK: help overlay visibility remains unverified**, despite the updated text/state. Recommend B1 checks overlay presentation; alternative keep the README/inspector as the visible guidance. Probe edits remain in browser memory only.

Validation: **284/285 PASS, 0 FAIL/TIMEOUT, 1 WARN**. The warning is `tools/typecheck.mjs`: upstream `engine/mesh/shadowList.js:72` passes an xy fallback where the declaration requires xyz (TS2741). That exact code is present in `origin/pc-a` at 99153a9; no editor type diagnostic. check-deps OK (497 files, 1311 existing warnings); diff-check clean. Owner world file remains SHA256 `3a6ef838193922afc30c0b7200fc7a78259b4796c06d1932ab128848bb5d3b40` and is excluded from the commit.

**NEEDS B1:** recommend retain the authored placement collision flag through `World.load`/`placeMesh`, with a load/undo/reload fixture that excludes and restores that mesh's collider part. Alternative: keep the editor's explicit pending-support notice until that seam lands. Lane ownership is defined in `.claude/skills/parallel-lanes/SKILL.md`: "Needs a `main.js` or engine change -> write `NEEDS B1:` in its lane file."
