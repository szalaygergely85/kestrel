# RECIPES-01: production recipe data and reference checks

PC-A's 2026-10-08 unblock queue authorizes three to five recipes using existing
items, as data only until a crafting UI exists. Three initial recipes are in
content/items/recipes.json:

| Recipe id | Inputs | Output |
| --- | --- | --- |
| torch.bind | 2 boar.hide + 1 brass.scrap | 1 torch |
| shield.rivet | 4 brass.scrap + 2 boar.hide | 1 shield |
| bow.bind | 1 torch + 3 boar.hide + 1 boar.tusk | 1 bow |

These quantities are the initial authored data for PC-A review, not a shipped
M1 economy. No new items, currency grants, unlocks, drop rates, UI, lore strings
or runtime crafting entry points are added. No recipe uses pending cog or the
touch-only hp/mp pickups.

The existing validator loads the one recipes file, checks every input/output
against actual inventory definitions with usable pack capacity and owner status,
and delegates recipe shape/quantity/uniqueness validation to createCrafting.
It reports item-specific paths alongside the simulator's schema findings.
The content smoke test allows this exact standalone JSON file; no manifest kind
or duplicate source was added.

Focused recipe, validator and smoke suites PASS. The new test uses actual item
definitions and every production recipe: missing ingredients refuse without
mutation; complete ingredients consume exact quantities and grant the specified
output without equipping. Broken item refs, pending/non-pack items, invalid
counts, empty/duplicate inputs, duplicate/unsafe recipe ids, bad file versions,
malformed/missing files and read-only validation are covered.

check-deps OK (591 files, 1,358 existing warnings); diff check clean.
Full repository gate: 336/336 PASS, zero FAIL/TIMEOUT/WARN. Previous S8-C-13
gate and isolated probe had the unrelated upstream passRaster heap failure;
the unchanged assertion passed in this clean working-tree gate. No renderer or
test bar changes. Real content: content OK (3,447 checks, zero findings, 3
existing mesh-only models). Final master/pc-a remains 4a7b655. S8-C-13 ships
separately as 5f3b1fb; no source code changed after this full gate.

Owner-visible check: not applicable, no runtime or rendered change. Production
world and design files are untouched. Future crafting UI/host must load the
version-1 recipes array and pass existing item definitions to createCrafting.
