// OCCL-MAIN-01: option parsing (on/off/gl2/capture default) + invalidateHzb on every cut event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOccl, createHzbInvalidator } from './occlGate.js';

const P = (s) => new URLSearchParams(s);

test('parseOccl: default off, explicit on, gl2 no-op, capture pages stay off without ?occl=1', () => {
  assert.deepEqual(parseOccl(P(''), 'webgpu'), { requested: false, enabled: false, occl: false });
  assert.deepEqual(parseOccl(P('gpucompare=1'), 'webgpu'), { requested: false, enabled: false, occl: false });
  assert.deepEqual(parseOccl(P('bench=1&capture=1'), 'webgpu'), { requested: false, enabled: false, occl: false });
  assert.deepEqual(parseOccl(P('occl=0'), 'webgpu'), { requested: false, enabled: false, occl: false });
  assert.deepEqual(parseOccl(P('occl=1'), 'webgpu'), { requested: true, enabled: true, occl: true });
  assert.deepEqual(parseOccl(P('gpucompare=1&occl=1'), 'webgpu'), { requested: true, enabled: true, occl: true });
  assert.deepEqual(parseOccl(P('occl=1'), 'webgl2'), { requested: true, enabled: false, occl: false });
});

test('parseOccl: occl=2 -> occl 2 (stats), webgl2 stays off', () => {
  assert.deepEqual(parseOccl(P('occl=2'), 'webgpu'), { requested: true, enabled: true, occl: 2 });
  assert.deepEqual(parseOccl(P('occl=2'), 'webgl2'), { requested: true, enabled: false, occl: false });
});

test('invalidator: teleport/respawn/world swap/resize/title-menu each call invalidateHzb; jumps auto-detected', () => {
  const calls = [];
  const inv = createHzbInvalidator(() => ({ invalidateHzb: () => calls.push(1) }));
  for (const r of ['teleport', 'respawn', 'world-load', 'resize', 'title-new', 'title-continue']) inv.invalidate(r);
  assert.equal(calls.length, 6);
  assert.equal(inv.lastReason, 'title-continue');
  inv.trackPose(0, 0, 0); inv.trackPose(0.5, 0, 0);
  assert.equal(calls.length, 6, 'walking does not invalidate');
  inv.trackPose(100, 0, 0);
  assert.equal(calls.length, 7, 'pose jump invalidates');
  assert.equal(inv.lastReason, 'pose-jump');
});

test('invalidator: no pipeline (gl2 / occl off) is a safe no-op', () => {
  const inv = createHzbInvalidator(() => null);
  assert.equal(inv.invalidate('resize'), false);
  inv.trackPose(0, 0, 0); inv.trackPose(500, 0, 0);
  assert.equal(inv.count, 0);
});

test('invalidator: also calls invalidateHistory (US-073c stable pass) when the pipeline has it', () => {
  const calls = [];
  const inv = createHzbInvalidator(() => ({ invalidateHzb: () => calls.push('hzb'), invalidateHistory: () => calls.push('hist') }));
  inv.invalidate('teleport');
  assert.deepEqual(calls, ['hzb', 'hist']);
});
