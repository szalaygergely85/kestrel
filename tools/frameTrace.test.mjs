// S8-B1-14: Node test for the pure frame-time trace stats (tools/frameTrace.mjs) used by
// tools/route-walk-browser.mjs's --route trace. Synthetic frame arrays only - no browser.
import assert from 'node:assert/strict';
import { pct, fieldStats, buildFrameTrace, toCSV } from './frameTrace.mjs';

let checks = 0;
function ok(condition, message) { checks++; assert.ok(condition, message); }

// pct(): exact nearest-rank percentiles on a known, already-sorted-by-construction set.
{
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // n=10
  ok(pct(v, 0.5) === 6, `p50 of 1..10 is index floor(10*0.5)=5 -> 6, got ${pct(v, 0.5)}`);
  ok(pct(v, 0.95) === 10, `p95 of 1..10 is index floor(10*0.95)=9 -> 10, got ${pct(v, 0.95)}`);
  ok(pct(v, 0.99) === 10, `p99 clamps to last index, got ${pct(v, 0.99)}`);
  ok(pct(v, 1) === 10, `max is the last element, got ${pct(v, 1)}`);
  ok(pct([], 0.5) === null, 'empty array -> null, not NaN/throw');
  ok(pct([NaN, Infinity, -Infinity, 5], 0.5) === 5, 'non-finite values are filtered before ranking');
}

// fieldStats() + buildFrameTrace(): leg split, and an empty leg reports nulls/n=0 rather than
// crashing or silently mixing in another leg's samples.
{
  const records = [
    { leg: 'A', frame: 0, simMs: 1, jsMs: 10 },
    { leg: 'A', frame: 1, simMs: 2, jsMs: 20 },
    { leg: 'A', frame: 2, simMs: 3, jsMs: 30 },
    { leg: 'A', frame: 3, simMs: 4, jsMs: 40 },
    { leg: 'B', frame: 0, simMs: 100, jsMs: 1000 },
  ];
  const sA = fieldStats(records, 'A', 'simMs');
  ok(sA.n === 4 && sA.p50 === 3 && sA.max === 4, `leg A simMs stats exact, got ${JSON.stringify(sA)}`);
  const sEmpty = fieldStats(records, 'C', 'simMs'); // leg C has zero records
  ok(sEmpty.n === 0 && sEmpty.p50 === null && sEmpty.p95 === null && sEmpty.max === null,
    `empty leg -> all nulls, n=0, got ${JSON.stringify(sEmpty)}`);

  const trace = buildFrameTrace(records, { legs: ['A', 'B', 'C'], fields: ['simMs', 'jsMs'] });
  ok(trace.frames === 5, `trace.frames counts all records regardless of leg, got ${trace.frames}`);
  ok(Object.keys(trace.legs).join(',') === 'A,B,C', 'leg order follows the explicit opts.legs list');
  ok(trace.legs.A.simMs.p50 === 3, 'leg A carried through buildFrameTrace unchanged');
  ok(trace.legs.B.simMs.n === 1 && trace.legs.B.simMs.max === 100, 'leg B isolated from leg A');
  ok(trace.legs.C.simMs.n === 0, 'leg C (no records) reports n=0, not an exception');

  // default leg discovery (no opts.legs): distinct leg tags, first-seen order.
  const auto = buildFrameTrace(records, { fields: ['simMs'] });
  ok(Object.keys(auto.legs).join(',') === 'A,B', `auto-discovered legs in first-seen order, got ${Object.keys(auto.legs)}`);
}

// worst-frame list: sorted descending by worstField, capped at worstN.
{
  const records = [1, 5, 2, 9, 3, 7].map((intervalMs, frame) => ({ leg: 'X', frame, intervalMs }));
  const trace = buildFrameTrace(records, { legs: ['X'], fields: ['intervalMs'], worstN: 3 });
  ok(trace.worst.length === 3, `worst list capped at worstN=3, got ${trace.worst.length}`);
  ok(trace.worst.map((r) => r.intervalMs).join(',') === '9,7,5', `worst list sorted descending, got ${trace.worst.map((r) => r.intervalMs)}`);
  const empty = buildFrameTrace([], { legs: [], fields: ['intervalMs'] });
  ok(empty.worst.length === 0 && empty.frames === 0, 'no records -> empty worst list, frames=0');
}

// toCSV(): fixed header + one row per record, in field order, missing fields -> empty cell.
{
  const records = [
    { leg: 'A', frame: 0, simMs: 1.5, jsMs: 2.5 },
    { leg: 'A', frame: 1, simMs: 3, jsMs: 4 },
  ];
  const csv = toCSV(records, ['leg', 'frame', 'simMs', 'jsMs']);
  const expected = 'leg,frame,simMs,jsMs\nA,0,1.5,2.5\nA,1,3,4';
  ok(csv === expected, `CSV format exact, got:\n${csv}`);
  const sparse = toCSV([{ leg: 'A', frame: 0 }], ['leg', 'frame', 'simMs']);
  ok(sparse === 'leg,frame,simMs\nA,0,', `missing field renders as empty cell, got:\n${sparse}`);
}

console.log(`frameTrace: ${checks} checks. ALL PASS`);
