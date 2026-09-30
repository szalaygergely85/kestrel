// @ts-check
// engine/nav/heap.js (RE-05, docs/architecture.md 28.2). A binary min-heap
// over small integer items (cell indices, 0..capacity) with decrease-key,
// shared by astar.js (RE-05) and flowField.js (RE-08). Zero allocation after
// construction: push/pop/decreaseKey/clear never allocate - `less` is the
// only closure, created once at construction time.
//
// The heap does not compare priorities itself: the caller's `less(a, b)`
// decides order, so it can read whatever arrays it likes (f/h for A*,
// integ for the flow field) and bake in a fully deterministic tie-break
// (e.g. by cell index) so heap order never depends on insertion order.

export class IndexHeap {
  /**
   * @param {number} capacity - items are integers in [0, capacity).
   * @param {(a: number, b: number) => boolean} less - true when item `a`
   *   must sit above item `b` (a has strictly higher priority than b).
   */
  constructor(capacity, less) {
    this.capacity = capacity | 0;
    this.heap = new Int32Array(this.capacity);
    /** heapPos[item] = index in `heap`, or -1 if `item` is not in the heap. */
    this.heapPos = new Int32Array(this.capacity).fill(-1);
    this.size = 0;
    this.less = less;
  }

  get length() {
    return this.size;
  }

  has(item) {
    return this.heapPos[item] >= 0;
  }

  /** Resets to empty. O(size) (only touches slots that were actually used),
   * not O(capacity) - a query over a small region of a big grid stays cheap. */
  clear() {
    const heap = this.heap, heapPos = this.heapPos;
    for (let i = 0; i < this.size; i++) heapPos[heap[i]] = -1;
    this.size = 0;
  }

  push(item) {
    const i = this.size++;
    this.heap[i] = item;
    this.heapPos[item] = i;
    this._siftUp(i);
  }

  /** Removes and returns the top (highest-priority) item. Undefined if empty. */
  pop() {
    const heap = this.heap, heapPos = this.heapPos;
    const top = heap[0];
    heapPos[top] = -1;
    this.size--;
    if (this.size > 0) {
      const last = heap[this.size];
      heap[0] = last;
      heapPos[last] = 0;
      this._siftDown(0);
    }
    return top;
  }

  /** Call after `item`'s priority has improved (its key(s), as read by
   * `less`, got smaller). No-op if `item` is not currently in the heap. */
  decreaseKey(item) {
    const i = this.heapPos[item];
    if (i >= 0) this._siftUp(i);
  }

  _siftUp(i) {
    const heap = this.heap, heapPos = this.heapPos, less = this.less;
    const item = heap[i];
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentItem = heap[parent];
      if (!less(item, parentItem)) break;
      heap[i] = parentItem;
      heapPos[parentItem] = i;
      i = parent;
    }
    heap[i] = item;
    heapPos[item] = i;
  }

  _siftDown(i) {
    const heap = this.heap, heapPos = this.heapPos, less = this.less, size = this.size;
    const item = heap[i];
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let smallest = i;
      let smallestItem = item;
      if (l < size && less(heap[l], smallestItem)) { smallest = l; smallestItem = heap[l]; }
      if (r < size && less(heap[r], smallestItem)) { smallest = r; smallestItem = heap[r]; }
      if (smallest === i) break;
      heap[i] = smallestItem;
      heapPos[smallestItem] = i;
      i = smallest;
    }
    heap[i] = item;
    heapPos[item] = i;
  }
}
