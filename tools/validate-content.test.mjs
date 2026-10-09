// tools/validate-content.test.mjs (US-058). Headless Node ESM, no framework
// (matches every other *.test.js/mjs in this repo). Run:
//   node tools/validate-content.test.mjs
//
// Feeds `validateContent` a hand-built, deliberately broken in-memory ASSETS
// fixture (NOT the real design/ files - those are exercised for real by
// running `node tools/validate-content.mjs`, see the backlog row 30b note
// for that result) with exactly one error of each kind the AC lists, plus a
// clean control case that must report zero errors (guards against the
// checks themselves being too strict - see validate-content.mjs's "3. Voxel
// models" comment for a real example of a check that started out too
// strict before this fixture existed).
import { validateContent, loadQuestFiles, validateDialogueFiles } from './validate-content.mjs';
import { makeOk } from '../engine/test/assert.js';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
function hasFinding(errors, substrings) {
  return errors.some((e) => substrings.every((s) => e.includes(s)));
}

// ---------------------------------------------------------------------------
// A minimal, self-consistent "good" content pack: one level, one world, one
// billboard model with a numeric variant, one voxel model, a small uiStyle.
// Every fixture below is a structural clone of this with exactly ONE field
// broken, so a failing check can be traced to a single deliberate mistake.
// ---------------------------------------------------------------------------
function goodAssets() {
  return {
    palette: {
      lights: {
        sun: { color: 'sun', intensity: 1, type: 'directional' },
        torch: { color: 'torch', intensity: 1, type: 'point' },
      },
      materials: {
        stone: { desc: 'stone', base: 'stoneMid', albedo: 0.8 },
        wood: { desc: 'wood', base: 'wood', albedo: 0.7 },
      },
    },
    detailPass: {
      materials: {
        stone: { v1: 'stone', seed: 1 },
        wood: { v1: 'wood', seed: 2 },
      },
    },
    voxelMaterials: {
      v1: { stone: {} },
      v2: { stone: {} },
      remap: { stone: 'stone' },
      fallback: { stone: 'stone' },
    },
    models: {
      lantern: {
        variants: ['unlit', 'lit'],
        animations: { unlit: { fps: 1, loop: true, frames: [{}] }, lit: { fps: 1, loop: true, frames: [{}] } },
      },
      rubble: {
        variants: [
          { name: 'rubble0', billboard: true, size: { w: 1, h: 1 } },
          { name: 'rubble1', billboard: true, size: { w: 1, h: 1 } },
        ],
      },
      crate: {
        voxel: {
          version: 1,
          cellM: 0.1,
          size: [1, 1, 1],
          anchor: [0, 0, 0],
          mats: { m: 'stone', '.': null },
          layers: [['m']],
          parts: { root: { box: [0, 0, 0, 1, 1, 1], pivot: [0, 0, 0] } },
        },
      },
      farTower: {},
    },
    uiStyle: {
      hints: [{ id: 'jump', text: '[Space] Jump' }],
      storyHints: [{ id: 'burner', text: 'The burner still glows.' }],
      prompt: { examples: ['[E] Take lamp'] },
      pause: { text: 'Click to resume' },
      endText: {
        lines: [
          { id: 'signal', text: 'The signal is still calling.' },
        ],
      },
    },
    levels: {
      room: {
        legend: { G: { tag: 'grate' } },
        sun: { preset: 'sun' },
        ambient: { preset: 'sun' },
        lights: [{ id: 'brazier', preset: 'torch', x: 0, y: 0, z: 0 }],
        props: [
          { id: 'lamp', model: 'lantern', variant: 'lit', x: 0, y: 0, z: 0 },
          { id: 'rock', model: 'rubble', variant: 0, x: 1, y: 1, z: 0 },
          { id: 'scrawl', model: 'decal:HELLO', wall: { x0: 0, x1: 1, y: 0, z0: 0, z1: 1 } },
          { id: 'chain', model: 'chains', from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 1, z: 1 } },
        ],
        interactables: [
          { id: 'lamp', light: 'brazier', flameProp: 'rock', target: { tag: 'grate' } },
        ],
        triggers: [
          { id: 'hintJump', type: 'hint', hint: 'jump', shape: 'circle', x: 0, y: 0, r: 2, zMin: 0, zMax: 5 },
        ],
      },
      // a terrain recipe (has util.heightAt) must NOT be treated as a level
      terrainA: { util: { heightAt: () => 0 } },
    },
    worlds: {
      w1: {
        entities: [{ id: 'tower', type: 'billboard', model: 'farTower', x: 0, y: 0 }],
        horizon: [{ id: 'lights', model: 'farTower' }],
      },
    },
  };
}

// A small (3x3) level with a correct non-solid outer ring, for the
// outer-ring-rule fixtures below (23.9). Every border cell is 'o' (open,
// solid: false); the single interior cell is '#' (solid: true) - solid
// interior is fine, only the ring matters.
function ringLevel() {
  return {
    legend: {
      o: { floorH: 2.4, solid: false },
      '#': { floorH: 3, solid: true },
    },
    rows: ['ooo', 'o#o', 'ooo'],
  };
}

function assetsWithRingWorld() {
  const a = goodAssets();
  a.levels.keep = ringLevel();
  a.worlds.terrainWorld = {
    terrain: 'overworld_far', // truthy -> this world HAS terrain
    structures: [{ id: 'keepPlaced', level: 'keep', origin: { x: 0, y: 0, z: 0 } }],
  };
  return a;
}

// 1. Clean fixture: zero errors.
{
  const a = goodAssets();
  const { errors, checks, meshOnlyCount } = validateContent(a);
  ok('clean fixture reports zero errors', errors.length === 0, JSON.stringify(errors));
  ok('clean fixture ran a non-trivial number of checks', checks > 10, String(checks));
  ok('clean fixture has 0 mesh-only models', meshOnlyCount === 0, String(meshOnlyCount));
}

// 1b. ME-22 (28.12 item 7): a flagged model validates and is counted.
{
  const a = goodAssets();
  a.models.crate.voxel.meshOnly = true;
  const { errors, meshOnlyCount } = validateContent(a);
  ok('meshOnly:true model still reports zero errors', errors.length === 0, JSON.stringify(errors));
  ok('meshOnlyCount counts the flagged model', meshOnlyCount === 1, String(meshOnlyCount));
}

// 2. Level prop model key missing from ASSETS.models.
{
  const a = goodAssets();
  a.levels.room.props[0].model = 'no_such_model';
  const { errors } = validateContent(a);
  ok('reports missing prop model', hasFinding(errors, ['no_such_model', 'not found']), JSON.stringify(errors));
}

// 3. variant/clip name missing on that model.
{
  const a = goodAssets();
  a.levels.room.props[0].variant = 'glowing'; // lantern has no such clip
  const { errors } = validateContent(a);
  ok('reports missing variant/clip', hasFinding(errors, ['glowing', 'variant/clip']), JSON.stringify(errors));
}

// 3b. ED-SCALE-1 (34.1/34.4): level prop scale outside [0.25, 4] is flagged,
// both too small (0.2) and too large (5); a valid scale reports nothing.
{
  const a = goodAssets();
  a.levels.room.props[0].scale = 0.2;
  const { errors } = validateContent(a);
  ok('reports too-small prop scale (0.2)', hasFinding(errors, ['props[lamp].scale', 'outside']), JSON.stringify(errors));
}
{
  const a = goodAssets();
  a.levels.room.props[0].scale = 5;
  const { errors } = validateContent(a);
  ok('reports too-large prop scale (5)', hasFinding(errors, ['props[lamp].scale', 'outside']), JSON.stringify(errors));
}
{
  const a = goodAssets();
  a.levels.room.props[0].scale = 1.5;
  const { errors } = validateContent(a);
  ok('a scale inside [0.25, 4] reports nothing', !errors.some((e) => e.includes('.scale')), JSON.stringify(errors));
}

// 3c. ED-SCALE-1: a world entity's scale (inline or transform.scale) outside
// [0.25, 4] is flagged the same way.
{
  const a = goodAssets();
  a.worlds.w1.entities[0].scale = 0.2;
  const { errors } = validateContent(a);
  ok('reports too-small world entity scale (0.2)', hasFinding(errors, ['entities[tower].scale', 'outside']), JSON.stringify(errors));
}
{
  const a = goodAssets();
  a.worlds.w1.entities[0].transform = { scale: 5 };
  const { errors } = validateContent(a);
  ok('reports too-large world entity scale (5, via transform.scale)', hasFinding(errors, ['entities[tower].scale', 'outside']), JSON.stringify(errors));
}

// 4. Light preset missing from palette.js lights.
{
  const a = goodAssets();
  a.levels.room.lights[0].preset = 'no_such_preset';
  const { errors } = validateContent(a);
  ok('reports missing light preset', hasFinding(errors, ['no_such_preset', 'light preset']), JSON.stringify(errors));
}

// 5. Interactable light/flameProp/target ids that don't resolve.
{
  const a = goodAssets();
  a.levels.room.interactables[0].light = 'no_such_light';
  const { errors } = validateContent(a);
  ok('reports unresolved interactable light id', hasFinding(errors, ['no_such_light']), JSON.stringify(errors));
}
{
  const a = goodAssets();
  a.levels.room.interactables[0].flameProp = 'no_such_prop';
  const { errors } = validateContent(a);
  ok('reports unresolved interactable flameProp id', hasFinding(errors, ['no_such_prop']), JSON.stringify(errors));
}
{
  const a = goodAssets();
  a.levels.room.interactables[0].target = { tag: 'no_such_tag' };
  const { errors } = validateContent(a);
  ok('reports unresolved interactable target tag', hasFinding(errors, ['no_such_tag']), JSON.stringify(errors));
}

// 6. Trigger shapes: radius > 0, zMin < zMax, hint ids present.
{
  const a = goodAssets();
  a.levels.room.triggers[0].r = 0;
  const { errors } = validateContent(a);
  ok('reports radius must be > 0', hasFinding(errors, ['radius', '> 0']), JSON.stringify(errors));
}
{
  const a = goodAssets();
  a.levels.room.triggers[0].zMin = 5;
  a.levels.room.triggers[0].zMax = 2;
  const { errors } = validateContent(a);
  ok('reports zMin must be < zMax', hasFinding(errors, ['zMin', 'zMax']), JSON.stringify(errors));
}
{
  const a = goodAssets();
  a.levels.room.triggers[0].hint = 'no_such_hint';
  const { errors } = validateContent(a);
  ok('reports unknown hint id', hasFinding(errors, ['no_such_hint']), JSON.stringify(errors));
}

// 7. Voxel model fails validateVoxelModel.
{
  const a = goodAssets();
  a.models.crate.voxel.size = [0, 1, 1]; // invalid: must be >= 1
  const { errors } = validateContent(a);
  ok('reports validateVoxelModel failure', hasFinding(errors, ['models.crate.voxel', 'size']), JSON.stringify(errors));
}

// 8. Voxel model material missing from palette.js / detail-pass.js.
{
  const a = goodAssets();
  a.models.crate.voxel.mats.m = 'no_such_material';
  const { errors } = validateContent(a);
  ok('reports material missing from palette.js', hasFinding(errors, ['no_such_material', 'palette.js materials']), JSON.stringify(errors));
  ok('reports material missing from detail-pass.js', hasFinding(errors, ['no_such_material', 'detail-pass.js materials']), JSON.stringify(errors));
}

// 9. UI text not ASCII 32-126.
{
  const a = goodAssets();
  a.uiStyle.hints[0].text = 'Café — jump'; // accented e + em dash: outside 32-126
  const { errors } = validateContent(a);
  ok('reports non-ASCII UI text', hasFinding(errors, ['not ASCII']), JSON.stringify(errors));
}

// 10. endText line over 40 chars.
{
  const a = goodAssets();
  a.uiStyle.endText.lines[0].text = 'x'.repeat(41);
  const { errors } = validateContent(a);
  ok('reports endText line too long', hasFinding(errors, ['endText line is 41 chars']), JSON.stringify(errors));
}

// 12. Outer-ring rule (23.9): a level placed in a world WITH terrain must
// have a non-solid outer ring.
{
  // Correct ring, placed in a world with terrain: stays quiet.
  const a = assetsWithRingWorld();
  const { errors } = validateContent(a);
  ok('correct outer ring in a terrain world reports no ring findings', !errors.some((e) => e.includes('outer ring')), JSON.stringify(errors));
}
{
  // Deliberately broken: one outer-ring cell (top-left corner) made solid.
  const a = assetsWithRingWorld();
  a.levels.keep.legend.o.solid = false; // sanity: still false
  a.levels.keep.rows = ['#oo', 'o#o', 'ooo']; // (0,0) is now the solid '#' char
  const { errors } = validateContent(a);
  ok(
    'reports the solid outer-ring cell',
    hasFinding(errors, ['terrainWorld.structures[keepPlaced]', 'rows[0][0]', 'outer ring', 'is solid']),
    JSON.stringify(errors)
  );
}
{
  // A level with the same broken ring but never placed in a world with
  // terrain (no world references it) must NOT be flagged - the rule only
  // applies to levels actually placed in a terrain world.
  const a = goodAssets();
  a.levels.orphan = { legend: { o: { solid: false }, '#': { solid: true } }, rows: ['#oo', 'ooo', 'ooo'] };
  const { errors } = validateContent(a);
  ok('unplaced level with a solid ring cell is not flagged', !errors.some((e) => e.includes('outer ring')), JSON.stringify(errors));
}
{
  // Same broken level placed in a world WITHOUT terrain (world.terrain
  // falsy/absent) - also must not be flagged.
  const a = assetsWithRingWorld();
  a.levels.keep.rows = ['#oo', 'o#o', 'ooo'];
  delete a.worlds.terrainWorld.terrain;
  const { errors } = validateContent(a);
  ok('solid ring cell in a world without terrain is not flagged', !errors.some((e) => e.includes('outer ring')), JSON.stringify(errors));
}

// 11. Sanity: a terrain recipe (has util.heightAt) is never treated as a level.
{
  const a = goodAssets();
  const { errors } = validateContent(a);
  ok('terrain recipe produced no findings of its own', !errors.some((e) => e.startsWith('levels.terrainA')), JSON.stringify(errors));
}

// ---------------------------------------------------------------------------
// 13. CO-8 (docs/coordinates.md section 8): coordinate/frame content rules.
// ---------------------------------------------------------------------------

// 13a. world.structures[].origin.x/y/z must be finite.
{
  const a = goodAssets();
  a.worlds.w1.structures = [{ id: 'tower', level: 'room', origin: { x: NaN, y: 0, z: 0 } }];
  const { errors } = validateContent(a);
  ok('reports non-finite origin.x', hasFinding(errors, ['structures[tower]', 'origin.x', 'finite']), JSON.stringify(errors));
}

// 13b. world.structures[].yawSteps must be an integer 0..3.
{
  const a = goodAssets();
  a.worlds.w1.structures = [{ id: 'tower', level: 'room', origin: { x: 0, y: 0, z: 0 }, yawSteps: 4 }];
  const { errors } = validateContent(a);
  ok('reports out-of-range yawSteps', hasFinding(errors, ['structures[tower]', 'yawSteps', '0..3']), JSON.stringify(errors));
}
{
  const a = goodAssets();
  a.worlds.w1.structures = [{ id: 'tower', level: 'room', origin: { x: 0, y: 0, z: 0 }, yawSteps: 1.5 }];
  const { errors } = validateContent(a);
  ok('reports non-integer yawSteps', hasFinding(errors, ['structures[tower]', 'yawSteps', '0..3']), JSON.stringify(errors));
}

// 13c. z (level prop / world entity) must be a number or 'ground'.
{
  const a = goodAssets();
  a.levels.room.props[0].z = 'sky'; // not a number, not 'ground'
  const { errors } = validateContent(a);
  ok('reports bad level prop z', hasFinding(errors, ['props[lamp].z', 'number or "ground"']), JSON.stringify(errors));
}
{
  const a = goodAssets();
  a.worlds.w1.entities[0].z = 'sky';
  const { errors } = validateContent(a);
  ok('reports bad world entity z', hasFinding(errors, ['entities[tower].z', 'number or "ground"']), JSON.stringify(errors));
}

// 13d. level items (props/lights/interactables) must stay inside [0,w)x[0,h).
{
  const a = goodAssets();
  a.levels.room.size = { w: 10, h: 10 };
  a.levels.room.props[0].x = 20; // outside [0,10)
  const { errors } = validateContent(a);
  ok('reports a prop outside the level bounds', hasFinding(errors, ['props[lamp]', 'out of level bounds', '[0,10) x [0,10)']), JSON.stringify(errors));
}
{
  // In-bounds items with a size present: no finding.
  const a = goodAssets();
  a.levels.room.size = { w: 10, h: 10 };
  const { errors } = validateContent(a);
  ok('in-bounds items with a level size report nothing', !errors.some((e) => e.includes('out of level bounds')), JSON.stringify(errors));
}

// 13e. A level file's own `sun` is deprecated: a WARNING, not an error.
{
  const a = goodAssets();
  a.levels.room.sun = { preset: 'sun' };
  const { errors, warnings } = validateContent(a);
  ok('level sun is a warning, not an error', !errors.some((e) => e.includes('levels.room.sun')), JSON.stringify(errors));
  ok('level sun warning is reported', warnings.some((w) => w.includes('levels.room.sun') && w.includes('deprecated')), JSON.stringify(warnings));
}

// 13f. A world file with terrain but no `sun` gets a warning (CO-8 moved
// sun to the world file; a real gameplay world missing it is worth flagging).
{
  const a = goodAssets();
  a.worlds.w1.terrain = 'overworld_far';
  const { warnings } = validateContent(a);
  ok('world with terrain and no sun is warned', warnings.some((w) => w.includes('worlds.w1.sun')), JSON.stringify(warnings));
}
{
  const a = goodAssets();
  a.worlds.w1.terrain = 'overworld_far';
  a.worlds.w1.sun = { preset: 'sun' };
  const { warnings } = validateContent(a);
  ok('world with terrain and a sun is not warned', !warnings.some((w) => w.includes('worlds.w1.sun')), JSON.stringify(warnings));
}
{
  // No terrain (an interior-only / ephemeral world) - no sun warning either way.
  const a = goodAssets();
  const { warnings } = validateContent(a);
  ok('world without terrain is never warned about sun', !warnings.some((w) => w.includes('worlds.w1.sun')), JSON.stringify(warnings));
}

// S8-C-17: quest refs share the existing inventory/pickup and world sources.
function questFixture() {
  const a = goodAssets();
  a.items = { defs: { sword: { id: 'sword', name: 'Sword', desc: 'Old steel.' } }, loot: { boar: { entries: [{ item: 'sword' }] } } };
  a.levels.room.interactables[0].interact = 'lantern.take';
  a.worlds.w1.entities.push({ id: 'boar1', type: 'beast', model: 'farTower', x: 1, y: 1 });
  const def = { version: 1, id: 'm1', objectives: [
    { id: 'lamp', text: 'Take the lamp', when: { type: 'item', id: 'lamp' } },
    { id: 'steel', text: 'Take the sword', when: { type: 'item', id: 'sword' } },
    { id: 'fight', text: 'Defeat a beast', when: { type: 'beasts', ids: ['boar1'], count: 1 } },
    { id: 'breach', text: 'Reach the breach', when: { type: 'area', id: 'breach' } },
  ] };
  a.levels.room.markers = { breach: { x: 0, y: 0, z: 0 } };
  a.worlds.w1.structures = [{ id: 'roomPlacement', level: 'room', origin: { x: 0, y: 0, z: 0 } }];
  a.worlds.w1.triggers = [{ id: 'end', shape: 'circle', x: 0, y: 0, r: 2 }];
  const areas = { version: 1, areas: {
    breach: { world: 'w1', structure: 'roomPlacement', marker: 'breach' },
    waystone: { world: 'w1', trigger: 'end' },
  } };
  return { a, quests: [{ path: 'm1.quest.json', def }], areas };
}
{
  const { a, quests, areas } = questFixture();
  const before = JSON.stringify({ a, quests, areas });
  const { errors } = validateContent(a, { quests, areas });
  ok('quest refs resolve inventory, pickup, beast and area ids', errors.length === 0, JSON.stringify(errors));
  ok('lint does not change content', JSON.stringify({ a, quests, areas }) === before);
}
const questCases = [
  ['unknown item', (a, q) => { q[0].def.objectives[1].when.id = 'swrod'; }, ['objectives[steel].when.id', 'swrod', 'not found']],
  ['pickup must be declared', (a) => { delete a.levels.room.interactables[0].interact; }, ['objectives[lamp].when.id', 'not found']],
  ['unknown beast', (a, q) => { q[0].def.objectives[2].when.ids = ['tower']; }, ['objectives[fight].when.ids', 'tower', 'not found']],
  ['duplicate quest', (a, q) => { q.push({ path: 'copy.quest.json', def: structuredClone(q[0].def) }); }, ['copy.quest.json.id', 'duplicate quest']],
  ['duplicate objective', (a, q) => { q[0].def.objectives[1].id = 'lamp'; }, ['m1.quest.json', 'duplicate objective']],
  ['empty objective text', (a, q) => { q[0].def.objectives[0].text = ' '; }, ['objectives[lamp].text', 'required']],
  ['non-ASCII objective', (a, q) => { q[0].def.objectives[0].text = '\u2026'; }, ['objectives[lamp].text', 'ASCII']],
  ['missing item name', (a) => { delete a.items.defs.sword.name; }, ['items.defs.sword.name', 'required']],
  ['invalid item description', (a) => { a.items.defs.sword.desc = 42; }, ['items.defs.sword.desc', 'required']],
  ['mismatched item id', (a) => { a.items.defs.sword.id = 'lamp'; }, ['items.defs.sword.id', 'match']],
  ['loot ref', (a) => { a.items.loot.boar.entries[0].item = 'missing'; }, ['items.loot.boar.entries[0].item', 'not found']],
];
for (const [name, breakFixture, finding] of questCases) {
  const { a, quests, areas } = questFixture(); breakFixture(a, quests);
  const { errors } = validateContent(a, { quests, areas });
  ok(`quest lint reports ${name}`, hasFinding(errors, finding), JSON.stringify(errors));
}
const areaCases = [
  ['missing alias table', (f) => { delete f.areas; }, ['when.id', 'breach', 'not found']],
  ['unknown semantic id', (f) => { f.quests[0].def.objectives[3].when.id = 'missing'; }, ['when.id', 'missing', 'not found']],
  ['bad version', (f) => { f.areas.version = 2; }, ['areas.json', 'version 1']],
  ['array table', (f) => { f.areas.areas = []; }, ['areas.json', 'areas object']],
  ['null target', (f) => { f.areas.areas.breach = null; }, ['areas.breach', 'expected']],
  ['ambiguous target kind', (f) => { f.areas.areas.breach.trigger = 'end'; }, ['areas.breach', 'expected']],
  ['unknown world', (f) => { f.areas.areas.breach.world = 'missing'; }, ['areas.breach.world', 'missing', 'not found']],
  ['unplaced landmark', (f) => { f.a.worlds.w1.structures = []; }, ['areas.breach.structure', 'exactly once']],
  ['duplicate structure', (f) => { f.a.worlds.w1.structures.push({ ...f.a.worlds.w1.structures[0] }); }, ['areas.breach.structure', 'exactly once']],
  ['mesh instead of level', (f) => { delete f.a.worlds.w1.structures[0].level; }, ['areas.breach.structure', 'placed level']],
  ['missing marker', (f) => { delete f.a.levels.room.markers.breach; }, ['areas.breach.marker', 'not found']],
  ['marker volume instead of point', (f) => { f.a.levels.room.markers.breach = { x0: 0, x1: 1 }; }, ['areas.breach.marker', 'finite x/y/z']],
  ['nonfinite point', (f) => { f.a.levels.room.markers.breach.z = NaN; }, ['areas.breach.marker', 'finite x/y/z']],
  ['missing trigger even if alias unused', (f) => { f.a.worlds.w1.triggers = []; }, ['areas.waystone.trigger', 'exactly once']],
  ['duplicate trigger', (f) => { f.a.worlds.w1.triggers.push({ ...f.a.worlds.w1.triggers[0] }); }, ['areas.waystone.trigger', 'exactly once']],
  ['target scoped to world', (f) => { f.a.worlds.other = { structures: [] }; f.areas.areas.waystone.world = 'other'; }, ['areas.waystone.trigger', 'exactly once']],
];
for (const [name, breakFixture, finding] of areaCases) {
  const f = questFixture(); breakFixture(f);
  const { errors } = validateContent(f.a, { quests: f.quests, areas: f.areas });
  ok(`area lint reports ${name}`, hasFinding(errors, finding), JSON.stringify(errors));
}
{
  const f = questFixture();
  f.quests[0].def.objectives[3].when.id = 'waystone';
  const { errors } = validateContent(f.a, { quests: f.quests, areas: f.areas });
  ok('quest area resolves a world trigger as well as a placed point marker', errors.length === 0, JSON.stringify(errors));
}
{
  const dir = mkdtempSync(join(tmpdir(), 'kestrel-quest-lint-'));
  try {
    mkdirSync(join(dir, 'nested'));
    const { quests } = questFixture();
    writeFileSync(join(dir, 'nested', 'm1.quest.json'), JSON.stringify(quests[0].def));
    writeFileSync(join(dir, 'bad.quest.json'), '{');
    writeFileSync(join(dir, 'ignore.json'), '{');
    const loaded = loadQuestFiles(dir);
    ok('quest scanner includes nested definitions and ignores unrelated files', loaded.quests.length === 1 && loaded.quests[0].def.id === 'm1');
    ok('quest scanner reports bad JSON without dropping other files', loaded.errors.length === 1 && loaded.errors[0].includes('bad.quest.json: JSON parse failed'));
    const { areas } = questFixture();
    writeFileSync(join(dir, 'areas.json'), JSON.stringify(areas));
    const withAreas = loadQuestFiles(dir);
    ok('scanner loads the separate area table without treating it as a quest', withAreas.quests.length === 1 && JSON.stringify(withAreas.areas) === JSON.stringify(areas));
    writeFileSync(join(dir, 'areas.json'), '{');
    const brokenAreas = loadQuestFiles(dir);
    ok('scanner diagnoses malformed alias JSON and retains quests', brokenAreas.quests.length === 1 && brokenAreas.areas === null && hasFinding(brokenAreas.errors, ['areas.json', 'JSON parse failed']));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// DIALOGUE-01a2: dialogue clip cross-check against the NPC model (fixture model, the real bear model is separate).
{
  const dir = mkdtempSync(join(tmpdir(), 'vc-dialogue-'));
  try {
    const bear = JSON.parse(readFileSync(new URL('../content/dialogue/bear.dialogue.json', import.meta.url), 'utf8'));
    const mk = (animNames) => ({ bear: { voxel: { animations: Object.fromEntries(animNames.map((n) => [n, {}])) } } });
    const all = ['idle', 'talk', 'listen', 'wave', 'laugh'];
    writeFileSync(join(dir, 'bear.dialogue.json'), JSON.stringify(bear));
    const good = validateDialogueFiles(dir, mk(all));
    ok('dialogue clip check: bear file passes against a model with all clips', good.errors.length === 0 && good.warnings.length === 0 && good.checks > 3, good.errors.join('|'));
    const noLaugh = validateDialogueFiles(dir, mk(all.filter((n) => n !== 'laugh')));
    ok('dialogue clip check: missing node clip "laugh" is an error', hasFinding(noLaugh.errors, ['clip "laugh"', 'model "bear"']));
    const noTalk = validateDialogueFiles(dir, mk(['idle', 'wave', 'laugh']));
    ok('dialogue clip check: missing runtime clips talk/listen are errors', hasFinding(noTalk.errors, ['clip "talk"']) && hasFinding(noTalk.errors, ['clip "listen"']));
    const unreg = validateDialogueFiles(dir, {});
    ok('dialogue clip check: unregistered model warns, no error', unreg.errors.length === 0 && unreg.warnings.some((w) => w.includes('not registered')));
    const broken = { ...bear, nodes: { ...bear.nodes, 'bear.repeat': { ...bear.nodes['bear.repeat'], lines: ['x'.repeat(60)] } } };
    writeFileSync(join(dir, 'bear.dialogue.json'), JSON.stringify(broken));
    ok('dialogue file check: engine rules (line > 56) are reported', hasFinding(validateDialogueFiles(dir, mk(all)).errors, ['60 chars']));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
  console.error('FAILURES:');
  for (const f of failures) console.error(' -', f);
  process.exitCode = 1;
}
