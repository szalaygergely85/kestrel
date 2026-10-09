// ED-WG-01c (architecture.md 38.21 risk a): sequence guard for the async click pick.
// begin() before `await pickAt`, isStale(t) after it. A newer click/move (begin), a doc edit (bump) or a world
// rebuild (stamp change) between click and resolve drops the result. main.js inlines the same seq/stamp test.
export function makePickGuard(getStamp = () => 0) {
  let seq = 0, edits = 0;
  return {
    begin() { return { seq: ++seq, edits, stamp: getStamp() }; },
    bump() { edits++; },
    isStale(t) { return t.seq !== seq || t.edits !== edits || t.stamp !== getStamp(); },
  };
}
