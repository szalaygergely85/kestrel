import assert from 'node:assert/strict';
import { shouldShip } from './pack-filter.mjs';

const yes = ['game/index.html', 'game/js/main.js', 'engine/index.js', 'design/palette.js', 'design/models/hand.js',
  'content/manifest.json', 'content/worlds/world_m1.world.json', 'content/meshes/a.json', 'docs/licence-inventory.json', 'THIRD_PARTY_NOTICES.md'];
const no = ['content/local/x.js', 'design/local/a.png', 'design/vox/a.vox', 'design/vox-cc0/voxel-pack/a.obj', 'design/vox-sb/Objects/Banner.vox',
  'design/meshes/quaternius/x.gltf', 'design/preview/a.html', 'design/README.md', 'game/js/gameKeys.test.js', 'engine/render/x.test.mjs',
  'docs/backlog.md', 'tools/desktop/pack.mjs', 'captures/a.png', 'dist/a.zip', 'package.json', 'AGENTS.md', 'game/js/x.log'];
for (const p of yes) assert.ok(shouldShip(p), `should ship ${p}`);
for (const p of no) assert.ok(!shouldShip(p), `should not ship ${p}`);
assert.ok(!shouldShip('design\vox\a.vox'), 'backslash paths are normalised');
console.log('pack-filter: ok');
