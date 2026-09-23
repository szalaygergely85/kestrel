// Stub surface only (US-024, owner request 2026-09-23 - see
// docs/architecture.md section 10.1 and the US-024 backlog note). The real
// implementation is split across US-025 (handles, events, World.spawn/get),
// US-011 (animation/sprites) and M3 (moveTo steering) - every method here
// throws until its owning story lands; only the shape (fields, method names)
// is normative yet.
//
// @typedef {Object} EntityHandle
// @property {string} id
// @property {import('../world/World.js').World} world
// @property {boolean} alive
export class EntityHandle {
  constructor(world, id) {
    this.world = world;
    this.id = id;
    this.alive = true;
  }

  /** @returns {Object} the live entity data (not a copy) */
  get data() {
    throw new Error('EntityHandle.data: not implemented (US-025)');
  }

  play(anim, opts) {
    throw new Error('EntityHandle.play: not implemented (US-011)');
  }

  stop() {
    throw new Error('EntityHandle.stop: not implemented (US-011)');
  }

  onAnimEnd(fn) {
    throw new Error('EntityHandle.onAnimEnd: not implemented (US-011)');
  }

  moveTo(x, y, opts) {
    throw new Error('EntityHandle.moveTo: not implemented (M3)');
  }

  lookAt(x, y) {
    throw new Error('EntityHandle.lookAt: not implemented (US-025)');
  }

  setComponent(name, value) {
    throw new Error('EntityHandle.setComponent: not implemented (US-025)');
  }

  getComponent(name) {
    throw new Error('EntityHandle.getComponent: not implemented (US-025)');
  }

  on(event, fn) {
    throw new Error('EntityHandle.on: not implemented (US-025)');
  }

  remove() {
    throw new Error('EntityHandle.remove: not implemented (US-025)');
  }
}
