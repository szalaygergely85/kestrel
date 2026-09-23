// Stub (US-024 Phase A). Real implementation: US-025, per
// docs/architecture.md sections 7 and 10 (plain-data
// `{ id, type, transform, components }`, no class instances in state).
export class Entity {
  static create(type, transform, components) {
    throw new Error('Entity.create: not implemented (US-025)');
  }

  static eye(entity) {
    throw new Error('Entity.eye: not implemented (US-025)');
  }
}
