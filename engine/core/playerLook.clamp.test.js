// RE-02b b2: pitch clamp option (35 default = shear, 70 on the pitched camera). playerLook.test.js stays unchanged.
import { PlayerLook } from './playerLook.js';
import { Camera } from '../entities/Camera.js';

let fail = 0;
const ok = (n, c) => { if (!c) { fail++; console.error('FAIL:', n); } else console.log('ok:', n); };

globalThis.document = Object.assign(new EventTarget(), { pointerLockElement: null, exitPointerLock() {} });
globalThis.window = new EventTarget();
const canvas = Object.assign(new EventTarget(), { requestPointerLock() {} });
const input = { isDown: () => false, consumeMouse: () => ({ dx: 0, dy: 0 }) };

ok('PlayerLook default clamps 35', new PlayerLook(canvas, input, 0, 80).pitchDeg === 35);
ok('PlayerLook default clamps -35', new PlayerLook(canvas, input, 0, -80).pitchDeg === -35);
ok('PlayerLook pitchClampDeg 70 keeps 60', new PlayerLook(canvas, input, 0, 60, { pitchClampDeg: 70 }).pitchDeg === 60);
ok('PlayerLook pitchClampDeg 70 clamps 85 -> 70', new PlayerLook(canvas, input, 0, 85, { pitchClampDeg: 70 }).pitchDeg === 70);
ok('Camera.clampPitch default 35', Camera.clampPitch(50) === 35 && Camera.clampPitch(-50) === -35);
ok('Camera.clampPitch 70', Camera.clampPitch(50, 70) === 50 && Camera.clampPitch(-90, 70) === -70);
const ent = { transform: { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: -60 }, components: {} };
ok('fromEntityInto default 35 / option 70', Camera.fromEntityInto(ent, 0, new Camera()).pitchDeg === -35 && Camera.fromEntityInto(ent, 0, new Camera(), 70).pitchDeg === -60);
if (fail) process.exit(1);
console.log('ALL PASS');
