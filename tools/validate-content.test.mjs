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
import { validateContent, loadQuestFiles, validateDialogueFiles, validateBarks, lintQuestText, applyR19Allow, R19_ALLOW, groupR19ByPack } from './validate-content.mjs';
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

// GS-01d: terrainFloor flag rule.
{
  const a = assetsWithRingWorld();
  a.levels.keep.legend.o.zone = 'outside'; a.levels.keep.legend.o.terrainFloor = true;
  ok('terrainFloor on an equal-height outside ring is accepted', !validateContent(a).errors.some((e) => e.includes('terrainFloor')));
  a.levels.keep.legend.g = { floorH: 2.7, solid: false, zone: 'outside', terrainFloor: true };
  a.levels.keep.rows = ['ooo', 'ogo', 'ooo'];
  ok('terrainFloor cell off the ring height is rejected', hasFinding(validateContent(a).errors, ['rows[1][1]', 'terrainFloor', 'height step']));
  const b = assetsWithRingWorld();
  b.levels.keep.legend['#'].terrainFloor = true;
  ok('terrainFloor on a solid / non-outside cell is rejected', hasFinding(validateContent(b).errors, ["legend['#']", 'terrainFloor']));
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
  ['objective text over 38', (a, q) => { q[0].def.objectives[0].text = 'x'.repeat(39); }, ['objectives[lamp].text', '39 chars']],
  ['item name over 14', (a) => { a.items.defs.sword.name = 'x'.repeat(15); }, ['items.defs.sword.name', '15 chars']],
  ['item desc over 38', (a) => { a.items.defs.sword.desc = 'x'.repeat(39); }, ['items.defs.sword.desc', '39 chars']],
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
// QL-02: givers/hand-ins, rewards, requires chain.
{
  const gq = (id, extra = {}) => ({ path: id + '.quest.json', def: { version: 1, id, objectives: [{ id: 'o', text: 'Go', when: { type: 'flag', id: 'f', equals: true } }], ...extra } });
  const run = (mut) => { const f = questFixture(); mut(f); return validateContent(f.a, { quests: f.quests, areas: f.areas }).errors; };
  ok('QL-02 valid giver/reward/requires passes', run((f) => { f.quests.push(gq('sq.a', { giver: { npc: 'boar1' }, reward: { items: [{ id: 'sword', n: 1 }] }, requires: [{ quest: 'm1', step: 'lamp' }] })); }).length === 0);
  ok('QL-02 unknown giver', hasFinding(run((f) => { f.quests.push(gq('sq.a', { giver: { npc: 'nobody' } })); }), ['giver.npc', 'nobody']));
  ok('QL-02 unknown hand-in', hasFinding(run((f) => { f.quests.push(gq('sq.a', { giver: { npc: 'boar1', turnIn: 'ghost' } })); }), ['giver.turnIn', 'ghost']));
  ok('QL-02 unknown reward item', hasFinding(run((f) => { f.quests.push(gq('sq.a', { reward: { items: [{ id: 'nope', n: 1 }] } })); }), ['reward.items[0].id', 'nope']));
  ok('QL-02 duplicate quest id', hasFinding(run((f) => { f.quests.push(gq('m1')); }), ['duplicate quest id']));
  ok('QL-02 unknown required quest', hasFinding(run((f) => { f.quests.push(gq('sq.a', { requires: [{ quest: 'zz', done: true }] })); }), ['required quest "zz"']));
  ok('QL-02 unknown required step', hasFinding(run((f) => { f.quests.push(gq('sq.a', { requires: [{ quest: 'm1', step: 'zz' }] })); }), ['no step "zz"']));
  ok('QL-02 requires cycle', hasFinding(run((f) => { f.quests.push(gq('sq.a', { requires: [{ quest: 'sq.b', done: true }] }), gq('sq.b', { requires: [{ quest: 'sq.a', done: true }] })); }), ['cycle']));
}
// QL-T2: site placement, reachability, gate key.
{
  const gq = (id, extra = {}) => ({ path: id + '.quest.json', def: { version: 1, id, objectives: [{ id: 'o', text: 'Go', when: { type: 'flag', id: 'f', equals: true } }], reward: { items: [{ id: 'sword', n: 1 }] }, ...extra } });
  const run = (mut, sites = { s1: { entity: 'boar1' } }) => {
    const f = questFixture();
    f.a.items.defs['key.gate'] = { id: 'key.gate', name: 'Gate key', desc: 'Opens the gate.' };
    mut(f);
    return validateContent(f.a, { quests: f.quests, areas: f.areas, sites });
  };
  const gate = { reward: { items: [{ id: 'key.gate', n: 1 }] } };
  ok('QL-T2 valid site passes', run((f) => { f.quests.push(gq('sq.a', { site: 's1', giver: { npc: 'boar1' } })); }).errors.length === 0);
  ok('QL-T2 unknown site', hasFinding(run((f) => { f.quests.push(gq('sq.a', { site: 'zz', giver: { npc: 'boar1' } })); }).errors, ['sq.a.quest.json.site', 'zz']));
  ok('QL-T2 site entity not placed', hasFinding(run((f) => { f.quests.push(gq('sq.a', { site: 's1', giver: { npc: 'boar1' } })); }, { s1: { entity: 'ghost' } }).errors, ['entity "ghost"', 'not placed']));
  ok('QL-T2 unreachable (cycle) quest', hasFinding(run((f) => { f.quests.push(gq('sq.a', { requires: [{ quest: 'sq.b', done: true }] }), gq('sq.b', { requires: [{ quest: 'sq.a', done: true }] })); }).errors, ['not reachable', 'sq.a']));
  ok('QL-T2 chain from the start is reachable', !hasFinding(run((f) => { f.quests.push(gq('sq.a', { requires: [{ quest: 'm1', step: 'lamp' }] }), gq('sq.b', { requires: [{ quest: 'sq.a', done: true }] })); }).errors, ['not reachable']));
  ok('QL-T2 no gate key -> info, no error', (() => { const r = run(() => {}); return r.errors.length === 0 && r.infos.includes('gate key not assigned yet'); })());
  ok('QL-T2 gate key by the last main quest passes', (() => { const r = run((f) => { f.quests.push(gq('mq.a', { main: true, ...gate })); }); return r.errors.length === 0 && r.infos.length === 0; })());
  ok('QL-T2 gate key by a side quest', hasFinding(run((f) => { f.quests.push(gq('sq.a', gate)); }).errors, ['key.gate', 'last main quest']));
  ok('QL-T2 gate key by a non-last main quest', hasFinding(run((f) => { f.quests.push(gq('mq.a', { main: true, ...gate }), gq('mq.b', { main: true, requires: [{ quest: 'mq.a', done: true }] })); }).errors, ['key.gate', 'last main quest', 'mq.b']));
  ok('QL-T2 gate key given twice', hasFinding(run((f) => { f.quests.push(gq('mq.a', { main: true, ...gate }), gq('mq.b', { main: true, ...gate })); }).errors, ['exactly once']));
  ok('QL-T2 unknown gear/reward item id', hasFinding(run((f) => { f.quests.push(gq('sq.a', { reward: { items: [{ id: 'gear.nope', n: 1 }] } })); }).errors, ['reward.items[0].id', 'gear.nope']));
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
    // QG-03: q.<id>.<op> keys name a loaded giver quest and a known op
    writeFileSync(join(dir, 'bear.dialogue.json'), JSON.stringify(bear));
    ok('quest keys: bear file passes with the giver quest loaded', validateDialogueFiles(dir, mk(all), ['burl.boars', 'burl.follow', 'burl.stone', 'tower.blade', 'sq.burl.blue', 'burl.road'] /* OB-178/D-105, OB-210 */).errors.length === 0);
    ok('quest keys: unknown quest id is an error', hasFinding(validateDialogueFiles(dir, mk(all), ['other']).errors, ['q.burl.boars.ready', 'no giver quest']));
    const badOp = JSON.parse(JSON.stringify(bear)); badOp.nodes['bear.q.ready.6'].setFlag = 'q.burl.boars.reward';
    writeFileSync(join(dir, 'bear.dialogue.json'), JSON.stringify(badOp));
    ok('quest keys: unknown op is an error', hasFinding(validateDialogueFiles(dir, mk(all), ['burl.boars', 'burl.follow', 'burl.stone', 'tower.blade', 'sq.burl.blue', 'burl.road'] /* OB-178/D-105, OB-210 */).errors, ['q.burl.boars.reward', 'unknown quest op']));
    // CH1-05: `s.<key>` state flags and the `barks` kind
    writeFileSync(join(dir, 'bear.dialogue.json'), JSON.stringify(bear));
    ok('s. keys: bear file passes (s.burl.follow, s.waystone.waystone.woken ...)', validateDialogueFiles(dir, mk(all), ['burl.boars', 'burl.follow', 'burl.stone', 'tower.blade', 'sq.burl.blue', 'burl.road'] /* OB-178/D-105, OB-210 */).errors.length === 0);
    const badS = JSON.parse(JSON.stringify(bear)); badS.nodes['bear.follow.3'].setFlag = 's.1bad key';
    writeFileSync(join(dir, 'bear.dialogue.json'), JSON.stringify(badS));
    ok('s. keys: a bad s. key is an error', validateDialogueFiles(dir, mk(all), ['burl.boars', 'burl.follow', 'burl.stone', 'tower.blade', 'sq.burl.blue', 'burl.road'] /* OB-178/D-105, OB-210 */).errors.length > 0);
    writeFileSync(join(dir, 'bear.dialogue.json'), JSON.stringify(bear));
    const barks = JSON.parse(readFileSync(new URL('../content/dialogue/bear.barks.json', import.meta.url), 'utf8'));
    writeFileSync(join(dir, 'bear.barks.json'), JSON.stringify(barks));
    const gb = validateDialogueFiles(dir, mk(all), ['burl.boars', 'burl.follow', 'burl.stone', 'tower.blade', 'sq.burl.blue', 'burl.road'] /* OB-178/D-105, OB-210 */);
    ok('barks kind: the real bear.barks.json passes', gb.errors.length === 0, gb.errors.join('|'));
    const b1 = JSON.parse(JSON.stringify(barks)); b1.barks['bear.call'][0].who = 'nobody'; b1.barks['bear.walk1'][0].text = 'x'.repeat(60);
    writeFileSync(join(dir, 'bear.barks.json'), JSON.stringify(b1));
    const bad = validateDialogueFiles(dir, mk(all), ['burl.boars', 'burl.follow', 'burl.stone', 'tower.blade', 'sq.burl.blue', 'burl.road'] /* OB-178/D-105, OB-210 */).errors;
    ok('barks kind: unknown speaker and a 60-char line are errors', hasFinding(bad, ['unknown speaker']) && hasFinding(bad, ['60 chars']), bad.join('|'));
    ok('barks kind: wrong kind / empty barks are errors', validateBarks({ kind: 'dialogue' }).errors.length === 1 && validateBarks({ kind: 'barks', speakers: {}, barks: {} }).errors.length > 0);
    rmSync(join(dir, 'bear.barks.json'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// QUEST-LOG-TEXT-CHECK-01: real content regression (first offender path)
{
  const { readFileSync } = await import('node:fs');
  const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
  const q = read('../content/quests/m1.quest.json');
  const badObj = q.objectives.find((o) => o.text.length > 38);
  ok('m1.quest.json objectives <= 38 chars', !badObj, badObj && `content/quests/m1.quest.json.objectives[${badObj.id}].text (${badObj.text.length})`);
  const { loadDesignAssets } = await import('./validate-content.mjs');
  const defs = (await loadDesignAssets()).items?.defs || {};
  const badName = Object.entries(defs).find(([id, d]) => d.name.length > (id.startsWith('book.spell.') ? 21 : 14)); // SPELL-09: Spell Book names "Spell Book: <Spell>" <= 21
  ok('item names <= 14 chars', !badName, badName && `items.defs.${badName[0]}.name`);
  const badDesc = Object.entries(defs).find(([, d]) => d.desc.length > 38);
  ok('item descs <= 38 chars', !badDesc, badDesc && `items.defs.${badDesc[0]}.desc`);
}

// EQ-11: loot.json validation (real file + real item defs, then broken copies)
{
  const { loadDesignAssets } = await import('./validate-content.mjs');
  const A = await loadDesignAssets();
  const loot = JSON.parse(readFileSync(new URL('../content/items/loot.json', import.meta.url), 'utf8'));
  const run = (lootFile) => validateContent(A, { lootFile }).errors.filter((e) => String(e).includes('loot.json'));
  ok('real loot.json validates', run(loot).length === 0, JSON.stringify(run(loot)));
  ok('loot rates 4/3/8 %', loot.sources.boar.rolls[0].chance === 0.04 && loot.sources.container.rolls[0].chance === 0.03 && loot.sources.chest.rolls[0].chance === 0.08);
  const bad = (name, fn, text) => { const c = JSON.parse(JSON.stringify(loot)); fn(c); const e = run(c); ok(`loot lint: ${name}`, e.some((x) => String(x).includes(text)), JSON.stringify(e)); };
  bad('unknown item', (c) => { c.sources.chest.rolls[1].give.item = 'nope'; }, 'not found');
  bad('chance > 1', (c) => { c.sources.boar.rolls[0].chance = 1.5; }, 'chance');
  bad('tier odds sum', (c) => { c.tiers.fine = 0.2; }, 'sum to 1');
  bad('slot without gear', (c) => { c.slots.push('off'); }, 'no gear item');
  bad('crafting-free fixed ref', (c) => { c.sources.boar.fixed[0].item = 'ghost'; }, 'fixed');
}


// WMP-04: region lint. One fixture per case, each must give exactly its finding; the clean control gives none.
{
  const { lintRegions } = await import('./validate-content.mjs');
  const q = (o = {}) => ({ id: 'sq.reg.aa', title: 'T', returnText: 'Back', site: 'relay_aa', lines: { offer: ['hi'], done: ['bye'] }, steps: [{ journal: 'j', objText: 'o', template: 'kill', params: { kind: 'boar', count: 1 } }], ...o });
  const base = () => ({ geo: { bounds: { pts: [[0, 0], [100, 0], [100, 100], [0, 100]] }, regions: [{ id: 'aa', r: [10, 10, 60, 60] }] }, quests: [q()], sites: { relay_aa: {}, relay_bb: {} }, relayIds: ['ws_aa'], itemIds: new Set(['arrow']), beastKinds: new Set(['boar']),
    camps: [{ id: 'campFar.aa', region: 'aa', at: [30, 30], members: [{ id: 'm1', at: [2, 2] }] }] });
  const one = (name, mut, text) => { const o = base(); mut(o); const e = lintRegions(o); ok('region lint: ' + name, e.length === 1 && e[0].includes(text), JSON.stringify(e)); };
  ok('region lint: clean control = 0 findings', lintRegions(base()).length === 0, JSON.stringify(lintRegions(base())));
  one('relay without errand', (o) => { o.relayIds.push('ws_bb'); }, 'ws_bb has no errand');
  one('unknown kill kind', (o) => { o.quests[0].steps[0].params.kind = 'dragon'; }, "kill kind 'dragon'");
  one('unknown site', (o) => { o.quests[0].site = 'relay_zz'; }, "site 'relay_zz'");
  one('unknown deliver-to', (o) => { o.quests[0].steps = [{ journal: 'j', objText: 'o', template: 'deliver', params: { item: 'arrow', to: 'relay_zz', count: 1 } }]; }, "deliver-to 'relay_zz'");
  one('unknown deliver item', (o) => { o.quests[0].steps = [{ journal: 'j', objText: 'o', template: 'deliver', params: { item: 'ghost', to: 'relay_bb', count: 1 } }]; }, "item 'ghost'");
  one('camp outside bounds', (o) => { o.camps[0].at = [150, 30]; o.camps[0].members = []; o.geo.regions[0].r = [10, 10, 200, 60]; }, 'outside the bounds polygon');
  one('camp outside region', (o) => { o.camps[0].at = [80, 80]; o.camps[0].members = []; }, 'outside region aa');
  one('empty title', (o) => { o.quests[0].title = ''; }, 'title is empty');
  one('NEEDS WRITER left', (o) => { o.quests[0].steps[0].journal = 'NEEDS WRITER'; }, 'NEEDS WRITER');
}

// QUEST-TEXT-LINT-01 (R19): one fixture per violation kind + allow-list may only shrink
{
  const q = (o) => lintQuestText([{ path: 'content/quests/x.quest.json', json: { objectives: [{ id: 'mq.a', text: 'ok', journal: 'ok', ...o }] } }]);
  const d = (o) => lintQuestText([{ path: 'content/dialogue/x.dialogue.json', json: { nodes: { 'n.1': { text: 'ok', next: 'mq.a', ...o } } } }]);
  const kinds = (h) => h.map((x) => x.kind).join(',');
  ok('R19 clean', kinds(q({})) === '' && kinds(d({})) === '');
  ok('R19 id fields are fine', kinds(d({ setFlag: 'q.mq.a.accept' })) === '');
  ok('R19 NEEDS WRITER', kinds(q({ text: 'NEEDS WRITER' })) === 'writer');
  ok('R19 raw id', kinds(q({ text: 'Open sq.hw.pier now' })) === 'id' && kinds(d({ text: 'See note.owBoard' })) === 'id');
  ok('R19 Esc hint', kinds(d({ text: 'Esc to close' })) === 'esc');
  ok('R19 objective > 38', kinds(q({ journal: 'x'.repeat(39) })) === 'objlen' && kinds(q({ journal: 'x'.repeat(38) })) === '');
  ok('R19 talk line > 56', kinds(d({ text: 'x'.repeat(57) })) === 'talklen' && kinds(d({ text: 'x'.repeat(56) })) === '');
  const hit = q({ journal: 'x'.repeat(40) });
  ok('R19 unlisted hit fails', applyR19Allow(hit, {}).length === 1);
  ok('R19 allow-list covers hit', applyR19Allow(hit, { 'content/quests/x.quest.json|objlen': 1 }).length === 0);
  ok('R19 stale allow-list entry fails (may only shrink)', applyR19Allow([], { 'content/quests/x.quest.json|objlen': 1 }).length === 1);
  ok('R19 growth fails', applyR19Allow([...hit, ...q({ journal: 'y'.repeat(40) })], { 'content/quests/x.quest.json|objlen': 1 }).length === 1);
  { const g = groupR19ByPack([...hit, ...hit, { file: 'content/quests/other.json', kind: 'objlen', where: 'a', text: 'z' }, { file: 'content/quests/ch3/pack.json', kind: 'esc', where: 'b', text: 'Esc' }], { 'content/quests/x.quest.json|objlen': 2, 'content/quests/other.json|objlen': 1 });
    ok('R19 groupByPack groups allow-listed hits per pack', Object.keys(g).sort().join() === 'other.json,x.quest.json' && g['x.quest.json'].length === 2 && g['other.json'].length === 1); }
  ok('R19 real allow-list only shrinks (total <= 93, QUEST-WRITER-BATCH-01)', Object.values(R19_ALLOW).reduce((a, b) => a + b, 0) <= 93);
  ok('R19 real allow-list is non-negative ints', Object.values(R19_ALLOW).every((n) => Number.isInteger(n) && n > 0));
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
  console.error('FAILURES:');
  for (const f of failures) console.error(' -', f);
  process.exitCode = 1;
}
