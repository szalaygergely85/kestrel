// game/js/dev/unitsHarness.js - RE-06 (docs/architecture.md 28.6). Dev harness for
// instanced voxel units: `?units=N` puts a grid of N copies of one voxel model
// (default 'lever', `?unitmodel=<key>`) ahead of the player spawn through
// `engine.instances` - one group, 3 teams, mixed yaws, mid-animation pose.
// Also exports the pieces the `?gpucompare=1&renderer=mesh` pose `unitsInstanced` reuses.
import { Camera, writeUnitInstance, UNIT_OBJECT_BASE, MAX_INSTANCES_PER_FRAME } from '../../../engine/index.js';

/** Yaws used by the grid (0/90 are axis-aligned, 37.5/200 are not). */
export const UNIT_YAWS = [0, 90, 37.5, 200];

/**
 * Placeholder team spec (until the designer adds `team.*` palette entries): the
 * model's first material is the "slot"; team 1 / 2 repaint it with two other
 * palette materials.
 * @param {any} matTable - bound MaterialTable
 * @param {any} pm - PackedVoxelModel of the unit model
 */
export function placeholderTeamSpec(matTable, pm) {
  const slotId = pm.matIds[1];
  const slotKey = matTable.records[slotId].key;
  const keys = Object.keys(matTable.P.materials).filter((k) => matTable.P.materials[k].kind !== 'sky' && k !== slotKey);
  return { slots: [slotKey], teams: [null, { [slotKey]: keys[0] }, { [slotKey]: keys[Math.min(3, keys.length - 1)] }] };
}

/**
 * Fills `group.ib` with `n` units on an `nx` wide grid: x0,y0 = first unit, spacing in m,
 * z = feet height (or `zAt(x, y)`), yaws cycle UNIT_YAWS, teams cycle 0,1,2.
 * @param {any} group - engine.instances group
 */
export function fillUnitGrid(group, n, x0, y0, z, spacing, nx, zAt) {
  for (let i = 0; i < n; i++) {
    const x = x0 + (i % nx) * spacing, y = y0 + Math.floor(i / nx) * spacing;
    writeUnitInstance(group.ib, i, x, y, zAt ? zAt(x, y) : z, UNIT_YAWS[i % UNIT_YAWS.length], UNIT_OBJECT_BASE | i, i % 3);
  }
  group.count = n;
}

let _group = null;
/** `?units=N` entry, called on every 'world:loaded' (main.js). */
export function startUnits(engine, matTable, params, world) {
  if (_group) { engine.instances.remove(_group); _group = null; }
  const n = Math.max(0, Math.min(MAX_INSTANCES_PER_FRAME, parseInt(params.get('units'), 10) || 0));
  if (!n) return;
  const key = params.get('unitmodel') || 'lever';
  const pm = engine.instances.pool && engine.instances.pool.models.get(key);
  if (!pm) { console.warn(`[units] no bound voxel model "${key}"`); return; }
  engine.setTeamMaterials(placeholderTeamSpec(matTable, pm));
  const player = world.get('player');
  const cam = Camera.fromEntity(player.data, engine.physics.eyeHeight);
  const yr = cam.yawDeg * Math.PI / 180;
  const fx = Math.sin(yr), fy = -Math.cos(yr); // forward (main.js/waystone poses convention)
  const nx = Math.ceil(Math.sqrt(n * 2)); // 2:1 wide grid
  const spacing = 1.0;
  const cx = cam.x + fx * (5 + (n / nx) * 0.5), cy = cam.y + fy * (5 + (n / nx) * 0.5);
  // Grid axes: along the view's right vector (x0 + i*spacing must be axis-aligned, so use a
  // world-axis grid centred there; the dev view is a look-at, not a formation).
  const x0 = cx - (nx - 1) * spacing * 0.5, y0 = cy - (Math.ceil(n / nx) - 1) * spacing * 0.5;
  const groundZ = (x, y) => (world.terrain ? world.terrain.groundAt(x, y) : cam.z - engine.physics.eyeHeight);
  const group = engine.instances.group(key, n);
  fillUnitGrid(group, n, x0, y0, 0, spacing, nx, groundZ);
  _group = group;
  console.log(`[units] ${n} x ${key} at (${cx.toFixed(1)}, ${cy.toFixed(1)}) via engine.instances (1 group)`);
}
