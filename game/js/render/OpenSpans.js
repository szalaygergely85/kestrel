// US-004b: typed replacement for the per-frame `openSpans` object array that
// `castScene` used to build and return (one `{x, topRow, bottomRow, depth}`
// object per unresolved column - an allocation per unresolved column per
// frame, banned by architecture.md section 9). `OpenSpans` is allocated once
// (by the caller, sized to `cols`) and reused every frame via `reset(rows)`.
//
// API per docs/architecture.md section 8:
//   top:    Int16Array(cols)   first open row, inclusive
//   bottom: Int16Array(cols)   last open row, inclusive; top > bottom = closed
//   depth:  Float32Array(cols) distance the sector pass gave up at (meters;
//                              Infinity if it never started / column fully
//                              resolved by this pass, e.g. sky/closed)
//
// A future terrain pass (US-016/US-026) is the intended consumer: it reads
// `isOpen(x)` / `top[x]` / `bottom[x]` / `depth[x]` for each column left open
// by the sector caster, draws terrain into that span, and may call
// `narrowTop`/`narrowBottom` itself as it resolves rows.
export class OpenSpans {
  constructor(cols) {
    this.cols = cols;
    this.top = new Int16Array(cols);
    this.bottom = new Int16Array(cols);
    this.depth = new Float32Array(cols);
  }

  // Re-opens every column to the full [0, rows-1] span and clears depth.
  // Called once per frame before casting, exactly like the sector caster's
  // own per-column openTop/openBottom locals used to start at 0/rows-1.
  reset(rows) {
    this.top.fill(0);
    this.bottom.fill(rows - 1);
    this.depth.fill(Infinity);
  }

  isOpen(x) {
    return this.top[x] <= this.bottom[x];
  }

  // Shrinks column x's open span from the top (row grows downward - "top"
  // means smaller row index). No-op if it wouldn't narrow the span.
  narrowTop(x, row) {
    if (row > this.top[x]) this.top[x] = row;
  }

  // Shrinks column x's open span from the bottom (larger row index).
  narrowBottom(x, row) {
    if (row < this.bottom[x]) this.bottom[x] = row;
  }

  // Marks column x fully closed (no remaining open span).
  close(x) {
    this.top[x] = 1;
    this.bottom[x] = 0;
  }

  openCount() {
    let n = 0;
    for (let x = 0; x < this.cols; x++) if (this.isOpen(x)) n++;
    return n;
  }
}
