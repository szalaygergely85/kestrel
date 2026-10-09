// game/js/bootStageTimer.js - S8-B1-20 (docs/sprints/sprint-8-queue.md:158-165): boot stage timing for the loading
// card + F3. Builds on engine/core/bootMarks.js (mark/span already stamp performance.now()) and the S8-B1-09b
// loading card (bootCard.js) / bootProgress.js (0..1 bar), but tracks wall-clock ms PER NAMED STAGE so the card and
// the F3 boot line can show "content 320 ms, adapter 180 ms, ..." instead of only a percentage.
// Pure (the clock is injected) so it is Node-testable with a fake clock - no DOM, no performance global required.
//
// Stage set per the story's AC ("adapter, pipelines, content, meshes, world"); ORDER below is main.js's actual
// chronological boot sequence (content pack -> renderer/adapter -> shader pipelines -> world build -> lazy mesh
// prefetch), which is what "stages advance in order" is checked against - the AC's prose list is the card's label
// set, not a mandated entry order.
export const BOOT_STAGES = Object.freeze([
  { id: 'content', label: 'content' },
  { id: 'adapter', label: 'adapter' },
  { id: 'pipelines', label: 'pipelines' },
  { id: 'world', label: 'world' },
  { id: 'meshes', label: 'meshes' },
]);

const ORDER = BOOT_STAGES.map((s) => s.id);

/**
 * @param {() => number} clock - ms timestamp source (bootNow in prod, a fake counter in tests). The timer starts in
 *   the first stage ('content') the moment it is created - main.js has no "boot start" mark to call separately.
 */
export function createBootStageTimer(clock) {
  const durations = {}; // id -> ms, filled in as each stage finishes (enter() of the next one, or finish())
  let idx = 0; // current stage index into ORDER; starts at the first stage
  let stageStart = clock();
  let total = 0;
  let done = false;

  function close(now) {
    const ms = now - stageStart;
    durations[ORDER[idx]] = ms;
    total += ms;
  }

  /** Enter stage `id`. Unknown ids and non-forward moves (same/earlier stage, or after finish()) are ignored - the
   * timer already starts in stage 0 ('content') at creation, so a redundant call is simply a no-op, not an error. */
  function enter(id) {
    if (done) return;
    const next = ORDER.indexOf(id);
    if (next < 0 || next <= idx) return;
    const now = clock();
    close(now);
    idx = next;
    stageStart = now;
  }

  /** Call once, at the first rendered frame: closes out the last stage and freezes the timer. */
  function finish() {
    if (done) return;
    close(clock());
    done = true;
  }

  /** 0..1, monotonic: fraction of stages that have been closed out (never decreases). */
  function progress() {
    const closedCount = ORDER.filter((id) => durations[id] !== undefined).length;
    return Math.max(0, Math.min(1, closedCount / ORDER.length));
  }

  /** One line per stage that has finished, in display order, e.g. "content 320 ms". Unfinished stages are omitted. */
  function cardText() {
    return BOOT_STAGES
      .filter((s) => durations[s.id] !== undefined)
      .map((s) => `${s.label} ${durations[s.id].toFixed(0)} ms`)
      .join('\n');
  }

  return { enter, finish, progress, cardText, durations, total: () => total, isDone: () => done };
}
