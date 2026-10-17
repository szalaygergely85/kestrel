# KESTREL - Chapter 1: Beyond the Wall

Source: owner (generated with ChatGPT from docs/proposals/chatgpt-story-prompt.md), pasted 2026-10-10. Owner-approved script; implementation deltas are tracked in docs/decisions.md D-062 and the backlog section "Chapter 1 script (D-062)". Dialogue lines here are the source text; game strings must still respect the engine limits (56 chars per dialogue line, 38 HUD/toast) - shorten only where needed and keep the meaning.

First quest line: The Awakening.
Wick travels from the crashed Kestrel in the Hollow Watchtower to Bend Relay, where he meets the first human living beyond Ferrum. The chapter ends with the discovery that the world is inhabited, magic may be real, and not everyone beyond the Wall is friendly.

## Quest progression
1. A Blade in the Ashes - Pick up the sword near the wreckage.
2. Leave the Tower - Find the exit and reach the meadow.
3. Boars in the Woods - Meet Burl and clear five boars from the forest path.
4. Follow the Bear - Walk with Burl to the Waystone.
5. Awaken the Stone - Wake the Waystone; Burl departs.
6. The Next Light - Find and wake Bend Relay to unlock travel.
7. Not Alone - Meet Fen at Bend Relay and learn about the world beyond the Wall.

---

## Quest 01 - A Blade in the Ashes
Location: Hollow Watchtower. Giver: a note beside the sword. Reward: none (sword acquired as quest objective).

Wick wakes on the broken floor of the tower. The Kestrel lies tangled in shattered timber and torn canvas. His stolen Crown sky-chart rests near him, its pencilled line pointing west.
A sword has fallen from a rack near the wreckage. Beside it is a weathered note.

Note:
> To whoever finds this place:
>
> The road beyond is no longer safe.
> Take the blade. You may need it.
>
> And if you hear something below, do not answer.

Objective: Pick up the sword.
Wick, after picking it up: "Better than empty hands."
Quest complete: A Blade in the Ashes. A second note becomes readable near the ruined stairway.

## Quest 02 - Leave the Tower
Location: Hollow Watchtower. Giver: second note. Reward: none.

Note:
> These stones are not as dead as they seem.
>
> Do not stay here after dark.
> Something moves beneath the tower.
>
> Leave while there is still light.

Objective: Find a way out of the tower.
Wick descends past the wreckage, crosses the lower chamber and emerges into a bright green meadow. Birds sing above the old road. The world beyond the Wall is full of life.
Wick: "Nothing, they said." / "Looks like plenty of nothing."
Quest complete: Leave the Tower. As Wick approaches the trees, a deep voice calls from nearby.

## Quest 03 - Boars in the Woods
Location: Berry Slope. Giver: Burl. Reward: none.

First encounter:
- BURL: Well, well. The falling cub lives.
- WICK: Who's there?
- BURL: Down here. Among the berries.
- (Wick turns. A large old bear sits beneath an oak tree.)
- BURL: Quite a fall you took, sky-cub.
- WICK: ...You just spoke.
- BURL: I did.
- WICK: Bears don't talk.
- BURL: And people don't fall from the sky.
- BURL: Yet here you are.
- WICK: This isn't possible.
- BURL: You folk from the loud hill are odd.
- BURL: You believe a balloon can fly,
- BURL: but a bear with words troubles you?

Optional exchange about the crash:
- WICK: You saw me fall?
- BURL: Hard to miss a burning sky-boat.
- BURL: Thought the whole hill would catch fire.
- WICK: It's called an airship.
- BURL: Not much of one now.

Offer:
- BURL: If you're heading west, mind the woods.
- BURL: Boars have taken over my berry slope.
- BURL: Mean things. No respect for blueberries.
- WICK: I'm looking for something.
- BURL: Aren't we all?
- WICK: A light. It blinks in the distance.
- BURL: Ah. The far light.
- BURL: There is an old Waystone past the trees.
- BURL: Might help you find your way.
- BURL: But first, those boars need moving.

Choices: Accept "I'll clear the path." / Later "Not yet."
On accepting:
- BURL: Five ought to convince the others.
- BURL: Mind their tusks, sky-cub.

Objectives: Enter the berry slope. Kill 5 boars. Return to Burl.
While active:
- BURL: Still hearing those greedy snouts.
- BURL: Five boars. No need to chase the whole herd.
After killing five:
- BURL: Ah! I can smell the berries again!
- WICK: The path is clear.
- BURL: And my breakfast is saved.
- BURL: You've done an old bear a kindness.
Quest complete: Boars in the Woods.

## Quest 04 - Follow the Bear
Location: Forest Path. Giver: Burl. Reward: none.
- BURL: Come along, sky-cub.
- BURL: I'll show you that old stone.
- WICK: You're coming with me?
- BURL: Wouldn't want you getting lost.
- BURL: You already fell out of the sky once.

Burl begins walking along the forest path. Wick follows.
Optional walking dialogue:
- BURL: Hear those birds?
- WICK: What about them?
- BURL: They sing when the woods are at peace.
- BURL: Not everything out here means you harm.
Farther down the road:
- WICK: Where does this road lead?
- BURL: West. To the river, and farther.
- BURL: Older roads cross it. Older stones too.
- WICK: Who built them?
- BURL: Good question.
- BURL: The stones aren't telling.

They enter a clearing containing a moss-covered brass-and-mirror mechanism with a crystal bowl.
- BURL: There we are.
- BURL: The Waystone.
Quest complete: Follow the Bear.

## Quest 05 - Awaken the Stone
Location: The Waystone. Giver: Burl. Reward: first Waystone activated.
- WICK: It's an old machine.
- BURL: Not quite.
- WICK: Looks like one.
- BURL: That's because you look with your eyes.
- WICK: What else should I look with?
- BURL: Your head, for a start.
- BURL: These stones remember those who wake them.
- BURL: If you fall, their light calls you home.
- BURL: They remember your journey too.
- BURL: And when you wake another stone,
- BURL: you can travel between them.
- WICK: Without walking?
- BURL: That's the idea.
- WICK: That's impossible.
- BURL: You've said that before.
- BURL: Try bringing your lamp closer.

Objective: Wake the Waystone.
Wick raises the Kestrel's lamp toward the crystal bowl. A low hum rises from the brass mount. The mirrors rotate. Teal light spreads through the crystal, illuminating ancient marks beneath the moss.
- WICK: What is that?
- BURL: An old kind of light.
- WICK: No gears. No steam.
- BURL: Not everything needs them.

System notification:
> WAYSTONE AWAKENED
>
> Your journey is remembered here.
> You will return here if you fall.
> Find more Waystones to unlock travel.

After activation:
- BURL: Well done, sky-cub.
- BURL: The next stone lies west, by the road bend.
- BURL: Follow the old road and your little chart.
- WICK: You're not coming?
- BURL: These paws have walked far enough today.
- BURL: And my berries won't eat themselves.
- WICK: Thank you, Burl.
- BURL: Take care out there.
- BURL: The world is wider than your Wall.

Burl slowly walks into the forest and disappears behind the trees.
Quest complete: Awaken the Stone. The pencil line on Wick's chart points toward Bend Relay.

## Quest 06 - The Next Light
Location: Western Road, Bend Relay. Giver: automatic. Reward: Bend Relay activated.
Quest description:
> The Waystone has awakened.
> Another lies west along the old road.
>
> Find it to open a path between the stones.

Objectives: Follow the western road. Find Bend Relay. Wake Bend Relay.
The forest grows thicker. Old stone walls, abandoned markers and broken brass fixtures line the road. The faint hum from Wick's chart seems to grow stronger near the relay.
At the road bend, Wick finds a dormant crystal bowl.
- WICK: Another one.
- WICK: Let's see if Burl was right.
Wick holds his lamp beside the crystal. The bowl begins to hum, and teal light flows through the old brass.

System notification:
> BEND RELAY AWAKENED
>
> Travel unlocked.
> You can now travel between awakened Waystones.

Quest complete: The Next Light. As Wick examines the relay, a human voice calls from behind him.

## Quest 07 - Not Alone
Location: Bend Relay. Giver: Fen, a lone wanderer. Reward: none.
A man emerges from behind a fallen stone wall. His clothes are patched, his boots worn, and an old travelling staff rests in his hand.
- FEN: By the old stones...
- FEN: Another person!
- FEN: I thought I was the only soul on this road!
- WICK: Who are you?
- FEN: Fen. Just Fen.
- FEN: And you?
- WICK: Wick.
- FEN: Well met, Wick!
- FEN: It's good to hear a human voice again.
(Fen notices Wick's Crown clothing.)
- FEN: Hold on...
- FEN: That coat. You're from Ferrum?
- WICK: Yes.
- FEN: How in the world did you get out?
- WICK: I borrowed an airship.
- FEN: Borrowed?
- WICK: It didn't survive.
- FEN: Ha! I suppose that explains the smoke.
(Fen laughs, then looks toward the forest.)
- FEN: You picked a strange road to wander.
- FEN: These woods are beautiful, aren't they?
- WICK: More than I expected.
- FEN: Aye. But don't let that fool you.
- FEN: Not everything here is friendly.
- FEN: There are thieves on the western roads.
- FEN: And things in the old ruins...
- FEN: Things best left sleeping.
- WICK: What kind of things?
- FEN: Old guardians. Beasts. Stranger things.
- FEN: This land still holds aether.
- WICK: Aether?
- FEN: Magic, Wick.
- WICK: Magic isn't real.
- FEN: Is that what Ferrum teaches now?
- WICK: It's a children's tale.
- FEN: Then how did you wake that stone?
(Wick looks back at the glowing crystal.)
- WICK: I don't know.
- FEN: There's a great deal you don't know yet.
- FEN: But that's what makes a journey worth taking.
(Fen notices the chart.)
- FEN: What's that you've got?
- WICK: A sky-chart.
- FEN: And that line?
- WICK: Something is sending a signal.
- WICK: Three short. Three long. Three short.
- FEN: A signal?
- WICK: From beyond the Wall.
- FEN: Well...
(Fen studies the western horizon.)
- FEN: I've seen a light on the far hills.
- FEN: Never knew what to make of it.
- WICK: I intend to find out.
- FEN: Then you'll want the river road.
- FEN: It leads to a ford, farther west.
- FEN: And beyond that, there are people.
- WICK: People?
- FEN: More than you'd think.
- FEN: Some might even welcome you.
- FEN: Just remember one thing.
- WICK: What?
- FEN: Out here, a friendly face means more
- FEN: than any fine coat or polished blade.
- FEN: Choose your friends carefully.
- WICK: I'll remember.
- FEN: Good.
- FEN: May the old lights guide you, Wick.
Quest complete: Not Alone.

## Chapter ending
Wick stands beside the awakened Bend Relay. The woods stretch westward into a green valley. Somewhere beyond the river, people live who Ferrum claims do not exist. And beyond them, the distant light continues blinking.

CHAPTER COMPLETE: BEYOND THE WALL. Next chapter: The River and the Forgotten.

Final journal entry:
> I thought the Wall kept the world out.
>
> Now I wonder what it kept hidden.
>
> A talking bear. Stones that shine without fire.
> A stranger who says magic is real.
>
> And somewhere ahead, that same blinking light.
>
> Three short. Three long. Three short.
>
> Someone is still calling.

## End-of-chapter gameplay state
Wick has a sword, his Kestrel lamp and sky-chart. The Waystone and Bend Relay are awakened, enabling saving, respawning and fast travel between them. Burl has departed, Fen remains available for conversation, and the western river road is unlocked. Wick has witnessed signs of Aether but has not learned spells or received the artificer's gauntlet.
