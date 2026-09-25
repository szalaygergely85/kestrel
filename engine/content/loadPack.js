// engine/content/loadPack.js (US-027a, docs/architecture.md section 21.4).
// The engine hard-codes no `content/` path - the caller (game/tests) names
// the manifest URL and injects the file reader.
import { ContentError } from './ContentError.js';
import { migrateContent, MIGRATIONS } from './migrate.js';
import { LATEST_SCHEMA, ID_COLLECTIONS, REF_FIELDS } from './schema.js';

const FILE_ID_RE = /^[a-z][a-z0-9_]*$/;
const LOCAL_ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const KNOWN_KINDS = ['level', 'world'];

/** `globalId('tower', 'lamp_hook') -> 'tower/lamp_hook'` (21.3). Only used
 * where a field already says which collection it points into. */
export function globalId(fileId, localId) {
  return `${fileId}/${localId}`;
}

async function defaultFetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new ContentError(url, 'fetch', `HTTP ${r.status}`);
  return r.text();
}

function asContentError(err, file, field) {
  return err instanceof ContentError ? err : new ContentError(file, field, err && err.message ? err.message : String(err));
}

function checkRefField(obj, ref, href, errors, idSets) {
  const sepIdx = ref.field.indexOf('[].');
  const arrayKey = ref.field.slice(0, sepIdx);
  const subpath = ref.field.slice(sepIdx + 3).split('.');
  const items = obj[arrayKey];
  if (!Array.isArray(items)) return;
  const idSet = idSets[ref.collection] || new Set();
  items.forEach((item, i) => {
    if (!item) return;
    let val = item;
    for (const p of subpath) val = val == null ? undefined : val[p];
    if (val === undefined || val === null) return; // optional reference
    if (!idSet.has(val)) {
      errors.push(new ContentError(href, `${arrayKey}[${i}].${subpath.join('.')}`, `references unknown ${ref.collection} id "${val}"`));
    }
  });
}

/**
 * @param {string} manifestUrl
 * @param {{fetchText?: (url:string)=>Promise<string>, migrations?: Object, latest?: Object}} [opts]
 * @returns {Promise<Object>} ContentBundle (see architecture.md 21.4)
 */
export async function loadContentPack(manifestUrl, opts = {}) {
  const fetchText = opts.fetchText || defaultFetchText;
  const migrations = opts.migrations || MIGRATIONS;
  const latest = opts.latest || LATEST_SCHEMA;

  const manifestHref = new URL(manifestUrl, globalThis.location?.href).href;

  let manifestText;
  try {
    manifestText = await fetchText(manifestHref);
  } catch (e) {
    throw asContentError(e, manifestHref, 'fetch');
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (e) {
    throw new ContentError(manifestHref, 'json', e.message);
  }
  if (!manifest || manifest.kind !== 'manifest') {
    throw new ContentError(manifestHref, 'kind', `unknown kind "${manifest && manifest.kind}"`);
  }
  if (typeof manifest.schema !== 'number' || !Number.isInteger(manifest.schema)) {
    throw new ContentError(manifestHref, 'schema', `schema must be an integer, got ${JSON.stringify(manifest.schema)}`);
  }
  try {
    manifest = migrateContent('manifest', manifest, manifestHref, { migrations, latest });
  } catch (e) {
    throw asContentError(e, manifestHref, 'schema');
  }

  const fileRel = manifest.files || [];
  const fileHrefs = fileRel.map((f) => new URL(f, manifestHref).href);

  const fetched = await Promise.all(fileHrefs.map(async (href) => {
    try {
      return { href, text: await fetchText(href) };
    } catch (e) {
      return { href, error: asContentError(e, href, 'fetch') };
    }
  }));

  const bundle = {
    contentVersion: manifest.contentVersion,
    packId: manifest.id,
    levels: {},
    worlds: {},
    models: {},
    meta: { level: {}, world: {}, manifest: { [manifest.id]: { url: manifestHref, schema: manifest.schema, nextId: null } } },
  };

  const errors = [];

  for (const { href, text, error } of fetched) {
    if (error) { errors.push(error); continue; }

    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      errors.push(new ContentError(href, 'json', e.message));
      continue;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      errors.push(new ContentError(href, 'kind', 'file is not a JSON object'));
      continue;
    }
    const kind = obj.kind;
    if (!KNOWN_KINDS.includes(kind)) {
      errors.push(new ContentError(href, 'kind', `unknown kind "${kind}"`));
      continue;
    }
    if (typeof obj.schema !== 'number' || !Number.isInteger(obj.schema)) {
      errors.push(new ContentError(href, 'schema', `schema must be an integer, got ${JSON.stringify(obj.schema)}`));
      continue;
    }

    let migrated;
    try {
      migrated = migrateContent(kind, obj, href, { migrations, latest });
    } catch (e) {
      errors.push(asContentError(e, href, 'schema'));
      continue;
    }

    if (typeof migrated.id !== 'string' || !FILE_ID_RE.test(migrated.id)) {
      errors.push(new ContentError(href, 'id', `bad or missing id ${JSON.stringify(migrated.id)}`));
      continue;
    }
    if (migrated.name !== undefined && migrated.name !== migrated.id) {
      errors.push(new ContentError(href, 'name', `"${migrated.name}" does not equal id "${migrated.id}"`));
      continue;
    }
    if (bundle.meta[kind][migrated.id]) {
      errors.push(new ContentError(href, 'id', `duplicate ${kind} id "${migrated.id}" (already loaded from ${bundle.meta[kind][migrated.id].url})`));
      continue;
    }

    const collections = ID_COLLECTIONS[kind] || [];
    const idSets = {};
    let hadError = false;
    let maxMinted = 0;
    for (const coll of collections) {
      const items = migrated[coll];
      idSets[coll] = new Set();
      if (!Array.isArray(items)) continue;
      items.forEach((item, i) => {
        if (!item || typeof item.id !== 'string' || !LOCAL_ID_RE.test(item.id)) {
          errors.push(new ContentError(href, `${coll}[${i}].id`, 'item in an id collection needs a valid id'));
          hadError = true;
          return;
        }
        if (idSets[coll].has(item.id)) {
          errors.push(new ContentError(href, `${coll}[${i}].id`, `duplicate id "${item.id}" in collection "${coll}"`));
          hadError = true;
          return;
        }
        idSets[coll].add(item.id);
        const m = /_(\d+)$/.exec(item.id);
        if (m) maxMinted = Math.max(maxMinted, parseInt(m[1], 10));
      });
    }

    if (typeof migrated.nextId !== 'number' || !Number.isInteger(migrated.nextId) || migrated.nextId < 1) {
      errors.push(new ContentError(href, 'nextId', 'nextId is required and must be an integer >= 1'));
      hadError = true;
    } else if (migrated.nextId <= maxMinted) {
      errors.push(new ContentError(href, 'nextId', `nextId (${migrated.nextId}) must be greater than every minted id (found _${maxMinted})`));
      hadError = true;
    }

    for (const ref of REF_FIELDS[kind] || []) {
      checkRefField(migrated, ref, href, errors, idSets);
    }

    if (hadError) continue;

    bundle.meta[kind][migrated.id] = { url: href, schema: migrated.schema, nextId: migrated.nextId };
    const { kind: _k, schema: _s, id: _id, nextId: _n, ...rest } = migrated;
    bundle[kind + 's'][migrated.id] = rest;
  }

  if (errors.length) {
    throw new ContentError(manifestHref, 'files', `${errors.length} error(s) loading content pack`, errors);
  }

  return bundle;
}
