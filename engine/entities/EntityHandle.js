// engine/entities/EntityHandle.js (US-025, docs/architecture.md 10.1). A
// thin, cached view over a `World`'s entity data - the entity data is the
// only authoritative state (D-006); this handle holds none of its own
// besides `id`/`world`/`alive`, so `deserialize` (a new World) makes every
// old handle report `alive === false` for free.
//
// `play`/`stop`/`onAnimEnd` (US-011) and `stepAnimations` (US-011) still
// throw - this story only lands the World/handle/event plumbing they will
// sit on top of, per the tech notes' "keep throwing" list.

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

  play(anim, opts) { // eslint-disable-line no-unused-vars
    throw new Error('EntityHandle.play: not implemented (US-011)');
  }

  stop() {
    throw new Error('EntityHandle.stop: not implemented (US-011)');
  }

  onAnimEnd(fn) { // eslint-disable-line no-unused-vars
    throw new Error('EntityHandle.onAnimEnd: not implemented (US-011)');
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
