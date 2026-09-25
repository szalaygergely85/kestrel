// engine/entities/EntityHandle.js (US-025, docs/architecture.md 10.1). A
// thin, cached view over a `World`'s entity data - the entity data is the
// only authoritative state (D-006); this handle holds none of its own
// besides `id`/`world`/`alive`, so `deserialize` (a new World) makes every
// old handle report `alive === false` for free.
//
// `play`/`stop`/`onAnimEnd` (US-011, docs/architecture.md 10.1) sit on top
// of `animation.js`'s clip compiler/player.
import { compileClip, compileVoxelClip, warnUnknownAnimOnce } from './animation.js';

let warnedDeadOnce = new WeakSet();

export class EntityHandle {
  constructor(world, id) {
    this.world = world;
    this.id = id;
    this.alive = true;
  }

  /** @returns {Object|null} the live entity data (not a copy) */
  get data() {
    return this.world.entity(this.id) || null;
  }

  _deadNoop(method) {
    if (!warnedDeadOnce.has(this)) {
      warnedDeadOnce.add(this);
      console.warn(`EntityHandle.${method}: called on a dead handle (id "${this.id}") - no-op.`);
    }
  }

  /**
   * `components.sprite.{anim, frame:0, t:0, loop, speed, playing:true}` (or
   * `components.voxel`, same shape - US-041a, 15.3 item 1: `sprite ?? voxel`,
   * never both). Same anim already playing + `restart` false: no-op (safe to
   * call every frame). Unknown anim (or no sprite/voxel/assets to resolve
   * it): `console.error` once, no-op - never throws mid-step.
   */
  play(anim, opts = {}) {
    if (!this.alive) { this._deadNoop('play'); return this; }
    const d = this.data;
    if (!d) { this._deadNoop('play'); return this; }
    const sprite = d.components.sprite, voxel = d.components.voxel;
    const comp = sprite || voxel;
    if (!comp) { console.warn(`EntityHandle.play: entity "${this.id}" has no sprite/voxel component - ignored.`); return this; }
    const assets = this.world.assets;
    const model = assets && assets.has('model', comp.model) ? assets.model(comp.model) : null;
    const animDef = sprite
      ? (model && model.animations && model.animations[anim])
      : (model && model.voxel && model.voxel.animations && model.voxel.animations[anim]);
    if (!animDef) { warnUnknownAnimOnce(comp.model, anim); return this; }
    const restart = !!opts.restart;
    if (!restart && comp.anim === anim && comp.playing) return this;
    comp.anim = anim;
    comp.frame = 0;
    comp.t = 0;
    comp.loop = opts.loop !== undefined ? opts.loop : !!animDef.loop;
    comp.speed = opts.speed !== undefined ? opts.speed : 1;
    comp.playing = true;
    const clip = sprite ? compileClip(animDef) : compileVoxelClip(animDef);
    const tag0 = clip.tagCodes[0];
    if (tag0) this.world._emit(this.id, tag0, undefined);
    this.world.renderVersion++;
    return this;
  }

  /** `sprite.playing = false` (or `voxel.playing`) - holds the current frame. */
  stop() {
    if (!this.alive) { this._deadNoop('stop'); return this; }
    const d = this.data;
    if (!d) { this._deadNoop('stop'); return this; }
    const comp = d.components.sprite || d.components.voxel;
    if (comp) comp.playing = false;
    this.world.renderVersion++;
    return this;
  }

  /** Sugar for `on('animEnd', fn)`. */
  onAnimEnd(fn) {
    return this.on('animEnd', fn);
  }

  /** Writes `components.move` (steered by the M3 move system through `integrate`); warns once, not yet consumed. */
  moveTo(x, y, opts = {}) {
    if (!this.alive) return this._deadNoop('moveTo');
    const d = this.data;
    if (!d) return this._deadNoop('moveTo');
    d.components.move = {
      tx: x, ty: y,
      speed: typeof opts.speed === 'number' ? opts.speed : 1,
      arriveR: typeof opts.arriveR === 'number' ? opts.arriveR : 0.2,
      active: true,
    };
    if (!EntityHandle._warnedMoveTo) {
      EntityHandle._warnedMoveTo = true;
      console.warn('EntityHandle.moveTo: components.move written, but no steering system consumes it yet (M3).');
    }
    this.world.renderVersion++;
    return this;
  }

  /** Compass yaw toward (x, y): 0 = N = -y, clockwise (MAP_FORMAT convention). */
  lookAt(x, y) {
    if (!this.alive) { this._deadNoop('lookAt'); return this; }
    const d = this.data;
    if (!d) { this._deadNoop('lookAt'); return this; }
    const ex = d.transform.x, ey = d.transform.y;
    let deg = Math.atan2(x - ex, -(y - ey)) * 180 / Math.PI;
    deg = ((deg % 360) + 360) % 360;
    d.transform.yawDeg = deg;
    this.world.renderVersion++;
    return this;
  }

  /** `components[name] = value` (JSON-safe only; `null` deletes it). */
  setComponent(name, value) {
    if (!this.alive) { this._deadNoop('setComponent'); return this; }
    const d = this.data;
    if (!d) { this._deadNoop('setComponent'); return this; }
    if (value === null) delete d.components[name];
    else d.components[name] = value;
    this.world.renderVersion++;
    return this;
  }

  getComponent(name) {
    const d = this.data;
    return d ? d.components[name] : undefined;
  }

  /** Per-entity listener: `fn(handle, name, arg)`. Returns an `off()`. */
  on(event, fn) {
    if (!this.alive) { this._deadNoop('on'); return () => {}; }
    this.world._addListener(this.id, event, fn);
    return () => this.world._removeListener(this.id, event, fn);
  }

  /** Deletes the entity, emits `removed` (this handle) then `entity:removed` (engine.events), drops listeners/cache. */
  remove() {
    if (!this.alive) { this._deadNoop('remove'); return; }
    this.world._removeEntityAndHandle(this.id, this);
  }
}
