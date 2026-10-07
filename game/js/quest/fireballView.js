// game/js/quest/fireballView.js (SPELL-01b, docs/architecture.md 37.14 + D-042 item 2). Presentation of the fireball sim:
//  - ONE persistent trail emitter per ball, keyed by the slot's `serial` (sim side: `stepFx`, right after fireball.step);
//  - a moving warm light per ball + 2 flash lights + the spell-hand coal glow, all bound ONCE per world load (`bind`),
//    never removed, radius never changed afterwards (flash fades by intensity only);
//  - the flame core / burst blast billboards, pushed through the sprite system's `extra(pool)` callback;
//  - the burst: embers + smoke (+ cinders on a ground hit) sim side, flash light, camera kick (render eye only).
// Reads the designer data `ASSETS.spellFx` (design/models/spell.js). No engine change, nothing in sim/ changes.
// 0 allocation per step/frame: all state is in typed arrays, the `extra` callback is created once.
import { SIM_STEP, MAX_LIGHTS } from '../../../engine/index.js';

const N_FLASH = 2;     // flash lights alive at most (oldest overwritten)
const N_BURST = 4;     // burst sprite/kick records
const MAX_PENDING = 8; // bursts per sim step (cap 4 balls)
const BLAST_END_MS = [40, 80, 130, 190, 260]; // cumulative ends of the 5 blast frames (designer durations 40/40/50/60/70)
const STEP_MS = 1000 / 60;
const FLASH_STEPS = 9;
const _prm = { intensity: 0 }; // reused setParams argument (setParams only reads the keys present)

/**
 * @param {{particles:any, palette:any, fx:any, cfg:any, events:any}} o
 *   fx = ASSETS.spellFx, cfg = FIREBALL_CFG, events = engine.events
 */
export function createFireballView(o) {
  const { particles, palette, fx, cfg, events } = o;
  const N = cfg.maxAlive;
  const defTrail = particles.defIdOf('fireTrail'), defBurst = particles.defIdOf('fireballBurst');
  const defSmoke = particles.defIdOf('fireballSmoke'), defCinders = particles.defIdOf('fireballCinders');
  const bn = fx.burst;

  const lp = palette.lights;
  // one radius per bound light (D-042 item 2): flight 5 m (tap/charged differ by intensity), flash 6 m, ember 2 m
  const pFlight = lp.fireballLightBig, pFlightTap = lp.fireballLight;
  const pFlash = lp.fireballFlash, pFlashBig = lp.fireballFlashBig, pEmber = lp.spellEmber;

  // ---- per-slot trail + light state ----
  const trailH = new Int32Array(N).fill(-1), trailSerial = new Int32Array(N), consumed = new Uint8Array(N);
  const flightL = new Int32Array(N).fill(-1), flightCh = new Int8Array(N).fill(-1);
  const flashL = new Int32Array(N_FLASH).fill(-1);
  let emberL = -1, emberBase = pEmber.intensity;

  // ---- pending bursts (listener -> stepFx) ----
  const pend = { n: 0, x: new Float64Array(MAX_PENDING), y: new Float64Array(MAX_PENDING), z: new Float64Array(MAX_PENDING),
    dx: new Float64Array(MAX_PENDING), dy: new Float64Array(MAX_PENDING), dz: new Float64Array(MAX_PENDING), ch: new Uint8Array(MAX_PENDING) };
  // ---- burst records (sprite + kick) and flash ring ----
  const br = { x: new Float64Array(N_BURST), y: new Float64Array(N_BURST), z: new Float64Array(N_BURST), tick: new Float64Array(N_BURST).fill(-1e9), ch: new Uint8Array(N_BURST), next: 0 };
  const fl = { x: new Float64Array(N_FLASH), y: new Float64Array(N_FLASH), z: new Float64Array(N_FLASH), tick: new Float64Array(N_FLASH).fill(-1e9), ch: new Uint8Array(N_FLASH), on: new Uint8Array(N_FLASH), next: 0 };

  let sim = null, lights = null, off = null;
  let tickF = 0, camX = 0, camY = 0, camZ = 0, alpha = 1;
  const stats = { boundLights: 0, flightBound: 0, flashBound: 0, emberBound: 0, kicks: 0, bursts: 0, trailsCreated: 0 };

  function makeLight(preset, key, on) {
    return lights.add({ x: 0, y: 0, z: 0, hue: palette.hue[preset.color], intensity: preset.intensity, radius: preset.radius,
      flicker: preset.flicker || null, on, key });
  }

  // fireball:burst listener (sim side, payload object is reused by the sim: copy the numbers now)
  function onBurst(p) {
    stats.bursts++;
    const sl = sim.slots;
    let s = -1;
    for (let i = 0; i < N; i++) if (sl.alive[i] === 0 && trailSerial[i] !== 0 && consumed[i] === 0) { s = i; break; } // the ball that just died
    if (s < 0) { // point-blank cast burst: the slot was never stepped; it is the newest serial among the dead slots
      let best = -1;
      for (let i = 0; i < N; i++) if (sl.alive[i] === 0 && sl.serial[i] > best) { best = sl.serial[i]; s = i; }
    }
    if (s >= 0) consumed[s] = 1;
    const ch = p.charged ? 1 : 0;
    if (pend.n < MAX_PENDING) {
      const k = pend.n++;
      pend.x[k] = p.x; pend.y[k] = p.y; pend.z[k] = p.z; pend.ch[k] = ch;
      pend.dx[k] = s >= 0 ? sl.dx[s] : 0; pend.dy[k] = s >= 0 ? sl.dy[s] : 0; pend.dz[k] = s >= 0 ? sl.dz[s] : -1;
    }
    const t = sim.tick;
    let b = br.next; br.next = (b + 1) % N_BURST;
    br.x[b] = p.x; br.y[b] = p.y; br.z[b] = p.z; br.tick[b] = t; br.ch[b] = ch;
    b = fl.next; fl.next = (b + 1) % N_FLASH; // 2-slot ring: the oldest flash is overwritten
    fl.x[b] = p.x; fl.y[b] = p.y; fl.z[b] = p.z; fl.tick[b] = t; fl.ch[b] = ch; fl.on[b] = 1;
  }

  function resetState() {
    trailH.fill(-1); trailSerial.fill(0); consumed.fill(0); flightL.fill(-1); flightCh.fill(-1); flashL.fill(-1); emberL = -1;
    pend.n = 0; br.tick.fill(-1e9); br.next = 0; fl.tick.fill(-1e9); fl.on.fill(0); fl.next = 0;
    stats.boundLights = stats.flightBound = stats.flashBound = stats.emberBound = 0;
  }

  const view = {
    stats, bursts: br, flashes: fl,
    get flightLights() { return flightL; }, get flashLights() { return flashL; }, get emberLight() { return emberL; },
    get trailHandles() { return trailH; },

    /**
     * On every 'world:loaded', after `buildLightSet` AND the fireball sim exist. Binds up to 4 flight + 2 flash lights
     * (+ 1 ember glow) `on: false` (never `remove`d); if the 16-light cap leaves less room it binds fewer, flash first.
     * @param {any} fireballSim @param {any} lightSet LightSet or null (`?lights=0`)
     */
    bind(fireballSim, lightSet) {
      if (off) { off(); off = null; }
      resetState();
      sim = fireballSim; lights = lightSet;
      if (!sim) return;
      off = events.on('fireball:burst', onBurst);
      if (!lights) return;
      let room = MAX_LIGHTS - lights.count;
      if (room < N + N_FLASH) console.warn(`[fireballView] only ${room} free lights (need ${N + N_FLASH}); binding fewer`);
      for (let i = 0; i < N_FLASH && room > 0; i++, room--) { flashL[i] = makeLight(pFlash, `fireball.flash.${i}`, false); stats.flashBound++; }
      for (let i = 0; i < N && room > 0; i++, room--) { flightL[i] = makeLight(pFlight, `fireball.flight.${i}`, false); stats.flightBound++; }
      if (room > 0) { emberL = makeLight(pEmber, 'fireball.ember', false); stats.emberBound++; }
      stats.boundLights = stats.flashBound + stats.flightBound + stats.emberBound;
    },

    /**
     * SIM side, called right after `fireball.step` (the particle sim is hashed: never from the render pose).
     * One persistent trail emitter per ball serial; bursts queued by the listener become particles here.
     */
    stepFx() {
      if (!sim) return;
      const sl = sim.slots;
      for (let s = 0; s < N; s++) {
        if (sl.alive[s] === 1) {
          const serial = sl.serial[s];
          if (trailSerial[s] !== serial) {
            if (trailH[s] >= 0) particles.release(trailH[s]);
            const h = particles.createEmitter(defTrail, sl.x[s], sl.y[s], sl.z[s]);
            trailH[s] = h; trailSerial[s] = serial; consumed[s] = 0; stats.trailsCreated++;
            if (h >= 0) particles.setOn(h, true);
          }
          const h = trailH[s];
          if (h >= 0) {
            particles.setEmitterPos(h, sl.x[s], sl.y[s], sl.z[s]);
            particles.setEmitterDir(h, -sl.dx[s], -sl.dy[s], -sl.dz[s]);
            if (sl.charged[s] === 1 && (sl.age[s] & 1) === 0) particles.burst(h, 1); // charged: 2 sparks / 2 steps = 60/s
          }
        } else if (trailSerial[s] !== 0) {
          if (trailH[s] >= 0) particles.release(trailH[s]);
          trailH[s] = -1; trailSerial[s] = 0; consumed[s] = 0;
        }
      }
      for (let k = 0; k < pend.n; k++) {
        const ch = pend.ch[k] === 1, x = pend.x[k], y = pend.y[k], z = pend.z[k];
        const dx = pend.dx[k], dy = pend.dy[k], dz = pend.dz[k];
        particles.burstAt(defBurst, x, y, z, ch ? 28 : 20, -dx, -dy, -dz);
        particles.burstAt(defSmoke, x, y, z, ch ? 12 : 8, 0, 0, 1);
        if (-dz >= 0.7) particles.burstAt(defCinders, x, y, z + dz * 0.1 + 0.03, ch ? 10 : 6, 0, 0, 1); // ground hit
      }
      pend.n = 0;
    },

    /**
     * Per rendered frame, BEFORE `lightSet.update`. Moves/lights the bound lights; stores the time + eye for `extra`/kick.
     * @param {number} a render interpolation alpha (0..1) @param {{x:number,y:number,z:number}} cam
     */
    present(a, cam) {
      if (!sim) return;
      alpha = a; tickF = sim.tick - 1 + a; camX = cam.x; camY = cam.y; camZ = cam.z;
      if (!lights) return;
      const sl = sim.slots, back = (1 - a) * SIM_STEP;
      for (let s = 0; s < N; s++) {
        const h = flightL[s];
        if (h < 0) continue;
        if (sl.alive[s] === 0) { lights.setOn(h, false); flightCh[s] = -1; continue; }
        const d = sl.speed[s] * back;
        lights.move(h, sl.x[s] - sl.dx[s] * d, sl.y[s] - sl.dy[s] * d, sl.z[s] - sl.dz[s] * d);
        lights.setOn(h, true);
        if (flightCh[s] !== sl.charged[s]) { // tap 0.9 / charged 1.1, intensity only (radius stays bound at 5 m)
          flightCh[s] = sl.charged[s];
          _prm.intensity = sl.charged[s] === 1 ? pFlight.intensity : pFlightTap.intensity;
          lights.setParams(h, _prm);
        }
      }
      for (let f = 0; f < N_FLASH; f++) {
        const h = flashL[f];
        if (h < 0 || fl.on[f] === 0) continue;
        const age = tickF - fl.tick[f];
        if (age >= FLASH_STEPS) { lights.setOn(h, false); fl.on[f] = 0; continue; }
        const k = 1 - (age < 0 ? 0 : age) / FLASH_STEPS; // designer envelope (1 - age/9)^2
        _prm.intensity = (fl.ch[f] === 1 ? pFlashBig.intensity : pFlash.intensity) * k * k;
        lights.move(h, fl.x[f], fl.y[f], fl.z[f]);
        lights.setParams(h, _prm);
        lights.setOn(h, true);
      }
    },

    /** The spell-hand coal glow: world position from the eye-space mount, intensity = preset * glow multiplier. */
    presentEmber(on, glow, wx, wy, wz) {
      if (!lights || emberL < 0) return;
      if (!on) { lights.setOn(emberL, false); return; }
      lights.move(emberL, wx, wy, wz);
      _prm.intensity = emberBase * glow;
      lights.setParams(emberL, _prm);
      lights.setOn(emberL, true);
    },

    /** Passed as `extra` to `sprites.render(fb, world, cam, extra)`: pushes the cores + blasts between collect and project. */
    extra: (pool) => {
      if (!sim) return;
      const sl = sim.slots, back = (1 - alpha) * SIM_STEP;
      for (let s = 0; s < N; s++) {
        if (sl.alive[s] === 0) continue;
        const d = sl.speed[s] * back;
        const frame = ((sl.age[s] / 5 | 0) + s * 3) & 3; // 12 fps, per-slot phase: two balls never flicker in step
        pool.push(sl.charged[s] === 1 ? 'fireballCoreCharged' : 'fireballCore', 'fly', frame,
          sl.x[s] - sl.dx[s] * d, sl.y[s] - sl.dy[s] * d, sl.z[s] - sl.dz[s] * d);
      }
      for (let b = 0; b < N_BURST; b++) {
        const ms = (tickF - br.tick[b]) * STEP_MS;
        if (ms < 0 || ms >= BLAST_END_MS[4]) continue;
        let fr = 0;
        while (ms >= BLAST_END_MS[fr]) fr++;
        // 0.25 m toward the eye so the blast is not half inside a wall
        let ux = camX - br.x[b], uy = camY - br.y[b], uz = camZ - br.z[b];
        const l = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
        const k = 0.25 / l;
        pool.push(br.ch[b] === 1 ? 'fireballBlastCharged' : 'fireballBlast', 'burst', fr, br.x[b] + ux * k, br.y[b] + uy * k, br.z[b] + uz * k);
      }
    },

    /** Camera kick in degrees (render eye only): 1.5 (charged 2.5) decaying over 9 steps for a burst within 6 m. */
    kickDeg() {
      let best = 0;
      const k = bn.kick, w2 = k.withinM * k.withinM;
      for (let b = 0; b < N_BURST; b++) {
        const age = tickF - br.tick[b];
        if (age < 0 || age >= k.steps) continue;
        const dx = br.x[b] - camX, dy = br.y[b] - camY, dz = br.z[b] - camZ;
        if (dx * dx + dy * dy + dz * dz > w2) continue;
        const v = (br.ch[b] === 1 ? k.degCharged : k.deg) * (1 - age / k.steps);
        if (v > best) best = v;
      }
      return best;
    },

    dispose() { if (off) { off(); off = null; } },
  };
  return view;
}
