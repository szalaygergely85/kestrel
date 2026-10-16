# Quest editor - owner target mockup (OB-214, 2026-10-16)

The owner pasted an HTML mockup (Tailwind, dark Material palette, mobile-tab shell titled "Quest Editor PRO") as "how it should be a quest editor". This file records its structure; the editor's Quest tab should reach this layout and density. Mock data in it (Elder_Gryff, Obsidian Sigil, Lua, XP, CHA checks) is placeholder, not canon.

## Shell
- Top bar: logo, "Quest Editor" + build/state badge, transport buttons play / pause / stop (run the quest in the live game), user avatar.
- Bottom tab bar: Viewport, Scene Tree, Inspector, **Quest** (active), Terminal.
- Palette: dark surfaces (#10141a .. #31353c), primary sky-blue (#8ed5ff), secondary amber (#ffb95f), tertiary green (#54e788), error (#ffb4ab); fonts JetBrains Mono (body/labels) + Space Grotesk (titles); compact 0.625-0.875 rem text, rounded cards.

## Quest context strip
- Quest id chip (`QUEST #Q_0104`), status chip (`VALIDATED` green / errors red), NEW and SIM buttons.
- Title (inline rename), version tag.
- Meta chips: TYPE (main / side), ACT/chapter, estimated duration.

## [01] Prerequisites chain
Rows with a tag, label and control, plus "n/n SATISFIED":
- `[LVL]` min player level with - / + stepper.
- `[REQ]` prior quest link (opens that quest).
- `[ITM]` required item, with a CONSUME checkbox.

## [02] Spatial topology
Two cards side by side, plus the zone:
- ORIGIN_NODE (START): giver portrait glyph, name, id, location name + X/Y/Z, trigger (e.g. ON_TALK 2.5 m).
- COMPLETION (TURN-IN): hand-in character, same fields, action on completion.

## [03] Objective pipeline
ADD_STEP button. One card per step: number, title, count (0/5), target id + location line, a thin progress bar. Step kinds seen: kill, retrieve item (READY check), interact/puzzle (TRIGGER_EVENT).

## [04] Conversation node
A terminal-style box: speaker, node id, the line in quotes; response branches below, each with its text, GOTO target or requirement, and the flags/unlocks it sets.

## [05] Reward matrix
XP and currency tiles, loot slots (item + rarity/quantity badge), a global flag / gate unlock row, and a scaling badge.

## [06] Actions + footer
Primary COMPILE button, then STEP_SIMULATOR and DIFF_CHANGELOG; a footer with size, target and error count (NO_ERRORS).

## Mapping notes (main session)
- COMPILE (Lua) -> our **Validate**: validate-content R-rules + the questRules / allQuests e2e for this quest. SIM / STEP_SIMULATOR -> run the quest through the real runtime (headless e2e step-through, then live in the game via liveSend).
- XP / CHA / level gates only where our rules have them (zone level bands D-020, stats from D-081, currency still an open owner question).
- Giver / turn-in must follow OB-156 / D-105 / D-106 / D-108.
