# Owner walk-test, PC-B batch 2026-10-09
(PC-B PO, owner-authorised while PC-A offline)

Server: `http://localhost:8000`. Your saved quality is Low and the backend defaults to gl2: steps marked [WEBGPU] need `&backend=webgpu`; steps marked [HIGH] need quality High (Settings, or the quality URL param you normally use) because the feature is off on Low.

1. Title menu credits: open `http://localhost:8000/game/index.html`, at the title card press `C`. Page with Up/Down/PageUp/PageDown/Home/End, `Esc` goes back. Expect: scrolling licence list, no sim running. Known gap: no visible "Credits" row yet (lane C).
2. Boot sanity (gl2 default): same URL, wait ~8 s for the title fade; walk with WASD. Expect no console errors.
3. Dust motes [HIGH]: `http://localhost:8000/game/index.html?pose=roadSouth`, set quality High. Expect about 50 slow motes drifting near you, only in sunlight. `&ambient=0` removes them. On Low there should be none (by design).
4. Sky and cloud wrap [WEBGPU]: `http://localhost:8000/game/index.html?backend=webgpu&pose=roadSouth`. Watch the clouds for 2-3 minutes. Expect continuous drift with no sudden jump or pop (CLOUD-WRAP-01); the wisp layer drifts a bit faster than before.
5. Cloud shadows [WEBGPU]: `...?backend=webgpu&pose=roadSouth&cloudshadow=1`. Expect soft darker patches sliding over terrain and water. Compare against the same URL without `cloudshadow=1`. Also try `&t=` with two different times of day.
6. Horizon AO [WEBGPU]: go to the tower interior (or any inner corner) with `...?backend=webgpu&ao=0`, then `&ao=1` at the same pose. Expect subtle darkening where floor meets wall, never brighter, nothing on open terrain.
7. Tree and grass sway [WEBGPU]: `...?backend=webgpu&pose=forestWalk`. Expect trees, tufts, ferns and bushes swaying with the wind and their shadows moving (about 10 Hz steps). Rocks stay still.
8. Chest soft-lock: no chest exists in the game yet (lane C content), so open `http://localhost:8000/game/js/chestHook.preview.html` instead. Click "Face away (E)" (nothing), "Face chest + open (E)" (chest opens, item card shows, any key dismisses). Expect you can always dismiss the card and nothing freezes.
9. Device-lost card [WEBGPU]: `...?backend=webgpu&dev=1`, then in the console run `__kestrel.loseDevice()`. Expect a "GPU reset - press R or click to reload" card within 2 s; R reloads and your position is restored (on the title menu it must not write a save).
10. Map and fog: in the real game wait for the title card to fade, press `M`. Expect the chart with arrow, waystone and relay markers; walk, press `M` again to see the trail; reload, the trail survives. `Esc` closes.
11. Editor view presets: open `http://localhost:8000/tools/editor/index.html`. Press Numpad 7 / 1 / 9 or the TOP / FRONT / ISO buttons bottom-left. Expect the camera to snap to top, front, isometric, and the corner axis gizmo to follow right-mouse look.
12. Perf feel (Low, gl2 default): walk the road and forest for a minute. Expect no new stutter versus yesterday; report any hitch (frame-alloc work only touched WebGPU).
13. Optional ortho check [WEBGPU]: not user-reachable in game yet; skip unless the editor shows an ortho/ISO view artefact (sprites too big or fog wrong).

Report back: which steps fail, with the URL and a screenshot.
