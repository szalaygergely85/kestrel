# Animal look options - stick legs (designer, 2026-10-14)

Owner: "bears look ok, I just don't like the way the legs are moving, like sticks... check other animals too, how they look,
is there an option to make them look nicer?"

Preview: `design/preview/animal-look-options.html` (owner server: `http://localhost:8000/design/preview/animal-look-options.html`).
**No model file was changed** (owner rule: no silent asset changes). Every option is built in the page from the shipped bear voxels;
the owner picks, then the model files get the change.

## Why the legs look like sticks
Every animal is a voxel model with **MAX_VOX_PARTS = 8** (`engine/voxel/VoxelModel.js`): body, head, jaw, ears/tail + ONE rigid box
per leg, rotating only at the shoulder / hip. No elbow, knee, hock or ankle. So in every gait the whole leg swings like a pendulum,
the paw sweeps an arc (toe dig is hidden by lifting the whole leg), and the hock / knee / wrist that are *drawn* in the voxels never
bend. The bear, with its 0.8 m straight front columns and the trot-like diagonal-pair timing, shows it most.

## Options (bear first; the page shows all four side by side, side + 3/4 view)
| Option | Look | Cost | Suits |
|---|---|---|---|
| **0 current** | pendulum legs, diagonal pairs (trot timing), arc-sweeping paws | - | - |
| **A gait only** | real walk sequence (bear amble = lateral couplets, or lateral-sequence walk), feet planted during stance (no slide at the tuned speed), foot lift + plant timing, body bob / pitch / roll / yaw, head counter-nod, ears lag. Legs still straight | **8 parts, no engine change.** A clip re-author per animal with the page's gait generator (~0.5 d per animal, mostly tuning). The tapered leg boxes / fur overhang are model edits that go in the same pass (not shown: they need the owner's pick first) | boar, otter, tortoise, cub, rabbit, squirrel (short legs), and the fallback for everything |
| **B knees** | each leg = upper + lower part: the elbow folds the paw back in the swing, the heel lifts at push-off, toes-up heel strike, flat foot mid-stance; A's body motion on top. Same voxels (the leg boxes are split at the elbow z 9 / ankle z 4) | **12 parts** for a 4-legged talker (body, head, jaw, ears + 8), **13** with a tail part (wolf, fox, deer), **10** for heron / goblin. **Engine change: MAX_VOX_PARTS 8 -> 16** (see ASK ARCHITECT). Same voxels, ~+4 % quads at the split seams, +4 mesh ranges per instance | bear, black bear (inherits: it clones Burl), wolf, deer, goat, heron, goblin, fox; cub if the mother gets it |
| **C runtime solve** | B's rig, but the legs are solved every frame from the ground speed and the terrain height under each foot: no foot slide at any speed, feet plant on slopes, stride / duty / body pitch follow speed and slope (sliders in the page) | 12 parts + engine: per-instance leg solve (4 legs x 2-bone, 1-D bisection or closed form) + 4 terrain height samples per frame, gait rate = speed / tuned. This is the D-090 stage 2 "foot IK + clip blending" item | same list as B; biggest win on the hills (the valley is all slope) |

## Recommendation
1. **Take B** as the standard animal rig (12 / 13 / 10 parts) and author its clips with the gait generator from the page. It fixes
   the complaint for the bear and for the four other animals that look wrong for the same reason (wolf, deer, goat, heron) and the
   goblin's wind-up-toy legs. The voxels do not change, so the owner-approved bodies and heads stay as they are.
2. **A now** for the animals that stay on 8 parts (boar, otter, tortoise, cub, rabbit, squirrel, birds): re-author only the walk /
   trot clips with the planted-foot gait (no engine work), it is a content-only story.
3. **C later**, as the D-090 stage 2 foot-IK item: it reuses B's rig and data, so B is not throw-away work.

## Review of every animal (the page shows each with its own walk; verdicts in the grid)
| Animal | Verdict | Fix |
|---|---|---|
| Burl brown bear | FIX - stick legs, trot timing | B (12) + amble gait |
| black bear | FIX - same rig / clips | inherits B |
| bear cub | MINOR - short thick legs hide it | A gait; B later |
| wolf | FIX - 10 cm wire legs, 5 cm swing lift, paws drag; worst after the bear | B (13 with tail) |
| boar | OK - stub legs, gallop fine | A lateral walk at most |
| goat (Crag) | FIX - climbStep = a 22 cm stilt step | B (12) |
| heron (Stilt) | FIX - high step on a straight leg; a heron folds the tarsus on every step | 2-segment legs (10) |
| otter (Skip) | OK - short legs, long low body | optional chest/hips trunk split (9) |
| tortoise (Slate) | OK - column legs are correct | - |
| rabbit | MINOR - haunch+foot rock as one block | optional haunch/foot split (10) |
| deer | FIX - best gait, but long straight sticks, hock never bends; 1 m tall and seen often | B (13) |
| fox | MINOR - tail carries it | B optional |
| squirrel | OK | - |
| robin / finch | OK - tiny; folded wing is the only tell | - |
| crow / Rook | OK - beak is what matters | - |
| goblin | FIX - bent-knee legs rotating rigidly = wind-up toy | 2-segment legs (10) or the RIG-00 chargen path |
| sea monster | OK - neck x2 + tail x2 already bend | - |

Worst-looking today: **bear / black bear, wolf, heron, deer, goblin** (in that order of visibility).

## ASK ARCHITECT
ASK ARCHITECT: option B (and C) needs **MAX_VOX_PARTS raised from 8 to 16** (quadrupeds 12-13 parts, heron / goblin 10). Please confirm
the touch list and cost: (1) `engine/voxel/VoxelModel.js` const + the validator's hard-coded `> 8 parts` check; (2) every scratch sized by
the const follows automatically (`voxelPose.js` `_Ak/_bk/_axisAligned/FORWARD/_rotOut/_posOut/_fromRot/_fromPos/_mountPoseScratch`,
`voxelPool.js` pose buffer) - but `engine/mesh/DrawList.js` hard-codes `partMatrices` 8 x 12 and `partFlags` 8, and
`voxelMesh.js` packs the part index in **3 bits** (`(partIndex & 7) << 21` in `flat0`, same in the preview `lib/voxelMarch.js` planeId) ->
needs 4 bits (take one from the 18-bit layer field; max layer 2^17 is still far above any model) in the JS twin AND the WGSL decode;
(3) the raster / shadow passes' per-part matrix uniform (8 x 12 floats per draw) doubles to 16 x 12, and `instances.js` masked-mesh ranges
loop per part; (4) `engine/chargen` `MAX_PARTS` / `MAX_PARTS_KIT` are pinned equal to MAX_VOX_PARTS by a test (raise together or
decouple). Cost per instance: pose +50 % of a tiny per-frame cost (12 chained 3x3 products instead of 8), +4 mesh ranges per bear /
wolf / deer (one draw range per part in raster + shadow), clip key arrays grow with partCount (n x parts x 6 doubles). Nothing changes
for 8-part models. Option C additionally needs the D-090 stage 2 runtime leg solve (2-bone per leg + terrain height per foot + gait rate =
speed / tuned); B's rig and clips are its input, so B is not throw-away.
