// tools/editor/folders.test.mjs - ED-FOLDERS-01 (docs/backlog.md). Plain Node
// ESM, no DOM: exercises the pure folder helpers in panel.js - `deriveFolderKey`
// (default-folder derivation), the user-folder state transitions (create/rename/
// delete/move), and the byte-stable serializer/parser for
// content/editor/asset-folders.json.
import {
  FALLBACK_FOLDER, DEFAULT_FOLDER_NAMES, deriveFolderKey,
  createAssetFoldersState, isValidFolderName, parseAssetFolders, serializeAssetFolders,
  listUserFolders, createUserFolder, renameUserFolder, deleteUserFolder,
  moveAssetToFolder, assetFolderFor, groupAssetFolders,
} from './panel.js';
import { makeOk } from '../../engine/test/assert.js';

let pass = 0;
let fail = 0;
const failures = [];

const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- deriveFolderKey: each model key -> its default folder -----------------
// A representative key per pack (the full table lives in panel.js PACK_BY_KEY;
// these spot-check every folder plus the sidecar/prefix/fallback paths).
{
  const cases = [
    // Tower props (the game's own authored content)
    ['lantern', 'Tower props'], ['lever', 'Tower props'], ['brazier', 'Tower props'],
    ['relay', 'Tower props'], ['sword', 'Tower props'], ['waystone', 'Tower props'],
    ['farTower', 'Tower props'], ['ferrumLights', 'Tower props'], ['boarPlaceholder', 'Tower props'],
    ['practiceTarget', 'Tower props'], ['lampFlame', 'Tower props'], ['torchFlame', 'Tower props'],
    ['pallet', 'Tower props'],
    // Ruins (rubble + the Kestrel's wreckage)
    ['rubble', 'Ruins'], ['gondola', 'Ruins'], ['burner', 'Ruins'], ['rope', 'Ruins'],
    ['envelopeDrape', 'Ruins'], ['canvasHeap', 'Ruins'], ['burnerFlame', 'Ruins'],
    // StickyBizcuit (sb prefix + the non-prefixed objects)
    ['sbTree', 'StickyBizcuit'], ['sbStnWall', 'StickyBizcuit'], ['sbVillCornerL', 'StickyBizcuit'],
    ['barrel', 'StickyBizcuit'], ['gravestone2Weathered', 'StickyBizcuit'], ['treeBig', 'StickyBizcuit'],
    ['torchLongBlue', 'StickyBizcuit'], ['fireBlue', 'StickyBizcuit'],
    // Voxel pack (CC0)
    ['pig', 'Voxel pack'], ['bunny', 'Voxel pack'], ['campfire', 'Voxel pack'],
    ['grassPatch', 'Voxel pack'], ['toolPlate', 'Voxel pack'], ['tree', 'Voxel pack'], ['stump', 'Voxel pack'],
    // Notes
    ['note', 'Notes'], ['notePinned', 'Notes'],
    // Spell/FX
    ['spellHandL', 'Spell/FX'], ['fireballCore', 'Spell/FX'], ['pickupHp', 'Spell/FX'], ['strawPuff', 'Spell/FX'],
  ];
  let all = true;
  const bad = [];
  for (const [key, want] of cases) {
    const got = deriveFolderKey(key);
    if (got !== want) { all = false; bad.push(`${key} -> ${got} (want ${want})`); }
  }
  ok('deriveFolderKey: every spot-checked key lands in its default folder', all, bad.join('; '));
}

// ---- deriveFolderKey: prefix rules (no sidecar/table needed) ---------------
ok("deriveFolderKey: a bare `forest` prefix maps to Forest trees (even without the def)",
  deriveFolderKey('forestSomethingNew') === 'Forest trees');
ok("deriveFolderKey: a bare `sb` prefix maps to StickyBizcuit",
  deriveFolderKey('sbBrandNew') === 'StickyBizcuit');
ok('deriveFolderKey: the forest keys land in Forest trees without a def',
  deriveFolderKey('forestOakSmall') === 'Forest trees'
  && deriveFolderKey('forestBirchLarge') === 'Forest trees'
  && deriveFolderKey('forestPineSmall') === 'Forest trees');

// ---- deriveFolderKey: registry sidecar fields (forest/groundDetail) --------
// The two packs that tag their models with an explicit sidecar object:
// forest_trees.js (`def.forest`) and ground_detail.js (`def.groundDetail`).
// These keys carry no `forest`/`sb` prefix, so ONLY the sidecar can place them.
{
  const rock = { groundDetail: { group: 'rock' } };
  const forestTree = { forest: { species: 'oak' } };
  ok('deriveFolderKey: `def.groundDetail` sidecar -> Ground detail (no key prefix)',
    deriveFolderKey('rockMedA', rock) === 'Ground detail'
    && deriveFolderKey('tuftLush', rock) === 'Ground detail'
    && deriveFolderKey('logShort', rock) === 'Ground detail');
  ok('deriveFolderKey: `def.forest` sidecar -> Forest trees',
    deriveFolderKey('forestOakSmall', forestTree) === 'Forest trees');
  // Sidecar wins over any prefix ambiguity: `bush` is a vp_pack key, but a
  // ground-detail `bushRound` has the sidecar; `stump` (vp) vs `stumpCut`
  // (ground detail) resolve the same way.
  ok('deriveFolderKey: sidecar disambiguates `bush` (Voxel pack) from `bushRound` (Ground detail)',
    deriveFolderKey('bush') === 'Voxel pack'
    && deriveFolderKey('bushRound', { groundDetail: {} }) === 'Ground detail');
  ok('deriveFolderKey: sidecar disambiguates `stump` (Voxel pack) from `stumpCut` (Ground detail)',
    deriveFolderKey('stump') === 'Voxel pack'
    && deriveFolderKey('stumpCut', { groundDetail: {} }) === 'Ground detail');
}

// ---- deriveFolderKey: unknown key -> fallback ------------------------------
ok('deriveFolderKey: an unknown key falls back', deriveFolderKey('definitelyNotAModel') === FALLBACK_FOLDER);
ok('deriveFolderKey: a ui-only sprite is not a default folder (falls to Other)',
  deriveFolderKey('title') === FALLBACK_FOLDER);

// ---- deriveFolderKey: #N variant suffix folds to the parent's folder ------
// The AssetRegistry packs billboard variants as `${key}#${n}` (engine/core/
// assets.js): rubble#0..#2, rope#0..#1. They must land with their parent.
ok("deriveFolderKey: a `#N` variant suffix is stripped (rubble#1 -> Ruins)",
  deriveFolderKey('rubble#1') === 'Ruins' && deriveFolderKey('rubble#0') === 'Ruins');
ok("deriveFolderKey: a `#N` variant suffix is stripped (rope#0 -> Ruins)",
  deriveFolderKey('rope#0') === 'Ruins' && deriveFolderKey('rope#1') === 'Ruins');
ok('deriveFolderKey: non-variant keys are untouched by the #N strip',
  deriveFolderKey('lantern') === 'Tower props');

// ---- isValidFolderName ------------------------------------------------------
ok('isValidFolderName: a plain name is valid', isValidFolderName('My Stuff'));
ok('isValidFolderName: trims before validating', isValidFolderName('  x  ') && isValidFolderName('x'));
ok('isValidFolderName: rejects empty/whitespace', !isValidFolderName('') && !isValidFolderName('   ') && !isValidFolderName(null));
ok('isValidFolderName: rejects a name that shadows a default folder',
  !isValidFolderName('Ruins') && !isValidFolderName('Tower props') && !isValidFolderName(FALLBACK_FOLDER));

// ---- create / rename / delete / move round trip ----------------------------
{
  let s = createAssetFoldersState();
  ok('createAssetFoldersState: empty (no user folders)', listUserFolders(s).length === 0 && s.schema === 1);

  s = createUserFolder(s, 'Props');
  ok('createUserFolder: adds an empty folder', listUserFolders(s).join(',') === 'Props' && s.userFolders.Props.length === 0);

  const before = s;
  s = createUserFolder(s, 'Props');
  ok('createUserFolder: a duplicate is a no-op (same state reference)', s === before);
  s = createUserFolder(s, 'Ruins');
  ok('createUserFolder: a default-folder name is refused', listUserFolders(s).join(',') === 'Props');

  s = createUserFolder(s, 'Nature');
  s = moveAssetToFolder(s, 'lantern', 'Props');
  ok('moveAssetToFolder: moves an asset into a user folder', assetFolderFor(s, 'lantern') === 'Props');

  // An asset in one user folder at a time: moving it into another folder
  // removes it from the first.
  s = moveAssetToFolder(s, 'lantern', 'Nature');
  ok('moveAssetToFolder: one user folder at a time (removed from the previous)',
    assetFolderFor(s, 'lantern') === 'Nature' && !s.userFolders.Props.includes('lantern'));

  // Moving out (back to default) - a default folder name, null, or '' all work.
  s = moveAssetToFolder(s, 'lantern', null);
  ok('moveAssetToFolder: null moves the asset back to its default folder',
    assetFolderFor(s, 'lantern') === 'Tower props' && !s.userFolders.Nature.includes('lantern'));

  s = moveAssetToFolder(s, 'lantern', 'Nature');
  s = moveAssetToFolder(s, 'lantern', 'Tower props'); // a default folder name = "back to default"
  ok('moveAssetToFolder: a default-folder name also moves the asset back out',
    assetFolderFor(s, 'lantern') === 'Tower props');

  // moveAssetToFolder never loses a folder when it empties.
  s = moveAssetToFolder(s, 'lantern', 'Nature');
  ok('moveAssetToFolder: emptying a folder keeps the folder (empty user folders survive)',
    listUserFolders(s).includes('Props') && s.userFolders.Props.length === 0);

  // Rename updates membership: the members follow the new name.
  s = moveAssetToFolder(s, 'lantern', 'Nature');
  s = renameUserFolder(s, 'Nature', 'Outdoor');
  ok('renameUserFolder: members follow the new name',
    listUserFolders(s).join(',') === 'Outdoor,Props' && s.userFolders.Outdoor.includes('lantern') && !('Nature' in s.userFolders));

  const unchanged = s;
  s = renameUserFolder(s, 'Outdoor', 'Outdoor');
  ok('renameUserFolder: same name is a no-op', s === unchanged);
  s = renameUserFolder(s, 'Missing', 'X');
  ok('renameUserFolder: unknown old name is a no-op', s === unchanged);

  // Delete returns members to their default folder.
  s = deleteUserFolder(s, 'Outdoor');
  ok('deleteUserFolder: removes the folder', !listUserFolders(s).includes('Outdoor'));
  ok('deleteUserFolder: members return to their default folder', assetFolderFor(s, 'lantern') === 'Tower props');

  s = createUserFolder(s, 'Zed');
  s = createUserFolder(s, 'Alpha');
  ok('listUserFolders: sorted', listUserFolders(s).join(',') === 'Alpha,Props,Zed');
}

// ---- groupAssetFolders ------------------------------------------------------
{
  const state = parseAssetFolders(serializeAssetFolders(moveAssetToFolder(createAssetFoldersState(), 'lantern', 'My Props')));
  const defs = {
    lantern: {}, lever: {}, forestOakSmall: { forest: {} }, rockMedA: { groundDetail: {} }, pig: {},
  };
  const groups = groupAssetFolders(['lantern', 'lever', 'forestOakSmall', 'rockMedA', 'pig'], state, (k) => defs[k]);
  ok('groupAssetFolders: user folders first', groups[0].folder === 'My Props');
  ok('groupAssetFolders: every key appears exactly once',
    groups.reduce((n, g) => n + g.keys.length, 0) === 5
    && groups.every((g) => g.keys.length > 0));
  ok('groupAssetFolders: moved asset sits in its user folder; others in defaults',
    groups.find((g) => g.folder === 'My Props').keys.join(',') === 'lantern'
    && groups.some((g) => g.folder === 'Forest trees' && g.keys.join(',') === 'forestOakSmall')
    && groups.some((g) => g.folder === 'Ground detail' && g.keys.join(',') === 'rockMedA')
    && groups.some((g) => g.folder === 'Voxel pack' && g.keys.join(',') === 'pig')
    && groups.some((g) => g.folder === 'Tower props' && g.keys.join(',') === 'lever'));
  const defaultNames = groups.slice(1).map((g) => g.folder);
  ok('groupAssetFolders: default folders sort after user folders, by name',
    JSON.stringify(defaultNames) === JSON.stringify([...defaultNames].sort()), JSON.stringify(defaultNames));
}

// ---- saved file stability ---------------------------------------------------
{
  // A canonical seed (content/editor/asset-folders.json as committed) round-
  // trips byte-identically: parse -> serialize equals the input.
  const seed = '{\n  "schema": 1,\n  "userFolders": {}\n}\n';
  ok('serialize(createAssetFoldersState()) matches the committed seed bytes',
    serializeAssetFolders(createAssetFoldersState()) === seed, JSON.stringify(serializeAssetFolders(createAssetFoldersState())));
  ok('parse(seed) -> serialize is byte-identical', serializeAssetFolders(parseAssetFolders(seed)) === seed);

  // A populated layout: sorted keys, no timestamps, byte-identical across a
  // parse -> serialize -> parse -> serialize cycle.
  const built = moveAssetToFolder(moveAssetToFolder(createAssetFoldersState(), 'lantern', 'My Props'), 'pig', 'My Props');
  const text1 = serializeAssetFolders(built);
  const text2 = serializeAssetFolders(parseAssetFolders(text1));
  ok('an unchanged populated layout re-saves byte-identically', text1 === text2, `${text1}\n---\n${text2}`);

  // Sorting is real: feeding the members in a scrambled order still yields the
  // same canonical bytes.
  const scrambled = createAssetFoldersState();
  scrambled.userFolders = { 'My Props': ['pig', 'lantern'] };
  const canonical = createAssetFoldersState();
  canonical.userFolders = { 'My Props': ['lantern', 'pig'] };
  ok('serialize: member order is normalized to sorted', serializeAssetFolders(scrambled) === serializeAssetFolders(canonical));

  // No timestamps anywhere in the written file.
  ok('serialize: no timestamps in the output', !/savedAt|Date|timestamp|"t"\s*:/.test(text1));

  // A corrupt / wrong-shape input degrades to an empty layout (never throws).
  ok('parse: a corrupt JSON degrades to an empty layout',
    listUserFolders(parseAssetFolders('{not json')).length === 0
    && listUserFolders(parseAssetFolders('')).length === 0
    && listUserFolders(parseAssetFolders(undefined)).length === 0);
  ok('parse: a wrong-shape userFolders degrades to an empty layout',
    listUserFolders(parseAssetFolders('{"userFolders": [1,2]}')).length === 0);

  // An asset present in two folders on disk is kept only once (first sorted folder).
  const dup = '{\n  "schema": 1,\n  "userFolders": { "B": ["x"], "A": ["x"] }\n}\n';
  const dedup = parseAssetFolders(dup);
  ok('parse: a key in two folders is kept only in the first (sorted) folder',
    dedup.userFolders.A.includes('x') && !dedup.userFolders.B.includes('x'), JSON.stringify(dedup));

  // DEFAULT_FOLDER_NAMES covers the fallback + every named default folder.
  ok('DEFAULT_FOLDER_NAMES: contains the fallback and all named defaults',
    DEFAULT_FOLDER_NAMES.has(FALLBACK_FOLDER) && DEFAULT_FOLDER_NAMES.has('Tower props') && DEFAULT_FOLDER_NAMES.has('Ruins')
    && DEFAULT_FOLDER_NAMES.has('StickyBizcuit') && DEFAULT_FOLDER_NAMES.has('Voxel pack')
    && DEFAULT_FOLDER_NAMES.has('Forest trees') && DEFAULT_FOLDER_NAMES.has('Ground detail')
    && DEFAULT_FOLDER_NAMES.has('Notes') && DEFAULT_FOLDER_NAMES.has('Spell/FX'));
}

console.log(`folders.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
