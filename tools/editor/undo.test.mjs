// tools/editor/undo.test.mjs - US-032 S4 (docs/architecture.md 24.13).
// Plain Node ESM, no framework. Run with `node tools/editor/undo.test.mjs`.
import { createStack } from './undo.js';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  }
}

// ---- basic push/undo/redo --------------------------------------------------
{
  const s = createStack(50);
  ok('fresh stack: canUndo/canRedo both false', !s.canUndo && !s.canRedo);
  s.push({ id: 'a' });
  ok('after push: canUndo true, canRedo false', s.canUndo && !s.canRedo);
  const undone = s.undo();
  ok('undo returns the pushed record', undone.id === 'a');
  ok('after undo: canUndo false, canRedo true', !s.canUndo && s.canRedo);
  const redone = s.redo();
  ok('redo returns the same record', redone.id === 'a');
  ok('after redo: canUndo true, canRedo false', s.canUndo && !s.canRedo);
  ok('undo on an empty stack returns null', createStack().undo() === null);
  ok('redo on an empty stack returns null', createStack().redo() === null);
}

// ---- push after undo clears the redo tail ----------------------------------
{
  const s = createStack(50);
  s.push({ id: 'a' });
  s.push({ id: 'b' });
  s.undo(); // undo b -> redo has [b]
  ok('redo available after one undo', s.canRedo);
  s.push({ id: 'c' });
  ok('push after undo clears the redo tail', !s.canRedo);
  const undone = s.undo();
  ok('the stack now undoes to "c" (not "b")', undone.id === 'c');
}

// ---- cap 50 drops the oldest ------------------------------------------------
{
  const s = createStack(50);
  for (let i = 0; i < 55; i++) s.push({ id: `r${i}` });
  ok('size caps at 50', s.size === 50);
  // Undo all 50 remaining; the oldest kept should be r5 (r0..r4 dropped).
  let last = null;
  for (let i = 0; i < 50; i++) last = s.undo();
  ok('the oldest surviving record is r5 (r0-r4 fell off)', last.id === 'r5', JSON.stringify(last));
  ok('stack now empty', !s.canUndo);
}

// ---- clear ------------------------------------------------------------------
{
  const s = createStack(50);
  s.push({ id: 'a' });
  s.undo();
  s.clear();
  ok('clear() empties both undo and redo', !s.canUndo && !s.canRedo);
}

console.log(`undo.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
