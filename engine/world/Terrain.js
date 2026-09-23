// Stub (US-024 Phase A). Real implementation: US-025 (D-007), per
// docs/architecture.md section 7.
export class Terrain {
  constructor(recipe) {
    throw new Error('Terrain: not implemented (US-025)');
  }

  heightAt(x, y) {
    throw new Error('Terrain.heightAt: not implemented (US-025)');
  }

  typeAt(x, y) {
    throw new Error('Terrain.typeAt: not implemented (US-025)');
  }
}
