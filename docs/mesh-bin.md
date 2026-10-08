# Mesh binary format (MESH-BIN-01, architecture.md 37.19)

`content/meshes/<id>.mesh.json` is now a small **meta** file; the vertex streams live in `<id>.mesh.bin`.
Decode is lossless: the loaded `MeshData` is byte-identical to the old all-JSON path (`meshFromJSON`), checked for every mesh by `engine/mesh/meshBin.test.js`.
(The architecture note proposed quantised int16/oct16; lossless dedupe was chosen instead because the AC demands byte-identical MeshData and it already reaches ~15x.)

## Meta (`*.mesh.json`, canonical `stringifyContent` form)
`kind, schema, id, nextId, version, layout, bin, triCount, bbox, ranges, matKeys, mats, matsResolved, meshVersion, castShadow?, collide?, colliderParts?`.
`bin` = file name relative to the meta file. No `pos/uv/uvMask/nrm/flat/aux/idx/collider` keys. A file without `bin` is the legacy all-JSON form and still loads (`--json` writes it).

## `.mesh.bin` (little endian)
Header 32 B: magic `KMSH` (u32 0x48534D4B), version u32 (=1), vertCount, triCount, sectionCount, totalBytes, 2 x reserved.
Then `sectionCount` entries of 24 B: `id, enc, offset (absolute, 16-aligned), byteLength, count (tuples after decode), extra (dict: unique count)`, then the data.

Sections: 1 pos (3 f32), 2 uv (2 f32), 3 uvMask (2 f32, optional), 4 nrm (u32), 5 flat (2 u32), 6 aux (8 f32), 7 idx (u32, terrain only), 8 collider (9 f32 per tri, optional).
Encodings (the encoder keeps the smallest valid one per stream; dedupe is on exact bits):
0 RAW (zero-copy typed-array view into the fetched buffer), 1 CONST (one tuple repeated), 2 TRI (one tuple per 3 vertices), 3 DICT16 / 4 DICT32 (table of unique tuples + u16/u32 indices), 5 UVPLANAR (uv only: one u8 per triangle picks the pos pair (x,y) / (y,z) / (x,z); used when every triangle's uv is exactly that projection).
Typical glTF import: aux = CONST, flat = TRI, uv = UVPLANAR (1 byte/tri), pos/nrm = DICT. Dict/const/tri/planar streams are expanded at load (one pass, no parse); only RAW streams are views.

## Errors
`decodeMeshBin` throws `Error('mesh.bin: ...')` for bad magic, unsupported version, truncated file, section out of bounds, unknown id/encoding, dictionary index out of range, vertex-count mismatch; `loadContentPack` wraps it in a `ContentError` naming the file.

## Tools
- `engine/mesh/meshBin.js`: `encodeMeshBin(mesh)`, `decodeMeshBin(bytes)`, `meshFromBin(meta, bytes)`, `meshBinMeta(mesh, binName)` (also exported from `engine/index.js`).
- `loadContentPack(url, { fetchText, fetchBytes })`: a `.mesh.json` containing `"bin"` has its bin fetched in the same parallel stage (`fetchBytes`, default `fetch().arrayBuffer()`); callers that pass only `fetchText` must add `fetchBytes` (done in validate-content, content-node, bake-chart).
- `tools/mesh-file.mjs`: `readMeshJSON(file)` (either form -> the full json that `meshFromJSON`/`withCollision` take), `writeMeshFiles(file, fullJson)`. Tests use `engine/test/meshFile.js` / `tools/mesh-file.mjs`.
- `tools/gltf-import.mjs` / `dae-import.mjs`: write meta + bin when `--out` (or the default path) ends in `.mesh.json` (`--json` = legacy). `tools/reimport-quaternius.mjs` and `tools/gen-mesh-colliders.mjs [--check]` handle both forms (`--check` compares the meta text and the bin bytes).
- `tools/mesh-to-bin.mjs [--dry] [paths]`: one-shot converter; verifies the decoded mesh against the JSON path before writing.

## For lazy loading (MESH-LOAD-01)
Meta is ~1-3 KB and the bin is one self-contained fetch per mesh, so a lazy loader can fetch the meta list eagerly (ranges, bbox, collider-flags) and the `.mesh.bin` on demand; `collider` is a section inside the bin (colliders stay eager = fetch those bins first, or split the collider section out later if the numbers ask for it).
