# AREAS-01: explicit quest-area references

`content/quests/areas.json` declares version-1 semantic aliases:

| Quest area | Existing target | Source |
| --- | --- | --- |
| breach | world_m1 / tower / point marker breach | tower.level.json markers.breach, placed by world_m1.structures[tower] |
| waystone | world_m1 / trigger end | world_m1.triggers[end], existing 2.5 m waystone circle |

The queue calls tower landmarks `landmarks.*`; the shipped level JSON calls
them `markers`. This table references that actual field through `{world,
structure,marker}`. Trigger targets use `{world,trigger}`. No coordinates are
copied, no runtime trigger is created, and no end/waystone behavior changes.

The existing content validator checks the version/table shape, safe alias IDs,
exactly one target kind, referenced world, unique placement or trigger, placed
level and finite point marker. Every quest area condition must name an alias.
Unused aliases are also checked, so stale targets cannot hide until a quest
starts using them. Targets are scoped to their world and placement rather than
an unqualified global ID search. Inline writer text remains unchanged per D-049.

`loadQuestFiles` loads the one root areas.json alongside recursive .quest.json
files and reports malformed alias JSON without dropping other quests. The CLI
passes both sources to validateContent. Runtime loading/emission belongs to B1's
gameHooks integration; this item adds data and lint only.

Focused validator suite and real-content CLI: PASS. Fixtures cover both target
kinds, missing table/alias/world/placement/marker/trigger, malformed version and
target, mesh placement, nonfinite/volume markers, duplicate IDs, world scoping,
unused bad aliases, scanner parsing and read-only validation (75/75 fixtures).
Initial full gate: 334 PASS, one content-smoke failure because the new standalone
JSON was absent from its exact file allowlist. Added only quests/areas.json to
that list; the validator already checks the file and references. Final full gate:
335/335 PASS, zero FAIL/TIMEOUT/WARN. Real content: content OK (3,425 checks,
zero findings, 3 existing mesh-only models). check-deps OK (590 files, 1,358
existing warnings). Final master/pc-a sync stays 4a7b655; diff check clean.
Owner world SHA256 stays 3A6EF838193922AFC30C0B7200FC7A78259B4796C06D1932AB128848BB5D3B40.

Owner-visible check: not applicable; no world, rendered content or runtime edits.
Owner world edits remain excluded. NEEDS B1: resolve the alias targets and emit
semantic area:entered IDs when gameplay wiring lands. Recommend consume this
table; alternative retain the current unwired quest simulation until that host
step. The separate pending owner decision on waystone TOUCH versus area events
is not decided by this reference table.
