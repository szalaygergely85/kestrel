# GLTF-HAND-01 - glTF handedness of the static loadGltf (38.32 risk 3)

Verdict: **CORRECT** (proper rotation, not a mirror). No `ESCALATE TO PC-A` for handedness. One orientation note below.

Tool: `node tools/gltf-handedness-check.mjs` (test: `tools/gltf-handedness-check.test.mjs`). Fixture = one triangle whose 3 vertices are the glTF markers.

| marker (glTF spec) | glTF | ours (x east, y north, z up) |
|---|---|---|
| model left | +X (1,0,0) | (1, 0, 0) = +x (east) |
| up | +Y (0,1,0) | (0, 0, 1) = +z (up) |
| front | +Z (0,0,1) | (0, -1, 0) = -y (SOUTH) |

- Map is (x,y,z) -> (x,-z,y), determinant +1. (left x up) . front = +1 in both frames, so no mirroring; winding and normals stay valid (the `det3<0` flip in loadGltf is only for mirrored node transforms).
- Orientation note (not a handedness bug): a glTF model's front (+Z) lands on SOUTH (-y), and its left (+X) on east. A hero authored per spec faces south, so a Blender/glTF character needs a 180 deg yaw about z to face north. The rigged reader uses ours=(-X,-Z,Y), which puts front at -y too after its x flip; check the two agree if a static and a rigged mesh are ever mixed.
- Shipped content affected if this were changed: static `content/meshes/quaternius/*.mesh.json` = 83 of 83 (none rigged). Nothing needs to change for handedness.
- `engine/mesh/gltf.js` untouched, no re-import.
