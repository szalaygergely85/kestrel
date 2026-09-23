// Stub (US-024 Phase A). Real implementation: US-025 splits Player.update
// into plain-data `Entity` + this generic `integrate()`, per
// docs/architecture.md sections 5 and 7.1. Until then the step logic lives
// in game/js/entities/Player.js (US-024 Phase C moves it to
// engine/entities/Player.js unchanged; US-025 does the actual split).
export function integrate(entity, dt, controls, world, cfg) {
  throw new Error('integrate: not implemented (US-025)');
}
