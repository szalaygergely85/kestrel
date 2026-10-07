# Demo bundle builder

Install the project's existing development dependency (`npm install`) for the TypeScript syntax parser. The game still runs without it; this is a packaging tool, not a runtime dependency.

Run `node tools/demo/build-demo.mjs --check` to verify the tracked runtime dependency closure and licence gate without writing files. Run without `--check` to write `dist/demo/` and `dist/demo.zip` after a successful plan. An existing output directory is refused; use a clean build checkout. It never deletes source files or publishes the archive.

The root launcher selects WebGPU and redirects into `game/index.html`, preserving other query parameters and hash. This is the itch.io ZIP entry point. B1 must finish the WebGPU runtime/release hooks before an actual demo is released.

The graph follows HTML/CSS paths, parsed JS imports/literal dynamic imports, literal boot fetch/new-URL paths and content manifests. Computed imports fail for an explicit release dependency list rather than silently disappearing. Loader-computed content paths must be listed in their manifest. Git-ignored local overlays and raw sources are excluded; missing required dependencies fail. No dev HTML pages or tests are packaged. Reachable dev JS helpers remain when the shipped boot module imports them.

Licence groups come from `docs/licence-inventory.json`. Authored project groups and identified Quaternius/Kenney CC0 inputs are allowed; unverified groups and uninventoried model/mesh/voxel assets refuse the whole plan before output mutation. Both third-party notices and the licence evidence doc accompany the bundle. D-046 keeps source packs in the repo; this tool does not alter that decision.

Current repository preflight refuses the unverified StickyBizcuit/Voxel Pack boot dependencies and the required ignored local-script reference. PC-A/owner must establish applicable grants or provide a release content/entry profile using verified inputs. The builder does not rewrite content references, replace artwork or assume permission.

ZIP entries use store mode with fixed timestamps; `demo-manifest.json` lists source hashes. Fixture tests validate dependency/license/path failures, check-mode immutability, actual copied output/root launcher, overwrite refusal, deterministic archive bytes and extraction/CRC through Python's independent ZIP reader.
