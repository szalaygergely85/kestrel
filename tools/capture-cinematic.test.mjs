import assert from 'node:assert/strict';
import { parseArgs, hashCells, ffmpegArgs, captureCinematic } from './capture-cinematic.mjs';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './capture-browser.mjs';
const args = parseArgs(['--cinematic', 'tower', '--port', '9650', '--frames', '3', '--no-encode']);
assert.deepEqual(args.ids, ['tower']); assert.equal(args.maxFrames, 3); assert.equal(args.encode, false);
assert.deepEqual(parseArgs(['--compare', 'tower,pond', '--port', '9650']).ids, ['tower', 'pond']);
for (const a of [[], ['--port', '8000', '--cinematic', 'tower'], ['--port', '9999', '--cinematic', 'tower'], ['--port', '9650', '--cinematic', '../tower'], ['--port', '9650', '--compare', 'a'], ['--port', '9650', '--cinematic', 'tower', '--frames', '0'], ['--port', '9650', '--cinematic', 'tower', '--wat', 'x'], ['--port']]) assert.throws(() => parseArgs(a));
const frame = { fg: [1, 2, 3, 4], bg: [5, 6, 7, 255] };
assert.equal(hashCells(frame), hashCells({ fg: Uint8Array.from(frame.fg), bg: Uint8Array.from(frame.bg) }));
assert.notEqual(hashCells(frame), hashCells({ ...frame, fg: [1, 2, 3, 5] }));
assert.notEqual(hashCells(frame), hashCells({ ...frame, bg: [5, 6, 8, 255] }));
assert.match(ffmpegArgs(['a', 'b'], 30, 'mp4', 'out.mp4').join(' '), /hstack=inputs=2:shortest=1/);
assert.match(ffmpegArgs(['a'], 30, 'gif', 'out.gif').join(' '), /palettegen/);
assert.ok(ffmpegArgs(['a'], 30, 'mp4', 'out.mp4').includes('yuv420p'));
console.log('capture-cinematic: 18 assertions PASS');

// Opt-in real-GPU regression: CINE_BROWSER_PORT=9650 node tools/capture-cinematic.test.mjs.
// Normal suite discovery stays Node-only. Generated camera keys are test data, not showcase assets.
if (process.env.CINE_BROWSER_PORT) {
  const port = Number(process.env.CINE_BROWSER_PORT), id = `cine-test-${process.pid}-${Date.now()}`;
  const fixture = path.join(ROOT, 'design/cinematics', `${id}.json`);
  mkdirSync(path.dirname(fixture), { recursive: true });
  writeFileSync(fixture, JSON.stringify({ version: 1, id, fps: 30, keys: [
    { t: 0, x: 1498, y: 1028, z: 2.5, yawDeg: 0, pitchDeg: 0, ease: 'linear' },
    { t: 1, x: 1499, y: 1028, z: 2.5, yawDeg: 10, pitchDeg: 5, ease: 'smooth' },
  ] }));
  try {
    const opts = { ids: [id], grid: '160x60', maxFrames: 3, encode: false };
    const outDir = path.join(ROOT, 'captures', id);
    const a = await captureCinematic({ ...opts, port, outDir: path.join(outDir, 'a') });
    const b = await captureCinematic({ ...opts, port: port + 2, outDir: path.join(outDir, 'b') });
    assert.deepEqual(a[0].hashes, b[0].hashes);
    assert.deepEqual(a[0].pngHashes, b[0].pngHashes);
    assert.notEqual(a[0].hashes[0], a[0].hashes[2]);
    console.log('cinematic determinism: 3 cell + PNG hashes match across two fresh browsers PASS');
  } finally { unlinkSync(fixture); }
}
