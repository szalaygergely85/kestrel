// Run: node --expose-gc engine/entities/animClips.test.js (re-spawns itself with --expose-gc if missing)
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createAnimState } from './animState.js';
import { bindClips, applyAnimState } from './animClips.js';
if (typeof globalThis.gc !== 'function') {
  const r = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
const boar = createRequire(import.meta.url)('../../design/models/voxel_beast.js').boarPlaceholder;
// Game-content fixture (the boar has no `attack` clip: the gallop `charge` is the attack).
const BOAR_CLIP_MAP = { idle: 'idle', walk: 'walk', windup: 'windup', attack: 'charge', hurt: 'hurt', die: 'die' };
const st = (clip, frames, loop, events) => ({ clip, frames, frameMs: 100, loop, events });
const mk = () => createAnimState({
  states: { idle: st('idle', 4, true), walk: st('walk', 4, true), windup: st('windup', 5, false),
    attack: st('attack', 4, false, [{ frame: 3, name: 'hit' }]), hurt: st('hurt', 2, false), die: st('die', 3, false) },
  transitions: { windup: 'attack' },
});
for (const c of Object.values(BOAR_CLIP_MAP)) ok(boar.voxel.animations[c], 'boar clip exists ' + c);
let threw = '';
try { bindClips(mk(), boar, { ...BOAR_CLIP_MAP, hurt: 'nope' }); } catch (e) { threw = e.message; }
ok(/"nope"/.test(threw) && /hurt/.test(threw), 'missing clip named: ' + threw);
threw = ''; try { bindClips(mk(), boar, { idle: 'idle' }); } catch (e) { threw = e.message; }
ok(/"walk"/.test(threw), 'unmapped state named');

const s = bindClips(mk(), boar, BOAR_CLIP_MAP);
const ent = { components: { voxel: { model: 'boarPlaceholder', anim: 'idle', frame: 0, t: 0, loop: true, playing: true } } };
const v = ent.components.voxel;
const evs = [];
const cb = (n) => evs.push(n);
applyAnimState(ent, s, 16, cb); ok(v.anim === 'idle', 'idle clip');
s.request('windup'); applyAnimState(ent, s, 16, cb);
ok(v.anim === 'windup' && v.loop === false && v.blendFrom === 'idle', 'windup clip ' + v.anim);
ok(v.blend > 0 && v.blend < 1, 'blend ramps ' + v.blend);
applyAnimState(ent, s, 64, cb); ok(Math.abs(v.blend - 1) < 1e-9, 'blend 1 at 80ms ' + v.blend);
s.request('hurt'); applyAnimState(ent, s, 16, cb); ok(v.anim === 'hurt', 'hurt interrupts windup');
for (let i = 0; i < 20; i++) applyAnimState(ent, s, 16, cb);
ok(v.anim === 'idle', 'hurt ends -> base idle ' + v.anim);
s.request('windup'); for (let i = 0; i < 70; i++) applyAnimState(ent, s, 16, cb);
ok(evs.indexOf('hit') >= 0, 'frame event delivered: ' + evs);
s.request('windup'); applyAnimState(ent, s, 520, cb);
ok(v.anim === 'charge', 'windup -> attack maps to charge ' + v.anim);
s.request('die'); applyAnimState(ent, s, 16, cb);
ok(v.anim === 'die', 'die clip'); s.request('idle');
for (let i = 0; i < 50; i++) applyAnimState(ent, s, 16, cb);
ok(v.anim === 'die' && s.dead, 'die terminal');
// zero alloc steady state
const s2 = bindClips(mk(), boar, BOAR_CLIP_MAP), e2 = { components: { voxel: { anim: 'idle' } } };
const run = (n) => { for (let i = 0; i < n; i++) { if (i % 50 === 0) s2.request(i % 100 ? 'walk' : 'idle'); applyAnimState(e2, s2, 16, cb); } };
run(2000); gc(); const h0 = process.memoryUsage().heapUsed;
run(100000);
const grow = process.memoryUsage().heapUsed - h0;
ok(grow < 1000000, 'steady-state heap growth ' + grow);
console.log(fail ? 'animClips: ' + fail + ' FAILED' : 'animClips: all ok');
process.exit(fail ? 1 : 0);
