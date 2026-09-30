// engine/core/replay.test.js (RE-14, docs/architecture.md 28.5, AC 1).
// Run: node engine/core/replay.test.js
//
// Toy deterministic sim: 64 agents on an open NavGrid, steered by
// engine/nav/steer.js, with a scripted 600-tick waypoint command list and a
// small per-tick integer-seeded rng jitter (so the sim rng stream is
// actually exercised and part of the hash). Verifies: record once, play
// back 10x gives the same checkpoints and final hash every time; a tampered
// command reports `divergedAt`; the JSONL text round-trips.
import { NavGrid } from '../nav/NavGrid.js';
import { createSteer } from '../nav/steer.js';
import { createCommandQueue } from './commands.js';
import { createRng } from './rng.js';
import { createHasher } from './hash.js';
import { createRecorder, createPlayer } from './replay.js';
import { STEP } from './loop.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const N_AGENTS = 64;
const N_TICKS = 600;
const CMD_WAYPOINT = 16;

function openGrid(w, h, cell = 1) {
  const grid = new NavGrid({ x0: 0, y0: 0, w, h, cell });
  grid.terrainCost.fill(1);
  grid._recomputeCost();
  return grid;
}

// Local seeded LCG - script generation only (setup-time, not sim code), same
// pattern engine/nav/steer.test.js uses for its own non-sim randomness.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Builds the fixed 600-tick command script once (deterministic, not the sim
 * rng): every 50 ticks, a random subset of agents gets a new waypoint. */
function buildScript() {
  const rng = lcg(12345);
  const script = [];
  let seqCounter = 0;
  for (let t = 0; t < N_TICKS; t += 50) {
    const n = 1 + Math.floor(rng() * 5);
    const ids = [];
    for (let k = 0; k < n; k++) ids.push(Math.floor(rng() * N_AGENTS));
    const x = 1 + Math.floor(rng() * 38);
    const y = 1 + Math.floor(rng() * 38);
    script.push({
      tick: t, player: 0, seq: seqCounter++, type: CMD_WAYPOINT,
      ids: Int32Array.from(ids), a0: Math.round(x * 1000), a1: Math.round(y * 1000), a2: 500,
    });
  }
  return script;
}

function makeSim(seed) {
  const grid = openGrid(40, 40);
  const steer = createSteer({ maxAgents: N_AGENTS, bounds: { x0: 0, y0: 0, w: 40, h: 40 } });
  for (let i = 0; i < N_AGENTS; i++) {
    steer.addAgent(2 + (i % 8) * 2, 2 + Math.floor(i / 8) * 2, 0.3, 2, 4);
  }
  const q = createCommandQueue({ inputDelay: 1, maxRecords: 256, maxIds: 4096 });
  const rng = createRng(seed);

  function applyCommand(qq, rec) {
    if (qq.type(rec) !== CMD_WAYPOINT) return;
    const x = qq.a0(rec) / 1000;
    const y = qq.a1(rec) / 1000;
    const arriveR = qq.a2(rec) / 1000;
    for (let k = 0; k < qq.nIds(rec); k++) {
      steer.setWaypoint(qq.idAt(rec, k), x, y, arriveR);
    }
  }

  function tick() {
    q.execute(applyCommand);
    // Integer-seeded rng jitter (exercises the sim rng stream so it is part
    // of the hash) - a tiny, bounded nudge, never enough to tunnel a cell.
    for (let i = 0; i < steer._hi; i++) {
      if (!steer.active[i]) continue;
      steer.x[i] += (rng.int(3) - 1) * 0.0005;
      steer.y[i] += (rng.int(3) - 1) * 0.0005;
    }
    steer.step(STEP, grid);
  }

  function hash() {
    const h = createHasher();
    h.reset();
    h.u32(q.tick);
    rng.hashInto(h);
    h.u32(steer.hash());
    return h.value();
  }

  return { q, rng, steer, grid, tick, hash };
}

// ---- record once ------------------------------------------------------------
const script = buildScript();

function record() {
  const sim = makeSim(0xC0FFEE);
  for (const c of script) sim.q.insert(c.tick, c.player, c.seq, c.type, c.ids, c.ids.length, c.a0, c.a1, c.a2);

  const recorder = createRecorder(sim.q, sim.hash, {
    content: 1, world: 'toy', seed: 0xC0FFEE, step: 60, inputDelay: 1, players: [0], start: null,
  });
  for (let t = 0; t < N_TICKS; t++) {
    sim.tick();
    recorder.afterTick(sim.q.tick - 1);
  }
  recorder.end(N_TICKS);
  return recorder.text();
}

const replayText = record();
ok('replay text is non-empty JSONL', replayText.length > 0 && replayText.startsWith('{"kind":"kestrel-replay"'));

function extractEndHash(text) {
  const lines = text.split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l));
  const endLine = lines.find((l) => 'end' in l);
  return endLine ? endLine.h : null;
}
const recordedEndHash = extractEndHash(replayText);
ok('recorded replay has an end hash', typeof recordedEndHash === 'string' && recordedEndHash.length === 8, recordedEndHash);

// ---- play back 10x: same checkpoints and final hash every time --------------
function playback(text) {
  const sim = makeSim(0xC0FFEE);
  const player = createPlayer(text);
  let allChecksOk = true;
  for (let t = 0; t < N_TICKS; t++) {
    player.beforeTick(sim.q);
    sim.tick();
    const h = sim.hash();
    if (!player.check(sim.q.tick - 1, h)) allChecksOk = false;
  }
  const finalHash = sim.hash();
  player.check(N_TICKS, finalHash); // matches the {"end":...} line
  return { divergedAt: player.divergedAt, allChecksOk, finalHash };
}

{
  const results = [];
  for (let i = 0; i < 10; i++) results.push(playback(replayText));
  const allClean = results.every((r) => r.divergedAt === -1 && r.allChecksOk);
  ok('10 playbacks all report no divergence', allClean, JSON.stringify(results));
  const hashes = results.map((r) => r.finalHash);
  const allSame = hashes.every((h) => h === hashes[0]);
  ok('10 playbacks produce the identical final hash', allSame, JSON.stringify(hashes));
  ok('final hash matches the recorded end-line hash', (hashes[0] >>> 0).toString(16).padStart(8, '0') === recordedEndHash,
    `${(hashes[0] >>> 0).toString(16)} vs ${recordedEndHash}`);
}

// ---- a tampered command reports divergedAt -----------------------------------
{
  const lines = replayText.split('\n').filter((l) => l.length > 0);
  let tamperedIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    const l = JSON.parse(lines[i]);
    if ('c' in l) { tamperedIdx = i; l.a[0] += 5000; lines[i] = JSON.stringify(l); break; }
  }
  ok('found a command line to tamper with', tamperedIdx !== -1);
  const tamperedText = lines.map((l) => l + '\n').join('');
  const result = playback(tamperedText);
  ok('tampered replay reports a divergedAt tick', result.divergedAt !== -1, JSON.stringify(result));
}

// ---- JSONL text round-trip ----------------------------------------------------
{
  const lines = replayText.split('\n').filter((l) => l.length > 0);
  const roundTripped = lines.map((l) => JSON.stringify(JSON.parse(l)));
  const matches = lines.every((l, i) => l === roundTripped[i]);
  ok('every line round-trips through parse/stringify unchanged', matches);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
}
