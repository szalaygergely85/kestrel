// engine/content/migrate.js (US-027a, docs/architecture.md section 21.5).
import { ContentError } from './ContentError.js';
import { LATEST_SCHEMA } from './schema.js';

/**
 * Pure per-kind schema migrations. Entry `i` takes an object at schema
 * `i+1` and returns one at schema `i+2`. Empty today (schema 1 is the only
 * version) - populated as the format grows. The engine table holds no test
 * kinds; a test's synthetic kind is passed through `opts.migrations`.
 */
export const MIGRATIONS = { level: [], world: [], manifest: [] };

/**
 * @param {string} kind
 * @param {Object} obj     parsed file content, including its envelope
 * @param {string} file    file path/URL, for error messages
 * @param {{migrations?: Object, latest?: Object}} [opts]
 * @returns {Object} an object at `latest[kind]`, never the same reference
 *   as `obj` unless `obj.schema === latest[kind]` already
 */
export function migrateContent(kind, obj, file, opts = {}) {
  const migrations = opts.migrations || MIGRATIONS;
  const latest = opts.latest || LATEST_SCHEMA;
  const target = latest[kind];
  if (typeof target !== 'number') {
    throw new ContentError(file, 'kind', `unknown kind "${kind}"`);
  }
  const schema = obj.schema;
  if (schema > target) {
    throw new ContentError(file, 'schema', `schema ${schema} is newer than this engine (max ${target})`);
  }
  if (schema === target) return obj;

  const chain = migrations[kind] || [];
  let cur = structuredClone(obj);
  for (let v = schema; v < target; v++) {
    const step = chain[v - 1];
    if (typeof step !== 'function') {
      throw new ContentError(file, 'schema', `no migration from schema ${v} to ${v + 1} for kind "${kind}"`);
    }
    cur = step(cur);
  }
  cur.schema = target;
  return cur;
}
