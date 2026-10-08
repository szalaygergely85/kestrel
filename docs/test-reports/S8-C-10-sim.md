# S8-C-10 crafting simulator step

## Result

New createCrafting(recipes,{items}) consumes host-supplied recipe data: [{id,inputs:[{item,n}],output:{item,n}}]. It uses the existing inventory countOf/removeItem/addItem functions and a private reusable 24-slot scratch pack. canCraft(inv,id) returns a read-only boolean; craft(inv,id) returns a cached frozen {ok,reason} (unknown-recipe, missing-inputs, output-full, or success).

Both paths copy the live pack to scratch, check all ingredients, consume there and require the entire output to fit. Failed crafts never change slots or hands, including when a partial output could fit. Capacity is evaluated after consumption, so freed ingredient slots are available. Success commits all slot fields and hands together while retaining the live slots array and individual slot objects. Existing removal order/stacking/empty-hand rules apply, including clearing a hand when its final ingredient is consumed; outputs do not auto-equip. No world/event/render/save layer or per-query state formatting.

Recipes/counts/referenced stack caps are validated and copied at construction: unique recipe ids/input item rows, nonempty inputs, positive safe integer counts/caps, known stackable items, and no pending-owner item rewards. Bad runtime inventory shapes/counts throw before live mutation. Unknown recipes refuse explicitly. The test recipes and balance numbers are fixtures only.

## Validation

Focused crafting PASS: missing partial ingredients preserve full inventory JSON; canCraft never mutates; unknown/repeated craft refusal; exact consumption/output; split ingredient stacks; same input/output item; full pack refusal; one freed slot plus two nonstacking outputs refuses without loss; two available slots succeed; retained array/slot identities; existing hand rules; copied config; duplicate/unknown/unsafe/pending/zero-stack/fractional/overflow definitions and malformed pack rejection. Actual World collectSave/applySave has byte-stable output and retains the crafted item. Same 600-step query/craft replay twice is deterministic across reused scratch. Existing inventory suite 62/62 assertions with GC PASS. Final full 315/315 suites PASS, zero FAIL/TIMEOUT/WARN; check-deps OK (558 files, 1,356 existing warnings). Final origin/master and origin/pc-a merges already up to date at c2fbe55; no code changed after the full gate. Diff check clean.

Pure simulator only: no owner-visible content change or screenshot/visibility claim. No production recipe or currency reward added, no engine/main.js/design edits. Owner world unchanged and excluded: SHA256 3A6EF838193922AFC30C0B7200FC7A78259B4796C06D1932AB128848BB5D3B40.

## Remaining story scope

S8-C-10 is partial: approved production recipe data and recipe-reference lint remain. NEEDS PC-A: supply first recipe ids, input/output items/counts and approved unlock/economy scope. Recommend defer production crafting recipes until their gameplay purpose/balance is authored (the queue explicitly places this outside M1); alternative approve a small recipe using existing material/tool ids and specify exact quantities. No food/weapon/currency recipe guessed. Once content is supplied, register that authoritative recipes.json in existing validate-content rather than creating another item database/linter. No production hook/UI is added in this sim step.
