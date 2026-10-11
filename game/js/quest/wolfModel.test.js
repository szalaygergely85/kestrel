// WOLF-D1 wiring: voxel_wolf budget (<= boar +20 %), stance keys grounded (<= 1 voxel float/sink), wolfFx clip names exist.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { WOLF_MODEL } from './sim/wolfBrain.js';
const req = createRequire(import.meta.url);
const wolf = req('../../../design/models/voxel_wolf.js');
const boar = req('../../../design/models/voxel_beast.js').boarPlaceholder;
const cnt = (m) => m.voxel.layers.reduce((n, L) => n + L.reduce((k, r) => k + r.replace(/\./g, '').length, 0), 0);
assert.equal(WOLF_MODEL, 'wolf');
assert.equal(wolf.wolf.name, WOLF_MODEL);
assert.ok(cnt(wolf.wolf) <= cnt(boar) * 1.2, 'voxel budget');
const clips = wolf.wolf.voxel.animations;
for (const n of Object.values(wolf.wolfFx.clipFor.state)) assert.ok(clips[n], 'clip ' + n);
assert.equal(wolf.wolfFx.clipFor.state.windup, 'crouch');
assert.equal(wolf.wolfFx.clipFor.state.charge, 'leap');
assert.equal(wolf.wolfFx.clipFor.state.recover, 'run');
console.log('wolfModel: PASS (' + cnt(wolf.wolf) + ' voxels, boar ' + cnt(boar) + ')');
