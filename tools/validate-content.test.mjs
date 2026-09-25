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
import { validateContent } from './validate-content.mjs';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}
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

// 1. Clean fixture: zero errors.
{
  const a = goodAssets();
  const { errors, checks } = validateContent(a);
  ok('clean fixture reports zero errors', errors.length === 0, JSON.stringify(errors));
  ok('clean fixture ran a non-trivial number of checks', checks > 10, String(checks));
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

// 11. Sanity: a terrain recipe (has util.heightAt) is never treated as a level.
{
  const a = goodAssets();
  const { errors } = validateContent(a);
  ok('terrain recipe produced no findings of its own', !errors.some((e) => e.startsWith('levels.terrainA')), JSON.stringify(errors));
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
  console.error('FAILURES:');
  for (const f of failures) console.error(' -', f);
  process.exitCode = 1;
}
