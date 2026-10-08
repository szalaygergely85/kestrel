# Mesh binary format (MESH-BIN-01, architecture.md 37.19)

`content/meshes/<id>.mesh.json` is now a small **meta** file; the vertex streams live in `<id>.mesh.bin`.
Decode is lossless: the loaded `MeshData` is byte-identical to the old all-JSON path (`meshFromJSON`), checked for every mesh by `engine/mesh/meshBin.test.js`.
(The architecture note proposed quantised int16/oct16; lossless dedupe was chosen instead because the AC demands byte-identical MeshData and it already reaches ~15x.)

## Meta (`*.mesh.json`, canonical `stringifyContent` form)
`kind, schema, id, nextId, version, layout, bin, triCount, bbox, ranges, matKeys, mats, matsResolved, meshVersion, castShadow?, collide?, colliderB64?, colliderParts?`. `colliderB64` (MESH-LOAD-01) = the collision proxy (9 f32 per tri, little endian) as base64, ~1.4 KB for 28 tris; the bin then has no section 8 (`encodeMeshBin(mesh, {collider:false})`; an old bin with section 8 still loads, the meta wins).
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

## Lazy loading (MESH-LOAD-01, engine/mesh/lazyMesh.js)
`loadContentPack(url, { lazyMeshes: true })` (or `?lazymesh=1` in the page url; off by default, `?lazymesh=0` forces off) fetches every meta but only the bins of meshes that need render triangles for collision (no `colliderB64` and not `collide:false`: Fences/Line, GroundMossXS today). Every other mesh is a **shell**: the normal MeshData object (same identity all session) with empty streams and `mesh.lazy`. Colliders therefore stay eager (proxy in the meta). Feeds skip a shell (`addMeshStructures`, `MeshGroupSet`, scatter groups in `instances.js`, `shadowList.js`) and request it when its bbox is within fogFarM + 20 m of the eye (scatter groups: any instance within that radius). `LazyMeshStore`: Promise de-dup, max 4 fetches in flight, decode in `pump()` (called by the camera `addMeshStructures`): at most 2 decodes or 4 ms per frame (the first decode of a frame always runs). `AssetRegistry.loadMesh(id)` / `ensureMesh(mesh)` = editor/tool path (no frame budget). `window.__lazyMeshStore.stats` = counters. Trace: `node tools/lazymesh-trace.mjs --port 96xx [--lazy 0|1]`.
