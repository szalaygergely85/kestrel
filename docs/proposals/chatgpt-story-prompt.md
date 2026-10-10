You are the lead writer for "Kestrel", a first-person 3D action-adventure (Zelda-like) rendered entirely in coloured ASCII characters. Write ALL story text for the first chapters, following the canon and rules below exactly. Output only what is asked, in the formats given.

## Canon (do not change)
- World: the Emberlands - hills, forests, moss-grown ruins and old magic. Alive and wild, not dead.
- Ferrum: a walled, tiered city of stone, timber and machines only (brass, steam, gears). The Crown (upper tiers) keeps the airships, gear-gates and lamps. The Low Wards haul coal, grease cogs and mend rope, and are forbidden the machines they maintain. Magic is a myth in Ferrum, a children's tale; talking about it loudly gets you fined. The Wall Law: nobody leaves; beyond the Wall is "NOTHING".
- The signal: a repeating SOS light blinking far beyond the Wall (3 short, 3 long, 3 short), echoed by a hum in old relay stones under the Low Wards. The Crown denies it.
- Hero: Wick, a young Low Ward skyworks hand who trims lamps and patches Crown balloons. Real name, remembers everything, curious, braver than sensible, does NOT believe in magic at first. First person, never seen, speaks rarely (short lines).
- The Kestrel: a small brass Crown patrol airship Wick stole after pencilling the signal's bearing onto a stolen Crown sky-chart. The Wall ballistae shot it down; it crashed into a ruined round tower (the Hollow Watchtower, an old signal relay).
- The chart: a printed Crown sky-chart that says "BEYOND THE WALL: NOTHING", with Wick's pencil line running past it to the signal through a line of old relay towers, signed "W.".
- Relays: old brass-and-mirror mounts with aether-crystal bowls, older than the Wall. Dead relays can be woken; a woken relay hums, heals, saves, and becomes a travel point (waystone). Core loop: follow the pencil line from relay to relay toward the signal.
- Magic: Aether, a magic of light fed by aether crystals - real outside the Wall. Wick learns it: talking animals first (gentle proof), then the exiles give him an artificer's gauntlet (brass, empty crystal socket) and SPARK jumps from his fingers (first spell, end of his disbelief). Later spells GUST (push/jump) and WARD come from gauntlet crystals found in ruins or won in dungeons, never bought.
- The exiles: people Ferrum cast out and swore had died. Their village is on the west bank of the river (working name "Outwall" - you may propose a better name). They are the first to call him "Wick".
- Already written characters: BURL, an old talking bear in the meadow below the tower (warm, dry humour, calls Wick "sky-cub" / "cub from the loud hill", loves blue berries). Burl gives the first quest "Boars in the Berries" (kill 5 boars on his berry slope; no item reward). The meadow stone is "The Waystone"; the first road relay is "Bend Relay".
- Tone: curious, defiant, wondrous - "I broke out, now what is out here?" Warm lamplight and brass against cold, vast, overgrown ruins and the teal of magic. No modern words, no jokes that break the world.

## World plan to write for (stages along the pencil line, west of the tower)
1. Road west to the bend: Bend Relay (wake it).
2. River crossing: a ford/crossroads, relay #2.
3. The exile village (west bank): relay #3, NPCs, the gauntlet + Spark.
4. North bank: the first small dungeon area (a tool opens it: the torch; 3-5 rooms, a small key, a mini-boss, reward = the tool or a gauntlet crystal).
5. Signal-tower hill: the approach to the Signal Source (do not reveal who is calling).

## What to create
A. Quest list: 6-10 quests across stages 1-4 (main + side), each with: id (lower.dot.case), title (<= 24), giver (NPC id or "auto"), stage, short summary, steps (2-5 objectives of these types only: go to area / kill N creatures / pick up item / talk to NPC / wake relay), returnText (<= 38), reward (none or an existing kind: heart piece, chart piece, crystal, tool - say which).
B. NPCs: 6-10 named characters (exiles, a ferryman, a hermit, talking animals...) with id, name (<= 14), one-line description, voice notes.
C. Dialogue for every quest giver and NPC, in the JSON format below (one JSON object per speaker file). Giver quests MUST use these entry states in this order: ready, active, offer (with choices Accept / Later), done, repeat, first meeting.
D. Places: names (<= 14) and one lore line (<= 40) for each relay, the ford, the village, the dungeon, the signal hill.
E. UI strings: objective lines (<= 38), done lines (<= 38), toasts (<= 38), interaction prompts like "[E] Wake the relay" (<= 24), short notes found in the world (<= 56 per line, 1-3 lines).

## Hard text rules
- Plain ASCII only (no curly quotes, no em dashes, no emoji).
- Dialogue: max 56 characters per line, 1-3 lines per node.
- Never write "Esc", "press Esc" or any key hint except the [E] prompts in E.
- Do not promise rewards that are not in the quest's reward field.
- Keep names short and pronounceable; no real-world names or places.
- Count characters; put the count next to every string in tables.

## Output format
1. Section A as a markdown table: | id | title | giver | stage | steps | returnText | reward |
2. Section B as a table: | id | name | description | voice |
3. Section C: one fenced ```json block per speaker file, exactly this shape (example, shortened):
{
  "kind": "dialogue", "schema": 1, "id": "bear",
  "speakers": { "burl": {"label": "BURL"}, "you": {"label": "YOU", "player": true} },
  "entry": [
    {"node": "bear.q.ready", "requires": "q.burl.boars.ready"},
    {"node": "bear.q.active", "requires": "q.burl.boars.active"},
    {"node": "bear.q.offer", "requires": "q.burl.boars.available"},
    {"node": "bear.q.done", "requires": "q.burl.boars.done"},
    {"node": "bear.repeat", "requires": "bear.talked"},
    {"node": "bear.d1.l1"}
  ],
  "nodes": {
    "bear.d1.l1": {"lines": ["Well. A cub from the loud hill, fallen out of the sky."], "next": "bear.d1.l2", "speaker": "burl"},
    "bear.d1.l2": {"lines": ["...Bears don't talk."], "next": "bear.d1.l3", "speaker": "you"},
    "bear.d1.l3": {"lines": ["And cubs don't fly. Yet here we both are."], "speaker": "burl",
      "choices": [{"text": "It's a trick. A speaking-tube.", "next": "bear.d1.a.l1"}, {"text": "Have you seen the blinking light?", "next": "bear.d1.c.l1"}]}
  }
}
   Quest state keys are "q.<questId>.<state>" (available / active / ready / done); accepting uses an action node with "set": "q.<questId>.accept" and handing in "set": "q.<questId>.handin" on the thanks line.
4. Sections D and E as tables: | key | text | chars |

Start with Section A. If anything in the canon conflicts with an idea you have, keep the canon and list your idea at the end under "Suggestions".
