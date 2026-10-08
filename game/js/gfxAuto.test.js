import assert from 'node:assert/strict';
import { pickQuality, tierFromAdapter, p95 } from './gfxAuto.js';

const rep = (v, n = 60) => Array.from({ length: n }, () => v);
const t = (name, fn) => { fn(); console.log('ok', name); };

const ARC_IGPU = { vendor: 'intel', architecture: 'xe-lpg', description: 'Intel(R) Graphics (0x00007D45)', label: 'ANGLE (Intel, Intel(R) Graphics (0x00007D45) Direct3D11)' };
const RTX4060 = { vendor: 'nvidia', architecture: 'ada', description: 'NVIDIA GeForce RTX 4060 Laptop GPU' };
t('tiers', () => {
  assert.equal(tierFromAdapter(RTX4060).tier, 'high');
  assert.equal(tierFromAdapter(ARC_IGPU).tier, 'medium');
  assert.equal(tierFromAdapter({ vendor: 'intel', architecture: 'gen-12lp', description: 'Intel(R) UHD Graphics 770' }).tier, 'low');
  assert.equal(tierFromAdapter({ vendor: 'intel', description: 'Intel(R) Arc(TM) A770 Graphics' }).tier, 'high');
  assert.equal(tierFromAdapter({ vendor: 'amd', description: 'AMD Radeon(TM) Graphics' }).tier, 'low');
  assert.equal(tierFromAdapter({ vendor: 'amd', architecture: 'rdna-3', description: 'AMD Radeon RX 7800 XT' }).tier, 'high');
  assert.equal(tierFromAdapter({ fallback: true, vendor: 'google', description: 'SwiftShader' }).tier, 'low');
  assert.equal(tierFromAdapter({ vendor: 'apple', architecture: 'metal-3' }).tier, 'medium');
  assert.equal(tierFromAdapter(null).tier, 'medium');
});
t('no / NaN samples -> candidate', () => {
  assert.equal(pickQuality(RTX4060, []).name, 'high');
  assert.equal(pickQuality(RTX4060, null).name, 'high');
  assert.equal(pickQuality(RTX4060, rep(NaN)).name, 'high');
  assert.equal(pickQuality(RTX4060, [3, 3, 3]).name, 'high'); // too few
});
t('NaN ignored among valid', () => {
  assert.equal(pickQuality(RTX4060, [...rep(NaN, 30), ...rep(10, 40)]).name, 'high');
});
t('4060 plausible: 4 ms -> ultra, 9 ms -> high, 20 ms -> medium', () => {
  assert.equal(pickQuality(RTX4060, rep(4)).name, 'ultra');
  assert.equal(pickQuality(RTX4060, rep(9)).name, 'high');
  assert.equal(pickQuality(RTX4060, rep(20)).name, 'medium');
});
t('Arc (MESH-PERF-01: GPU p50 7.1 / p95 8.4 at 240x90) stays medium, heavy -> low', () => {
  const arc = [...rep(7.1, 90), ...rep(8.4, 10)];
  assert.equal(pickQuality(ARC_IGPU, arc).name, 'medium');
  assert.equal(pickQuality(ARC_IGPU, rep(15)).name, 'low');
  assert.equal(pickQuality(ARC_IGPU, rep(2)).name, 'medium'); // never ultra from medium
});
t('at most two steps down; low is floor', () => {
  assert.equal(pickQuality(RTX4060, rep(90)).name, 'low');
  assert.equal(pickQuality({ fallback: true }, rep(90)).name, 'low');
});
t('frame kind never steps up, steps down only on a clear miss', () => {
  assert.equal(pickQuality(RTX4060, rep(16.7), { kind: 'frame' }).name, 'high');
  assert.equal(pickQuality(RTX4060, rep(4), { kind: 'frame' }).name, 'high');
  assert.equal(pickQuality(RTX4060, rep(30), { kind: 'frame' }).name, 'medium');
});
t('p95', () => { assert.ok(Number.isNaN(p95([]))); assert.equal(p95([1, 2, 3, 100]), 100); });
t('reason is a string', () => { const r = pickQuality(RTX4060, rep(9)); assert.match(r.reason, /discrete NVIDIA/); assert.equal(r.tier, 'high'); });
t('vsync-padded GPU timer: gpu 17 ms but frames hold 60 fps -> no step down; real misses still step down', () => {
  assert.equal(pickQuality(RTX4060, rep(17), { frameSamples: rep(16.7) }).name, 'high');
  assert.match(pickQuality(RTX4060, rep(17), { frameSamples: rep(16.7) }).reason, /vsync/);
  assert.equal(pickQuality(RTX4060, rep(17), { frameSamples: rep(28) }).name, 'medium');
  assert.equal(pickQuality(RTX4060, rep(4), { frameSamples: rep(16.7) }).name, 'ultra');
  assert.equal(pickQuality(ARC_IGPU, rep(17), { frameSamples: rep(33) }).name, 'low');
});
t('opts.at = measured preset (redetect)', () => {
  assert.equal(pickQuality(RTX4060, rep(20), { at: 'medium' }).name, 'low');
  assert.equal(pickQuality(RTX4060, rep(5), { at: 'medium' }).name, 'medium');
});

t('tiers from the WebGL label alone (no WebGPU adapter info, arch 2026-10-08)', () => {
  // ANGLE zero-pads the device id: Intel Arc iGPUs (0x7Dxx / 0x64xx) must still be 'medium', not 'low'
  assert.equal(tierFromAdapter({ label: 'ANGLE (Intel, Intel(R) Graphics (0x00007D45) Direct3D11 vs_5_0 ps_5_0, D3D11)' }).tier, 'medium');
  assert.equal(tierFromAdapter({ label: 'ANGLE (Intel, Intel(R) Graphics (0x000064A0) Direct3D11 vs_5_0 ps_5_0, D3D11)' }).tier, 'medium');
  assert.equal(tierFromAdapter({ label: 'ANGLE (Intel, Intel(R) UHD Graphics 770 (0x00004680) Direct3D11 vs_5_0 ps_5_0, D3D11)' }).tier, 'low');
});
