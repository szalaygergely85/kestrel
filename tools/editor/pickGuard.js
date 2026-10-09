// ED-WG-01c (architecture.md 38.21 risk a): sequence guard for the async click pick.
// begin() before `await pickAt`, isStale(t) after it. A newer click/move (begin), a doc edit (bump) or a world
// rebuild (stamp change) between click and resolve drops the result. main.js uses one guard per pick channel.
// Allocation-free: the token is just the sequence number; only the latest begin() can ever be fresh, so its
// edit count and stamp live in the guard (safe to call on every mousemove).
export function makePickGuard(getStamp = () => 0) {
  let seq = 0, edits = 0, editsAt = 0, stampAt = 0;
  return {
    begin() { editsAt = edits; stampAt = getStamp(); return ++seq; },
    bump() { edits++; },
    isStale(t) { return t !== seq || editsAt !== edits || stampAt !== getStamp(); },
  };
}
