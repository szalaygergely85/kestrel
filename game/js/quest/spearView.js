// game/js/quest/spearView.js (GOB-07a, architecture.md 38.57 GOB-07; designer notes: ASSETS.goblinFx.spear).
// Presentation of the enemy spear sim (arrows.js, owner 'enemy'): one pooled `goblinSpear` voxel entity per flying slot and
// per stuck slot. FLY: entity at the balance point, yaw = flight direction, pitch via voxel.partRot (rx + = nose down).
// STUCK: at the hit point, plays stuckWobble for ~14 steps, then stuck. BLOCKED (stuck dir = straight down, from
// beast:spearBlocked): put on the ground under the hit point, plays blocked. Free slots are hidden. 0 alloc per frame.
// Presentation only: reads the sim's SoA, writes only its own entities' transform + voxel component.
import { yawFromDelta } from '../../../engine/index.js';

const WOBBLE_STEPS = 14;         // stuckWobble is 240 ms; then the (identical) held stuck pose
const RAD2DEG = 180 / Math.PI;

/**
 * @param {{world:any, sim:ReturnType<typeof import('./sim/arrows.js').createArrowSim>, groundAt?:(x:number,y:number)=>number,
 *   model?:string, clips?:{fly:string,stuck:string,hit:string,blocked:string}}} o
 */
export function createSpearView({ world, sim, groundAt, model = 'goblinSpear', clips }) {
  const fx = globalThis.ASSETS && globalThis.ASSETS.goblinFx;
  const C = clips || (fx && fx.spear && fx.spear.clips) || { fly: 'fly', stuck: 'stuck', hit: 'stuckWobble', blocked: 'blocked' };
  const NF = sim.flying.n, NS = sim.stuck.n;
  const make = (id) => {
    const e = { id, type: 'fx', transform: { x: 0, y: 0, z: -500, yawDeg: 0 },
      components: { voxel: { model, t: 0, frame: 0, speed: 1, playing: true, anim: C.fly, loop: true, hidden: true } } };
    world.addEntity(e);
    return e;
  };
  const fly = [], stk = [];
  for (let i = 0; i < NF; i++) fly.push(make('gspear.f' + i));
  for (let i = 0; i < NS; i++) stk.push(make('gspear.s' + i));
  const stkSerial = new Int32Array(NS).fill(-1);
  const stkBlocked = new Uint8Array(NS);
  const pitches = [];
  for (let i = 0; i < NF; i++) pitches.push({ part: 'shaft', rx: 0, ry: 0, rz: 0 });

  function setClip(v, clip) { if (v.anim !== clip) { v.anim = clip; v.frame = 0; v.t = 0; v.loop = undefined; } }

  return {
    /** once per frame (or sim step), after the arrow sim stepped */
    update() {
      const f = sim.flying;
      for (let i = 0; i < NF; i++) {
        const d = fly[i], v = d.components.voxel;
        if (f.alive[i] === 0) { v.hidden = true; v.partRot = undefined; continue; }
        const t = d.transform, vx = f.vx[i], vy = f.vy[i], vz = f.vz[i];
        t.x = f.x[i]; t.y = f.y[i]; t.z = f.z[i];
        t.yawDeg = yawFromDelta(vx, vy);
        const p = pitches[i];
        p.rx = -Math.atan2(vz, Math.sqrt(vx * vx + vy * vy)) * RAD2DEG; // + = nose down (a rising spear gets a negative value)
        v.partRot = p;
        v.hidden = false; v.playing = true;
        setClip(v, C.fly);
      }
      const s = sim.stuck;
      for (let k = 0; k < NS; k++) {
        const d = stk[k], v = d.components.voxel;
        if (s.alive[k] === 0) { v.hidden = true; stkSerial[k] = -1; continue; }
        const t = d.transform;
        if (stkSerial[k] !== s.serial[k]) { // a new spear landed in this slot: pick the clip family once
          stkSerial[k] = s.serial[k];
          const dx = s.dx[k], dy = s.dy[k];
          stkBlocked[k] = (dx === 0 && dy === 0 && s.dz[k] === -1) ? 1 : 0;
          v.anim = ''; // force a clip reset below
          t.yawDeg = stkBlocked[k] ? (s.serial[k] * 47) % 360 : yawFromDelta(dx, dy);
          t.x = s.x[k]; t.y = s.y[k];
          t.z = stkBlocked[k] && groundAt ? groundAt(s.x[k], s.y[k]) : s.z[k];
        }
        v.partRot = undefined; v.hidden = false; v.playing = true;
        if (stkBlocked[k]) setClip(v, C.blocked);
        else setClip(v, s.age[k] < WOBBLE_STEPS ? C.hit : C.stuck);
      }
    },
    flyEntities: fly, stuckEntities: stk,
    dispose() {
      for (let i = 0; i < NF; i++) world.removeEntity && world.removeEntity(fly[i].id);
      for (let k = 0; k < NS; k++) world.removeEntity && world.removeEntity(stk[k].id);
    },
  };
}
