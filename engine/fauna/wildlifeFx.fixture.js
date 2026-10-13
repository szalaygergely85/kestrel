// Test fixture: a copy of the rabbit + deer data shape of ASSETS.wildlifeFx (design/models/voxel_wildlife.js).
// The engine must not import design/, so tests use this copy. Keep it in step with the design data shape.
export const FIXTURE_FX = {
  version: 1,
  states: ['idle', 'graze', 'move', 'flee', 'alert'],
  animals: {
    rabbit: {
      models: ['rabbit'],
      clipFor: { idle: 'idle', graze: 'graze', move: 'hop', flee: 'run', alert: 'alert' },
      enter: { alert: 'sitUp' },
      once: { sitUp: 'alert' },
      gaits: [
        { clip: 'hop', tunedMps: 0.6, minMps: 0.3, maxMps: 1.5, rate: [0.6, 2.0] },
        { clip: 'run', tunedMps: 1.8, minMps: 1.5, maxMps: 8.0, rate: [1.0, 1.6] },
      ],
      speeds: { wander: 0.7, flee: 5.5, fleeBurst: 7.0 },
      dist: { notice: 12, alert: 9, flee: 5, fleeIfRunning: 9, safe: 22 },
      times: { idle: [2, 6], graze: [4, 12], alert: [1.5, 4], wanderHopM: [0.5, 3] },
      flee: { turnDegPerS: 540, zigzagDeg: 35, zigzagEveryS: 0.5, maxDistM: 30, hideOrDespawn: true },
      blendMs: 120,
      groupSize: [1, 3],
    },
    deer: {
      models: ['deer', 'deerBuck'],
      clipFor: { idle: 'idle', graze: 'graze', move: 'walk', flee: 'gallop', alert: 'alert' },
      extra: { trot: 'trot' },
      gaits: [
        { clip: 'walk', tunedMps: 0.75, minMps: 0.3, maxMps: 1.4, rate: [0.5, 1.8] },
        { clip: 'trot', tunedMps: 2.4, minMps: 1.4, maxMps: 4.0, rate: [0.6, 1.6] },
        { clip: 'gallop', tunedMps: 9.0, minMps: 4.0, maxMps: 13.0, rate: [0.6, 1.4] },
      ],
      speeds: { wander: 0.8, nervous: 2.4, flee: 9.0 },
      dist: { notice: 35, alert: 25, flee: 16, fleeIfRunning: 25, safe: 60 },
      times: { idle: [3, 8], graze: [6, 20], alert: [2, 5], wanderM: [3, 12] },
      flee: { turnDegPerS: 180, maxDistM: 80, hideOrDespawn: true },
      blendMs: 150,
      groupSize: [1, 4],
      buckChance: 0.3,
    },
  },
};

/** Fake model resolver: rabbit + deer/deerBuck with the clip names the fixture uses. */
export function fixtureModels() {
  const mk = (names) => ({ clipIndex: Object.fromEntries(names.map((n, i) => [n, i])) });
  const rabbit = mk(['idle', 'graze', 'hop', 'run', 'alert', 'sitUp']);
  const deer = mk(['idle', 'graze', 'walk', 'trot', 'gallop', 'alert']);
  return (name) => ({ rabbit, deer, deerBuck: deer }[name]);
}
