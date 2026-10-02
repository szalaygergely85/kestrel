# Third-party assets

Asset packs used by Kestrel / ASCII Quest. Source files live in git-ignored folders (`design/meshes/source/`, `design/vox/`);
raw files are committed only when the licence clearly allows redistribution (CC0), and each pack's terms are recorded here.

## Ruins pack (RuinsGLB_CC0)
- Files: 56 `.glb` models (altar, coins, chests, skulls, vases, ruin pieces) - **committed** in `design/meshes/ruins/` (17 MB); the `.blend`/`.fbx` sources stay in git-ignored `design/meshes/source/RuinsGLB_CC0/`.
- Licence: **CC0** (public domain) per the download (folder name `RuinsGLB_CC0`, owner confirmed 2026-10-02 "free to use"; no licence file in the zip).
- Attribution: not required.

## StickyBizcuit voxel asset pack ("Asset Pack For Itch", itch.io)
- Files: ~106 `.vox` models (objects, stone wall and ground, village house) - raw `.vox` stay local in git-ignored `design/vox/stickybizcuit/` (readme does not cover re-publishing the raw files); only the converted game models (US-145) are committed.
- Terms (author's readme, owner confirmed 2026-10-02 "free to use"): free to use, alter and edit; credit appreciated.
- **Requirement:** the game must contain a hidden easter-egg reference to the author's username **StickyBizcuit**.
- Credit: "Voxel assets by StickyBizcuit" in the credits, plus the easter egg (tracked in docs/backlog.md, OWN-REQ-013).

## "Voxel Pack" (MagicaVoxel)
- Files: 4 raw `.vox` (`Raws/`) + 72 MagicaVoxel `.obj`/`.mtl`/palette `.png` exports (Bunny, Pig, Player, Terrain, Tools, Misc, Numbers, UI) - **committed** in `design/vox-cc0/voxel-pack/` (CC0).
- Licence: **CC0** (owner confirmed from the download page, 2026-10-02; no licence file in the zip). Attribution not required. May be committed.

## cozy_nature_free (FBX nature pack)
- Files: 20 `.fbx` (oak / pine trees in 3 seasons, grass, tulips, mushroom, rocks) + 11 texture `.png` - **committed** in `design/meshes/cozy_nature/` (CC0).
- Licence: **CC0** (owner confirmed from the download page, 2026-10-02; no licence file in the zip). Attribution not required. May be committed.
- Format: FBX - no importer; convert to `.glb` in Blender for ME-13 (glTF), or use as designer reference for the ME-06c forest.

