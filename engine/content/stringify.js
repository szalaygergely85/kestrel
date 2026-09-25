// engine/content/stringify.js (US-027a, docs/architecture.md section 21.6).
// Canonical, byte-stable JSON writer - the converter (US-027b) and a future
// editor both use this so re-saving unchanged content produces unchanged
// bytes. See 21.6 for the full layout spec; summarised in the comments
// below at each rule's point of use.
import { ContentError } from './ContentError.js';
import { KEY_ORDER, ORDERED_MAPS } from './schema.js';

function fileTagFor(obj) {
  return `${obj && obj.kind || 'content'}${obj && obj.id ? ':' + obj.id : ''}`;
}

function badValue(fileTag, path, value) {
  const reason = typeof value === 'function' ? 'function values are not allowed'
    : value === undefined ? 'undefined is not allowed'
    : Number.isNaN(value) ? 'NaN is not allowed'
    : 'Infinity is not allowed';
  throw new ContentError(fileTag, path || '(root)', reason);
}

function renderScalar(fileTag, path, value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) badValue(fileTag, path, value);
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value === 'function' || value === undefined) badValue(fileTag, path, value);
  return JSON.stringify(value);
}

/** "Nested objects: id first, then alphabetical" (21.6). */
function orderedNestedKeys(obj) {
  const keys = Object.keys(obj);
  const rest = keys.filter((k) => k !== 'id').sort();
  return keys.includes('id') ? ['id', ...rest] : rest;
}

function isStringArray(arr) {
  return arr.length > 0 && arr.every((v) => typeof v === 'string');
}

/**
 * Renders `value` for use inside a line that already has `indent` worth of
 * leading spaces. Compact for everything except an array of strings, which
 * always explodes one-element-per-line "at any depth" (21.6) regardless of
 * how deeply nested it is inside an otherwise-inline entry.
 */
function renderInline(fileTag, path, value, indent) {
  if (value === null || typeof value !== 'object') return renderScalar(fileTag, path, value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (isStringArray(value)) return renderStringArrayBlock(value, indent);
    const parts = value.map((v, i) => renderInline(fileTag, `${path}[${i}]`, v, indent));
    return `[${parts.join(', ')}]`;
  }
  const keys = orderedNestedKeys(value);
  if (keys.length === 0) return '{}';
  const parts = keys.map((k) => `"${k}": ${renderInline(fileTag, path ? `${path}.${k}` : k, value[k], indent)}`);
  return `{${parts.join(', ')}}`;
}

function renderStringArrayBlock(arr, indent) {
  const inner = arr.map((s) => `${indent}  ${JSON.stringify(s)}`).join(',\n');
  return `[\n${inner}\n${indent}]`;
}

/**
 * A value directly under the top level: "one entry per line, and each entry
 * is written inline" (21.6). `orderedKeys`, when given, keeps the object's
 * own key order (ORDERED_MAPS) instead of sorting it id-first-alphabetical.
 */
function renderTopLevelValue(fileTag, path, value, indent, keepOrder) {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (isStringArray(value)) return renderStringArrayBlock(value, indent);
    const inner = value.map((v, i) => `${indent}  ${renderInline(fileTag, `${path}[${i}]`, v, indent + '  ')}`).join(',\n');
    return `[\n${inner}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = keepOrder ? Object.keys(value) : orderedNestedKeys(value);
    if (keys.length === 0) return '{}';
    const inner = keys.map((k) => `${indent}  "${k}": ${renderInline(fileTag, path ? `${path}.${k}` : k, value[k], indent + '  ')}`).join(',\n');
    return `{\n${inner}\n${indent}}`;
  }
  return renderScalar(fileTag, path, value);
}

/**
 * @param {Object} obj - one content file's full object (envelope + data),
 *   already migrated to the latest schema.
 * @returns {string} canonical JSON text, LF line endings, trailing newline.
 */
export function stringifyContent(obj) {
  const fileTag = fileTagFor(obj);
  const kind = obj.kind;
  const orderList = KEY_ORDER[kind] || ['kind', 'schema', 'id'];
  const orderedMapKeys = new Set(ORDERED_MAPS[kind] || []);
  const known = orderList.filter((k) => k in obj);
  const rest = Object.keys(obj).filter((k) => !orderList.includes(k)).sort();
  const keys = [...known, ...rest];

  const lines = keys.map((k) => `  "${k}": ${renderTopLevelValue(fileTag, k, obj[k], '  ', orderedMapKeys.has(k))}`);
  return `{\n${lines.join(',\n')}\n}\n`;
}
