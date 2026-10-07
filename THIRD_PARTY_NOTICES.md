# Third-party assets

Asset packs used by Kestrel / ASCII Quest. Source files live in git-ignored folders (`design/meshes/source/`, `design/vox/`);
Existing raw files include both documented CC0 packs and packs whose publisher evidence is incomplete.
The 2026-10-07 audit in `docs/licences.md` and per-file `docs/licence-inventory.json` distinguish verified terms from earlier owner confirmations.

## Ruins pack (RuinsGLB_CC0)
- Files: 56 `.glb` models (altar, coins, chests, skulls, vases, ruin pieces) - **committed** in `design/meshes/ruins/` (17 MB); the `.blend`/`.fbx` sources stay in git-ignored `design/meshes/source/RuinsGLB_CC0/`.
- Licence: **unresolved publisher terms and archive identity**. [Makovice's Ancient Ruins pack](https://makovice.itch.io/ancient-ruins-assset-pack) is a strong candidate with matching archive name/themes. Its CC0 label conflicts with restrictions on standalone redistribution and other asset packs. See `docs/licences.md` for evidence; tracked files are not verified unrestricted CC0.
- Attribution: candidate publisher makes credit optional; applicability to the tracked archive remains unconfirmed.

## StickyBizcuit voxel asset pack ("Asset Pack For Itch", itch.io)
- Files: ~106 `.vox` models (objects, stone wall and ground, village house) - **committed** (owner decision 2026-10-03) in `design/vox-sb/` with the author's readme (`README-StickyBizcuit.txt`); PNG previews not committed.
- Terms (author's readme, owner confirmed 2026-10-02 "free to use"): free to use, alter and edit; credit appreciated.
- Source: [Sticky's Voxel Asset Pack](https://stickybizcuit.itch.io/voxel-asset-pack-decorations-and-environments).
- Commercial-use scope, standalone resale, and public raw/converted asset redistribution are **not explicit** in the retained readme or retrieved publisher page. Earlier owner approval to commit is recorded above; publisher evidence remains needed. This pack is not CC0.
- **Requirement:** the game must contain a hidden easter-egg reference to the author's username **StickyBizcuit**.
- Credit: "Voxel assets by StickyBizcuit" in the credits, plus the easter egg (tracked in docs/backlog.md, OWN-REQ-013).

## "Voxel Pack" (MagicaVoxel)
- Files: 4 raw `.vox` (`Raws/`), 72 OBJ + 72 MTL + 32 palette PNG exports, and 89 split VOX + 4 split indexes (Bunny, Pig, Player, Terrain, Tools, Misc, Numbers, UI) - **committed** in `design/vox-cc0/voxel-pack/` under the earlier CC0 claim.
- Licence: **claimed CC0, publisher provenance unverified** (owner confirmed from the download page, 2026-10-02; no licence file in the zip). Original URL/author and licence evidence needed before treating commercial use or standalone/public redistribution as independently verified.

## cozy_nature_free (FBX nature pack)
- Files: 20 `.fbx` (oak / pine trees in 3 seasons, grass, tulips, mushroom, rocks) + 11 texture `.png` - **committed** in `design/meshes/cozy_nature/` (licence unverified).
- Licence: **earlier CC0 claim unverified** (owner confirmed from the download page, 2026-10-02; no licence file in the zip). The matching [VoxelNest publisher page](https://thomasgamboa.itch.io/cozy-nature-free-voxel-style-modular-enviorement-asset-pack-and-textures) offers the matching zip but does not state CC0 in the retrieved text. Commercial use, attribution, and standalone/public redistribution terms need publisher evidence.
- Format: FBX - no importer; convert to `.glb` in Blender for ME-13 (glTF), or use as designer reference for the ME-06c forest.
- Related evidence: publisher terms in the [FULL product comments](https://thomasgamboa.itch.io/cozy-nature-full-voxel-style-modular-enviorement-asset-pack-and-textures#comments) describe commercial project use and restrictions on raw redistribution. Their scope for these FREE files is unconfirmed; see `docs/licences.md`.


## Quaternius - Stylized Nature MegaKit [Standard] (CC0)
- Files: the free Standard tier's 68 glTF models + their `.bin` and textures, **committed** in `design/meshes/quaternius/glTF/` (~48 MB) so both PCs can import them; the zip's FBX/OBJ/previews stay in git-ignored `design/meshes/source/quaternius_stylized_nature/`.
- Derived `.mesh.json` content: 35 models (DeadTree_1..5, Rock_Medium_1..3, Pebble_*, RockPath_*, Mushroom_Common, Mushroom_Laetiporus, Grass_*) **committed** in `content/meshes/quaternius/` (converted via `tools/gltf-import.mjs`, same CC0 terms).
- Licence: **CC0 1.0** (public domain), see `design/meshes/quaternius/License_Standard.txt`. Author: Quaternius (quaternius.com). Credit appreciated, not required. D-041.
- Source: [Quaternius Stylized Nature MegaKit](https://quaternius.com/packs/stylizednaturemegakit.html). Commercial use and redistribution permitted by CC0 for the identified Standard inputs and derivatives.

## Kenney - Nature Kit 2.1 (CC0)
- Files: the 329 Collada `.dae` models, **committed** in `design/meshes/kenney/dae/` (~8 MB) for the TREES-LP-a importer; the rest of the zip stays in git-ignored `design/meshes/source/kenney_nature-kit/`.
- Licence: **CC0 1.0** (public domain), see `design/meshes/kenney/License.txt`. Author: Kenney (kenney.nl). D-042 item 4.
- Source: [Kenney Nature Kit](https://kenney.nl/assets/nature-kit). Commercial use and redistribution permitted by CC0.

## Fonts, reference pages and audio
- Game/editor use browser-installed font fallbacks; no font binaries are bundled. Audio is authored procedural WebAudio, with no tracked third-party sound files.
- `design/reference/stitch-editor/` is reference-only and links to Google Fonts (JetBrains Mono/Space Grotesk: SIL OFL 1.1; Material Symbols: Apache 2.0), Tailwind CDN (MIT), and images with unrecorded provenance. These are not game/editor runtime dependencies. See `docs/licences.md` for original licence links and obligations if copies are redistributed. Font licences do not grant rights to the linked images.
