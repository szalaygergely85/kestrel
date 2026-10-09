# CREDITS-ROW-01 (2026-10-09)

The main title card now has Credits directly after Settings (row 23), using the
writer's title.credits label from docs/story.md. Activating it emits exactly
{type:'credits'} through the existing action API. Previous row IDs/coordinates,
confirmation/new-slot views and hints are unchanged; no host/bootstrap edits.

Validation:
- Extended existing titleMenu.test.js: full main-row order/coordinates, writer
  label, keyboard wrap to Credits + Enter, pointer click and once-only action.
  Existing new/load/settings/delete/corrupt-storage/styled-view checks PASS.
- Real NVIDIA/Lovelace WebGPU, scene 400x150: physical ArrowUp/Enter and mouse
  click both emit credits; zero exceptions. Screenshot credits-title-row.png
  inspected: visible yes - gold focused Credits readable on the dark plate,
  positioned below Settings with clear space before hints. Existing rows fit.
- Full runner: 372/372 PASS, zero FAIL/TIMEOUT/WARN.
- check-deps: OK (652 files, 1,358 existing warnings).

Repeat: node tools/editor/verify-credits-row.mjs 9880. Owner glance:
game/js/ui/titleMenu.preview.html?backend=webgpu, press Up then Enter or click
Credits; preview status displays credits. B1's CREDITS-MOUNT-01 host on pc-b
consumes the action; this story verifies the view/action contract and does not
claim that host integration is merged into master.

Only titleMenu.js/test, browser probe, report and lane status changed. No
production content, engine/render, game/main.js, design or backlog edits.
Original owner world edits untouched; memory-only saves, owned browser/server/
profile cleaned up, port 8000 untouched. Ready for PC-A PO review.
