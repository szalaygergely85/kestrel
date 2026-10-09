# TITLE-MENU-02 (2026-10-09)

Owner-approved main card: New game / Continue / Load game / Settings / Credits.
Load game opens three save slots; empty/corrupt slots are grey and cannot load.
Enter/click emits {type:'load',slot}; Esc/Back returns to the five-row card.
Delete key/path/row/confirmation is removed. New-game slot choice and safe
Cancel-default overwrite confirmation remain; the view never changes storage.
Existing designer frame, colours, title treatment and hints are reused.
Load game wording comes directly from the owner's latest instruction.

Focused titleMenu and existing host tests PASS. Host test now selects Settings
by row ID, replacing an old fixed navigation count. Real NVIDIA/Lovelace WebGPU
400x150 physical Load sub-card/grey slot/Enter/Esc/Credits keyboard+click PASS,
zero exceptions. Capture credits-title-row.png (ignored): visible yes - all five
labels read clearly, no save slots on the main card, gold focus on dark plate.
Full runner: final 372/372 PASS, zero FAIL/TIMEOUT/WARN; initial 371/372 PASS (terrainStroke timing 170.3 ms > 150 ms), isolated terrainStroke PASS. check-deps: OK (652 files, 1,358 existing warnings).

NEEDS B1: consume {type:'load',slot} by reading that slot and booting/resuming it;
keep Credits/Settings modal returns active. Current master host lacks this action.
Continue chooses greatest meta.savedAt if provided. Current byte-stable save
adapter has no save-recency field; legacy fallback is first valid slot. NEEDS
PC-A/B1: recommend expose last successful save order/timestamp in adapter metadata;
alternative approve legacy first-slot fallback. No timestamp/storage changes
made without the requested ordering contract; no most-recent legacy-save claim.

No engine/render, game/main.js, design or production content changes. Owner world
untouched; fixtures memory only, own processes cleaned, 8000 untouched.
Settings style/graphics controls follow separately under SETTINGS-STYLE-01.
