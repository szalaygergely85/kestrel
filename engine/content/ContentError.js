// engine/content/ContentError.js (US-027a, docs/architecture.md section 21.1).
// One error type for every content problem, so callers can catch a single
// class and print `.errors[]` instead of parsing message strings.

export class ContentError extends Error {
  /**
   * @param {string} file    file path/URL the problem was found in (or
   *   '(manifest)' style pseudo-name for manifest-level problems)
   * @param {string} field   the offending field/path, e.g. 'props[2].id'
   * @param {string} reason  human-readable reason
   * @param {ContentError[]} [errors]  when this instance aggregates several
   *   problems (loadPack collects across all files), the individual ones -
   *   each already formatted the same way. Defaults to `[this]`.
   */
  constructor(file, field, reason, errors) {
    super(`content: ${file}: ${field}: ${reason}`);
    this.name = 'ContentError';
    this.file = file;
    this.field = field;
    this.reason = reason;
    this.errors = errors || [this];
  }
}
