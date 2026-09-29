// engine/mesh/voxelMeshShared.js - ME-08a (27.16 item 5). The ONE
// module-level VoxelMeshCache shared by the GPU raster pass and the JS twin
// (same pattern as `terrainMeshSetFor`). 27.16 puts `sharedVoxelMeshCache` in
// voxelMesh.js; that file is frozen while ME-07's ARCH CHANGES are open, so
// it lives here and can move there later without changing importers' names.
//
// Also stamps a UNIQUE `meshVersion` on every freshly built mesh (ME-07
// review item 2 workaround): `MeshBuffers.get` keys by id + version, and a
// rebuilt model (new `pm`) reuses the id `vox:<modelKey>` with version 1.
import { VoxelMeshCache } from './voxelMesh.js';

class SharedVoxelMeshCache extends VoxelMeshCache {
  constructor() {
    super();
    this._stamped = new WeakSet();
    this._nextVersion = 1;
  }

  get(pm, modelKey, partNames) {
    const mesh = super.get(pm, modelKey, partNames);
    if (!this._stamped.has(mesh)) {
      this._stamped.add(mesh);
      mesh.meshVersion = ++this._nextVersion;
    }
    return mesh;
  }
}

export const sharedVoxelMeshCache = new SharedVoxelMeshCache();
