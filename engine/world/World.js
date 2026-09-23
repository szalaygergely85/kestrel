// Stub (US-024 Phase A). Real implementation: US-025 (D-007), per
// docs/architecture.md section 7.
export class World {
  static load(def, assets) {
    throw new Error('World.load: not implemented (US-025)');
  }

  spawn(type, transform, components, id) {
    throw new Error('World.spawn: not implemented (US-025)');
  }

  get(id) {
    throw new Error('World.get: not implemented (US-025)');
  }

  remove(id) {
    throw new Error('World.remove: not implemented (US-025)');
  }
}
