/* design/models/voxel_bear.js - Burl, the talking brown bear (designer, v1.52 = bear v2, owner 2026-10-09:
 *                               "why is it standing? ... hand and body a bit squary", then "the bear should be on 4 legs"
 *                               and "realistic things, but from squares"; binding rules: design/style-guide.md section 0).
 *                               A friendly NPC; the dialogue system is separate (content/dialogue/bear.dialogue.json
 *                               refers to the model key `bear` and the clips talk / listen / wave / laugh).
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as design/models/voxel_beast.js:
 *   <script src="../design/models/voxel_bear.js">       (browser)
 *   import '../design/models/voxel_bear.js';            (Node tests: side-effect import)
 * Sets ASSETS.models.bear (format: design/README.md section 4/7, architecture.md 15.1) and ASSETS.bearFx (clip ->
 * state map, talk-sync data). Only ALREADY-MERGED palette materials (no palette / detail-pass edit). `meshOnly: true`.
 *
 * Axes (15.1): x = east (= the bear's RIGHT at yaw 0), y = SOUTH with y0 = the nose (the bear faces north at yaw 0),
 * z = up. cellM 0.05. Grid 28 x 34 x 22. Anchor [14, 17, 0] = the middle of the four paws (the NPC collider circle sits
 * on it). Clip `pos` values are VOXELS.
 *
 * STANCE (v2): a real brown bear ON ALL FOURS in the rest pose and in EVERY clip (style-guide 0.2). Nothing stands up
 * or sits. Talking is head, jaw and ears: the head comes up ~26 deg from its low carriage so the face turns up toward
 * the player's 1.6 m eye (eyes 0.78 m at rest -> ~0.87 m talking), the jaw syncs, the ears perk.
 *
 * Anatomy (realistic, from squares; 1.7 m nose to rump, 1.1 m at the shoulder hump):
 *   - a heavy SHOULDER HUMP (top 1.1 m) and a back that slopes down to a lower rump (1.0 m);
 *   - a barrel trunk: every y-slice is a rounded rectangle (circular corner radius R_BODY = 3), the
 *     neck and rump slices taper, the belly hangs a little lower between the legs;
 *   - the head carried LOW, in front of the hump: broad rounded skull with cheek ruffs, a dished stop, a LONG tapering
 *     muzzle (0.2 m) with a dark nose pad, small eyes set close under a brow, SMALL rounded ears far back;
 *   - big forearms: each front limb is a tapered column (wrist 5 x 5, forearm 7 x 6) with a rounded shoulder mass
 *     outside the trunk, standing on a wide rounded paw (7 x 7, two rounded layers) with 3 pale claws in front;
 *   - hind limbs: a big rounded haunch (4 tapered slices) over a thick shin, a long plantigrade foot (9 cells) with 2
 *     short claws.
 * Colour (natural variation, one soft `fabric` ramp family): legs hair_dark (#3c2b22) > trunk and skull
 *   skin_shade (#7e5444) > grizzled hump tips, face and chin skin (#b98466) > tan muzzle skin_light (#d6a07c); nose
 *   pad iron_dark, small dark eyes (EYE_MAT), claws linen_dark (pale horn), dark lip line. Mouth inside (only seen
 *   when the jaw opens): roof gore_red_dark, tongue gore_red, 2 lower teeth linen_light.
 *
 * Parts (8 = MAX_VOX_PARTS; insertion order = part index; every parent is EARLIER; each box sx+sy+sz <= 48, style 5.14):
 *   body  box [8,9,9, 20,32,22]   pivot [14, 21, 12] (mid trunk, low). Root. rx + = pitch nose down, ry + = roll top to
 *                                 the bear's right, rz + = turn right. Neck, trunk, hump, belly.
 *   head  box [8,0,10, 20,9,18]   pivot [14, 9, 14] (the neck). rx - = LIFT the head (nose up), ry = tilt, rz + = look
 *                                 right. Skull, cheeks, face, muzzle + nose, eyes, brows, mouth roof.
 *   jaw   box [11,0,8, 17,7,10]   pivot [14, 7, 10] = the hinge at the back-top of the lower jaw, parent head.
 *                                 OPEN = rx +, range 0 (closed) .. 28 (laugh) = bearFx.talk.jawMaxDeg (unchanged from
 *                                 v1; the game's `components.voxel.partRot = {part: 'jaw', rx}` override still clamps
 *                                 to [0, 28]). Lower lip, chin, tongue, lower teeth.
 *   ears  box [9,5,18, 19,9,20]   pivot [14, 7, 18], parent head. Both small round ears. rx + = perk forward,
 *                                 rx - = pin back.
 *   armL / armR  box [3|17, 10, 0, 11|25, 18, 19]  pivot [7.5|20.5, 14.5, 16] (shoulder), parent body. Front limbs:
 *                                 rx - = paw forward, ry: armR ry - = out to the right (armL ry + = out).
 *   legL / legR  box [3|17, 22, 0, 11|25, 34, 21]  pivot [7.5|20.5, 27.5, 15] (hip), parent body. rx - = foot forward.
 *   Every limb part also gets pos = -body.pos in each key (paws stay planted while the trunk bobs; `lift` raises one).
 *
 * Clips (durations in ms, all multiples of 50 = whole 60 Hz steps; ALL on four legs):
 *   idle    loop 5.7 s   breathing (trunk rises, paws planted), head low: sniffs the ground (jaw twitch), looks left
 *                        with an ear flick, looks right, back.
 *   talk    loop 1.6 s   head raised 26 deg toward the player + 12 keys: jaw 0/16/4/9/2/22/6/12/0/7/15/3 deg (small /
 *                        mid / wide syllables, 100-150 ms), key 8 = a closed 250 ms pause; nods, small turns, a shoulder
 *                        press on the stressed syllable (key 5), ears twitch.
 *   listen  loop 2.4 s   head raised 22 deg and tilted 10 deg, ears perked, breathing, one slow "mm-hm" nod.
 *   wave    once 1.8 s   the greeting on THREE legs: weight shifts left, the right front paw lifts and swipes out and
 *                        in twice (a bear's paw-raise), a soft huff (jaw), the paw sets down with a small squash.
 *   laugh   once 1.6 s   head toss up (jaw 26), shoulders bounce on planted paws with wide jaw chops, ears pinned back,
 *                        settles into the listen head height.
 *   walk    loop 0.7 s   diagonal pairs reach (lifted) / pass, the trunk yaws and bobs (bear lumber), the head swings
 *                        opposite; tuned for ~1.0 m/s.
 *   turn    loop 0.6 s   in-place shuffle: diagonal pairs lift 5 cm and step while the game turns the yaw.
 *   (v1's drop / rise / sit / sitTalk / standUp are REMOVED: no upright or seated poses, style-guide 0.2.)
 *
 * Clip -> state map (ASSETS.bearFx.clipFor; view-only, the NPC view sets components.voxel.anim):
 *   idle -> idle | greet (player first comes within ~4 m) -> wave, then idle | line typing -> talk | waiting for the
 *   player -> listen | line tagged happy -> laugh, then listen | moving -> walk | turning in place -> turn.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  var SX = 28, SY = 34, SZ = 22;
  var EYE_MAT = 'iron_dark';                 // 'ember_glow' = glowing eyes (boar style), 'brass_hot' = warm twinkle
  var JAW_MAX = 28;                          // max jaw open (rx deg); talk peaks at 22, laugh at 26
  // Roundness knobs (tri budget: 2000 LOD0). The first v1.52 build measured 2488 tris with 4/3/3/4; now 3/3/2/3. If
  // LOD0 is still over: set LIMB_OUTER false (drops the small outermost x-layer of each limb), then R_HEAD 2.
  var R_BODY = 3, R_HEAD = 2, R_LIMB = 2, R_HAUNCH = 3, LIMB_OUTER = false;

  // ---- voxel grid ----
  var G = [], x, y, z;
  for (z = 0; z < SZ; z++) { G.push([]); for (y = 0; y < SY; y++) { G[z].push([]); for (x = 0; x < SX; x++) G[z][y].push('.'); } }
  function put(px, py, pz, ch) { if (px >= 0 && px < SX && py >= 0 && py < SY && pz >= 0 && pz < SZ) G[pz][py][px] = ch; }
  function putSym(px, py, pz, ch) { put(px, py, pz, ch); put(SX - 1 - px, py, pz, ch); }
  // circular corner test for a rounded rectangle (ea / eb = the cell's distance to the nearest edge on each axis)
  function keep(ea, eb, r) {
    if (r <= 1) return true;
    var da = Math.max(0, r - 0.5 - ea), db = Math.max(0, r - 0.5 - eb);
    return da * da + db * db <= (r - 0.5) * (r - 0.5) + 0.3;
  }
  // one rounded rectangle on layer L of `axis`: 'x' -> (a, b) = (y, z); 'y' -> (x, z); 'z' -> (x, y). [a0,a1) x [b0,b1)
  function rect(axis, L, a0, a1, b0, b1, r, ch) {
    for (var b = b0; b < b1; b++) for (var a = a0; a < a1; a++) {
      if (!keep(Math.min(a - a0, a1 - 1 - a), Math.min(b - b0, b1 - 1 - b), r)) continue;
      var px = axis === 'x' ? L : a, py = axis === 'x' ? a : (axis === 'y' ? L : b), pz = axis === 'z' ? L : b;
      put(px, py, pz, typeof ch === 'function' ? ch(px, py, pz) : ch);
    }
  }
  // the same rectangle mirrored to the bear's right side (x -> SX-1-x)
  function rectSym(axis, L, a0, a1, b0, b1, r, ch) {
    rect(axis, L, a0, a1, b0, b1, r, ch);
    if (axis === 'x') rect('x', SX - 1 - L, a0, a1, b0, b1, r, ch);
    else rect(axis, L, SX - a1, SX - a0, b0, b1, r, ch);
  }

  // ---- trunk (body part): rounded slices, neck y9 .. rump y31; hump top z21 (1.1 m), back z20, rump z19 ----
  function bodyMat(px, py, pz) {
    if (pz >= 21 && py >= 12 && py <= 17) return 'b';          // grizzled hump tips
    return 'B';
  }
  rect('y', 9, 10, 18, 11, 18, 3, bodyMat);                    // neck (joins the back of the skull)
  for (y = 10; y <= 11; y++) rect('y', y, 9, 19, 10, 20, 3, bodyMat);
  for (y = 12; y <= 17; y++) rect('y', y, 8, 20, 9, 22, R_BODY, bodyMat);   // shoulders + hump
  for (y = 18; y <= 24; y++) rect('y', y, 8, 20, 9, 21, R_BODY, bodyMat);   // back slopes, belly hangs
  for (y = 25; y <= 29; y++) rect('y', y, 8, 20, 10, 20, R_BODY, bodyMat);  // loins
  for (y = 30; y <= 31; y++) rect('y', y, 9, 19, 11, 19, 3, bodyMat);       // rump

  // ---- head (head part): carried low; skull y4..8, muzzle y0..3 ----
  function headMat(px, py, pz) { return (py <= 5 && pz >= 13) ? 'b' : 'B'; }   // lighter face / forehead
  rect('y', 8, 9, 19, 11, 18, R_HEAD, headMat);                // back of the skull
  rect('y', 7, 8, 20, 10, 18, R_HEAD, headMat);                // cheek ruffs (widest)
  rect('y', 6, 8, 20, 10, 18, R_HEAD, headMat);
  rect('y', 5, 9, 19, 10, 17, R_HEAD, headMat);                // face
  rect('y', 4, 10, 18, 10, 16, R_HEAD, headMat);               // the dished stop under the brow
  rect('y', 3, 11, 17, 10, 15, 2, 'M');                        // long tapering muzzle (tan)
  rect('y', 2, 11, 17, 10, 14, 2, 'M');
  rect('y', 1, 11, 17, 10, 14, 2, 'M');
  rect('y', 0, 12, 16, 11, 14, 1, 'M');
  for (x = 12; x <= 15; x++) put(x, 0, 13, 'N');               // nose pad
  put(13, 0, 12, 'N'); put(14, 0, 12, 'N'); put(13, 1, 13, 'N'); put(14, 1, 13, 'N');
  for (y = 1; y <= 3; y++) { put(12, y, 10, 'D'); put(15, y, 10, 'D'); put(13, y, 10, 'R'); put(14, y, 10, 'R'); }  // lips + roof
  put(12, 4, 15, 'E'); put(15, 4, 15, 'E');                    // small eyes, set close
  put(12, 5, 16, 'B'); put(15, 5, 16, 'B');                    // brows

  // ---- jaw part: under the muzzle, z8..9, y1..6 ----
  function jawTop(px, py) {
    if (py === 1) return 'D';                                  // dark lower lip (the mouth line seen from the front)
    if ((px === 13 || px === 14) && py >= 2 && py <= 4) return 'T';
    if ((px === 12 || px === 15) && py === 2) return 'W';      // lower canines, behind the lip
    if ((px === 12 || px === 15) && py >= 3 && py <= 5) return 'R';
    return 'b';
  }
  rect('z', 9, 11, 17, 1, 7, 2, jawTop);
  rect('z', 8, 12, 16, 2, 7, 2, 'b');                          // chin

  // ---- ears part: small, round, far back on the skull ----
  putSym(10, 6, 18, 'B'); putSym(11, 6, 18, 'D'); putSym(10, 7, 18, 'B'); putSym(11, 7, 18, 'B'); putSym(10, 7, 19, 'B');

  // ---- front limbs (armL, mirrored armR): wide paw, tapered forearm, rounded shoulder mass outside the trunk ----
  function armMat(px, py, pz) { return pz >= 14 ? 'B' : 'D'; }
  rectSym('z', 0, 4, 11, 11, 18, 2, 'D');                      // paw sole 7 x 7
  rectSym('z', 1, 4, 11, 11, 18, R_LIMB, 'D');                 // rounded paw top edge
  for (z = 2; z <= 5; z++) rectSym('z', z, 5, 10, 12, 17, 2, 'D');   // wrist / lower forearm 5 x 5
  for (z = 6; z <= 8; z++) rectSym('z', z, 4, 11, 11, 17, 2, 'D');   // big forearm 7 x 6
  rectSym('x', 7, 11, 18, 6, 19, R_LIMB, armMat);              // shoulder + upper arm (outside the trunk, x < 8)
  rectSym('x', 6, 11, 18, 6, 18, R_LIMB, armMat);
  rectSym('x', 5, 11, 17, 7, 17, R_LIMB, armMat);
  if (LIMB_OUTER) rectSym('x', 4, 12, 17, 8, 15, 2, armMat);
  putSym(5, 10, 0, 'C'); putSym(7, 10, 0, 'C'); putSym(9, 10, 0, 'C');     // 3 front claws

  // ---- hind limbs (legL, mirrored legR): long plantigrade foot, thick shin, big rounded haunch ----
  function legMat(px, py, pz) { return pz >= 12 ? 'B' : 'D'; }
  rectSym('z', 0, 4, 11, 23, 32, 2, 'D');                      // foot sole 7 x 9
  rectSym('z', 1, 4, 11, 24, 32, R_LIMB, 'D');
  for (z = 2; z <= 4; z++) rectSym('z', z, 5, 10, 26, 32, 2, 'D');   // heel / ankle
  for (z = 5; z <= 8; z++) rectSym('z', z, 4, 11, 25, 32, 2, 'D');   // shin
  rectSym('x', 7, 23, 34, 5, 20, R_HAUNCH, legMat);            // haunch (outside the trunk, x < 8)
  rectSym('x', 6, 24, 34, 6, 19, R_HAUNCH, legMat);
  rectSym('x', 5, 25, 33, 7, 18, R_HAUNCH, legMat);
  if (LIMB_OUTER) rectSym('x', 4, 26, 32, 9, 16, 3, legMat);
  rectSym('y', 32, 7, 11, 10, 19, 3, legMat);                  // back of the haunch behind the rump
  putSym(6, 22, 0, 'C'); putSym(8, 22, 0, 'C');                // 2 short hind claws

  function buildLayers() {
    var out = [];
    for (var lz = 0; lz < SZ; lz++) { var rows = []; for (var ly = 0; ly < SY; ly++) rows.push(G[lz][ly].join('')); out.push(rows); }
    return out;
  }

  // ---- pose helpers. o = { b: [rx,ry,rz, px,py,pz] body, h: head [rx,ry,rz], j: jaw rx, e: ears, aL/aR/lL/lR: limb
  // [rx,ry,rz] or a plain rx number, lift: {aL: dz, ...} raises one limb (voxels) }. Every limb gets pos = -body.pos
  // (+ lift), so the paws stay planted while the trunk bobs or shifts its weight. addO(base, o) adds o onto base. ----
  var LIMBS = ['aL', 'aR', 'lL', 'lR'];
  function v3(a) {
    if (a === undefined || a === null) return [0, 0, 0];
    if (typeof a === 'number') return [a, 0, 0];
    return [a[0] || 0, a[1] || 0, a[2] || 0];
  }
  function r2(v) { var r = Math.round(v * 100) / 100; return r === 0 ? 0 : r; }
  function rr(a) { return [r2(a[0]), r2(a[1]), r2(a[2])]; }
  function addV(a, b) { var p = v3(a), q = v3(b); return [p[0] + q[0], p[1] + q[1], p[2] + q[2]]; }
  function addO(base, o) {
    var bb = base.b || [], ob = o.b || [], b = [], k, lift = {};
    for (k = 0; k < 6; k++) b.push((bb[k] || 0) + (ob[k] || 0));
    for (k = 0; k < 4; k++) {
      var n = LIMBS[k], v = ((base.lift || {})[n] || 0) + ((o.lift || {})[n] || 0);
      if (v) lift[n] = v;
    }
    return { b: b, h: addV(base.h, o.h), j: (base.j || 0) + (o.j || 0), e: addV(base.e, o.e), lift: lift,
             aL: addV(base.aL, o.aL), aR: addV(base.aR, o.aR), lL: addV(base.lL, o.lL), lR: addV(base.lR, o.lR) };
  }
  function pose(o) {
    var b = o.b || [0, 0, 0, 0, 0, 0], lift = o.lift || {};
    function limb(n) { return { rot: rr(v3(o[n])), pos: rr([-(b[3] || 0), -(b[4] || 0), -(b[5] || 0) + (lift[n] || 0)]) }; }
    return {
      body: { rot: rr([b[0] || 0, b[1] || 0, b[2] || 0]), pos: rr([b[3] || 0, b[4] || 0, b[5] || 0]) },
      head: { rot: rr(v3(o.h)) },
      jaw:  { rot: [r2(Math.max(0, Math.min(JAW_MAX, o.j || 0))), 0, 0] },
      ears: { rot: rr(v3(o.e)) },
      armL: limb('aL'),
      armR: limb('aR'),
      legL: limb('lL'),
      legR: limb('lR')
    };
  }
  // keys = [[ms, o], ...]; base = optional pose object every key is added onto
  function clip(keys, loop, base) {
    var d = [], f = [];
    for (var k = 0; k < keys.length; k++) { d.push(keys[k][0]); f.push(pose(base ? addO(base, keys[k][1]) : keys[k][1])); }
    return { durations: d, loop: loop, frames: f };
  }

  var BREATH = { b: [0, 0, 0, 0, 0, 0.25], h: [2, 0, 0] };
  var TALK_UP = { h: [-26, 0, 0], e: [8, 0, 0] };              // head raised toward the player while speaking
  // talk: jaw sizes small (2-7) / mid (9-12) / wide (15-22), 100-150 ms syllables, key 8 = closed pause (bearFx.talk)
  var TALK = [
    [100, {}],
    [150, { j: 16, h: [-3, 0, 2], b: [0, 0, 0, 0, 0, 0.15] }],
    [100, { j: 4, h: [-1, 0, 2] }],
    [100, { j: 9, h: [2, 0, 3] }],
    [100, { j: 2, h: [3, 0, 3] }],
    [150, { j: 22, h: [-5, 2, 0], b: [0, 0, 0, 0, 0, 0.3], e: [6, 0, 0] }],
    [150, { j: 6, h: [5, 1, -2], b: [0, 0, 0, 0, 0, -0.15] }],
    [100, { j: 12, h: [1, 0, -3] }],
    [250, { j: 0, h: [0, 0, -4] }],
    [100, { j: 7, h: [-1, 0, -3] }],
    [150, { j: 15, h: [-3, -1, 0], b: [0, 0, 0, 0, 0, 0.15], e: [4, 0, 0] }],
    [150, { j: 3, h: [2, 0, 0] }]
  ];
  var WAVE_B = { h: [-20, 0, 0], e: [6, 0, 0], b: [0, 0, 0, -0.4, 0, 0] };   // head up, weight onto the left side
  function W(o) { return addO(WAVE_B, o); }
  var PIN = [-22, 0, 0];                                        // ears pinned back (laugh)

  var animations = {
    idle: clip([
      [800, {}],
      [700, BREATH],
      [600, { h: [8, 0, -4] }],                                 // nose down: sniffing the ground
      [300, { h: [10, 0, -5], j: 2 }],
      [300, { h: [8, 0, -5] }],
      [700, { h: [-6, 2, -18], b: [0, 0, -2, 0, 0, 0] }],      // looks left
      [100, { h: [-6, 2, -18], b: [0, 0, -2, 0, 0, 0], e: [-25, 0, 0] }],   // ear flick back ...
      [800, { h: [-6, 2, -18], b: [0, 0, -2, 0, 0, 0], e: [5, 0, 0] }],     // ... snap forward
      [800, addO(BREATH, { h: [-4, 0, 12], b: [0, 0, 1, 0, 0, 0] })],         // looks right
      [600, { h: [0, 0, 4] }]
    ], true),
    talk: clip(TALK, true, TALK_UP),
    listen: clip([
      [900, { h: [-22, 10, 4], e: [10, 0, 0] }],
      [700, { h: [-23, 11, 4], e: [10, 0, 0], b: [0, 0, 0, 0, 0, 0.25] }],
      [150, { h: [-22, 10, 4], e: [10, 0, 0] }],
      [250, { h: [-14, 9, 4], e: [7, 0, 0] }],                  // "mm-hm" nod
      [400, { h: [-22, 10, 4], e: [10, 0, 0] }]
    ], true),
    // greeting on three legs: the right front paw lifts and swipes out / in twice
    wave: clip([
      [100, { h: [-20, 0, 0], e: [6, 0, 0] }],
      [150, W({ b: [0, 0, 0, 0, 0, -0.2], h: [2, 0, 0], aR: 6 })],                     // anticipation: press down
      [200, W({ h: [-2, -4, 4], aR: [-40, -6, 0], j: 6, lift: { aR: 1.2 } })],         // paw up
      [200, W({ h: [-2, -4, 6], aR: [-48, -16, 0], j: 8, lift: { aR: 1.2 } })],        // swipe out
      [200, W({ h: [-2, -4, 3], aR: [-44, 2, 0], j: 4, lift: { aR: 1.2 } })],          // in
      [200, W({ h: [-2, -4, 6], aR: [-48, -16, 0], j: 10, lift: { aR: 1.2 } })],       // out (huff)
      [250, W({ aR: [-28, -4, 0], j: 3, lift: { aR: 0.8 } })],                         // lowering
      [200, { h: [-16, 0, 0], e: [4, 0, 0], b: [0, 0, 0, -0.1, 0, -0.15], aR: -2 }],   // sets down, small squash
      [300, {}]
    ], false),
    // head toss + shoulder bounce on planted paws, ears pinned, wide jaw chops; settles into the listen head height
    laugh: clip([
      [150, { h: [-14, 0, 0], j: 3, b: [0, 0, 0, 0, 0, -0.3] }],
      [150, { h: [-40, 0, 0], j: 26, b: [0, 0, 0, 0, 0, 0.5], e: PIN }],
      [100, { h: [-32, 0, 4], j: 12, b: [0, 0, 0, 0, 0, -0.3], e: PIN }],
      [100, { h: [-38, 0, -4], j: 24, b: [0, 0, 0, 0, 0, 0.4], e: PIN }],
      [100, { h: [-30, 0, 4], j: 10, b: [0, 0, 0, 0, 0, -0.3], e: PIN }],
      [100, { h: [-36, 0, -3], j: 22, b: [0, 0, 0, 0, 0, 0.4], e: PIN }],
      [150, { h: [-28, 0, 0], j: 8, b: [0, 0, 0, 0, 0, -0.2], e: [-18, 0, 0] }],
      [150, { h: [-32, 0, 0], j: 15, b: [0, 0, 0, 0, 0, 0.2], e: [-14, 0, 0] }],
      [300, { h: [-16, 0, 0], j: 3, e: [-4, 0, 0] }],
      [300, { h: [-22, 0, 0] }]
    ], false),
    // diagonal pairs (left fore + right hind) reach / pass, trunk yaw + bob lumber, head swings opposite
    walk: clip([
      // reach keys: the reaching pair is lifted 7-8 cm; the stance pair gets a small lift that cancels the toe dip of
      // a limb swung back about its high shoulder / hip pivot (so no paw sinks into the ground)
      [200, { b: [0, 0, 2, 0, 0, 0], h: [3, 0, -3], aL: -14, aR: 10, lL: 12, lR: -12,
              lift: { aL: 1.4, aR: 0.6, lL: 0.9, lR: 1.6 } }],
      [150, { b: [0, 0, 0, 0, 0, 0.4], aL: -3, aR: 3, lL: 2, lR: -2 }],
      [200, { b: [0, 0, -2, 0, 0, 0], h: [3, 0, 3], aL: 10, aR: -14, lL: -12, lR: 12,
              lift: { aL: 0.6, aR: 1.4, lL: 1.6, lR: 0.9 } }],
      [150, { b: [0, 0, 0, 0, 0, 0.4], aL: 3, aR: -3, lL: -2, lR: 2 }]
    ], true),
    // in-place shuffle while the game turns the yaw: diagonal pairs lift 5 cm and step
    turn: clip([
      [150, { lift: { aL: 1, lR: 1 }, aL: -6, lR: -4, b: [0, 0, 2, 0, 0, 0], h: [2, 0, 5] }],
      [150, { b: [0, 0, 0, 0, 0, -0.15] }],
      [150, { lift: { aR: 1, lL: 1 }, aR: -6, lL: -4, b: [0, 0, -2, 0, 0, 0], h: [2, 0, -5] }],
      [150, { b: [0, 0, 0, 0, 0, -0.15] }]
    ], true)
  };

  A.models.bear = {
    name: 'bear',
    displayName: 'brown bear',
    desc: 'v1.52 (bear v2) Burl, a realistic brown bear on all fours (1.1 m at the shoulder hump, 1.7 m nose to rump): ' +
          'rounded barrel trunk with a heavy shoulder hump and a sloping back, low-carried head with a long tan muzzle, ' +
          'dark nose, small eyes and small round ears, big tapered forearms on wide rounded paws with pale claws, big ' +
          'rounded haunches over long plantigrade feet; dark legs, grizzled hump. Talks with head, jaw and ' +
          'ears. 8 parts (body, head, jaw, ears, 2 front, 2 hind limbs): idle, talk, listen, wave (paw raise on three ' +
          'legs), laugh, walk, turn.',
    voxel: {
      version: 1,
      meshOnly: true,
      cellM: 0.05,
      size: [SX, SY, SZ],
      anchor: [14, 17, 0],
      light: false,
      mats: {
        B: 'skin_shade',     // trunk, skull, upper limbs (warm mid brown)
        b: 'skin',           // grizzled hump tips, face, chin (lighter)
        M: 'skin_light',     // muzzle (tan)
        D: 'hair_dark',      // legs, paws, inner ears, lips
        C: 'linen_dark',     // claws (pale horn)
        N: 'iron_dark',      // nose pad
        E: EYE_MAT,          // eyes
        R: 'gore_red_dark',  // mouth roof / floor
        T: 'gore_red',       // tongue
        W: 'linen_light'     // lower teeth
      },
      layers: buildLayers(),
      parts: {
        body: { box: [8, 9, 9, 20, 32, 22], pivot: [14, 21, 12] },
        head: { box: [8, 0, 10, 20, 9, 18], pivot: [14, 9, 14], parent: 'body' },
        jaw:  { box: [11, 0, 8, 17, 7, 10], pivot: [14, 7, 10], parent: 'head' },
        ears: { box: [9, 5, 18, 19, 9, 20], pivot: [14, 7, 18], parent: 'head' },
        armL: { box: [3, 10, 0, 11, 18, 19], pivot: [7.5, 14.5, 16], parent: 'body' },
        armR: { box: [17, 10, 0, 25, 18, 19], pivot: [20.5, 14.5, 16], parent: 'body' },
        legL: { box: [3, 22, 0, 11, 34, 21], pivot: [7.5, 27.5, 15], parent: 'body' },
        legR: { box: [17, 22, 0, 25, 34, 21], pivot: [20.5, 27.5, 15], parent: 'body' }
      },
      animations: animations,
      // grid coords, rest pose; they follow their part's animated pose (raising the head lifts `speech` and `eyes`)
      mounts: {
        speech:   { at: [14, 6, 23], part: 'head' },     // ~0.15 m over the ears: speech bubble / name tag anchor
        eyes:     { at: [14, 4, 15.5], part: 'head' },   // dialogue camera look-at (between the eyes)
        mouth:    { at: [14, 0.5, 10.5], part: 'head' }, // voice / breath puff origin
        interact: { at: [14, 14, 16], part: 'body' },    // [E] Talk prompt aim (front shoulder, 0.8 m)
        pawR:     { at: [20.5, 14.5, 1], part: 'armR' }  // right front paw (wave sparkle, a held item later)
      }
    }
  };

  // ===================================================================================================================
  // ASSETS.bearFx - presentation data for the NPC view + the dialogue box (no game logic here).
  // ===================================================================================================================
  A.bearFx = {
    version: 2,
    model: 'bear',
    clipFor: {
      state: { idle: 'idle', greet: 'wave', talk: 'talk', listen: 'listen', laugh: 'laugh', move: 'walk', turn: 'turn' },
      once: { wave: 'idle', laugh: 'listen' },
      move: { start: 'walk', loop: 'walk', stop: 'idle' },
      note: 'once = non-loop clips and what follows them at animEnd. Every clip is on four legs (style-guide 0.2); ' +
            'the v1 seated / upright clips (drop, rise, sit, sitTalk, standUp) are gone. The walk is tuned for ~1.0 m/s.'
    },
    talk: {
      jawPart: 'jaw', jawAxis: 'rx', jawOpenSign: 1, jawMaxDeg: JAW_MAX, jawPivot: [14, 7, 10],
      textCps: 28,                                   // suggested type-on speed of the dialogue box
      pauseMs: { ',': 180, ';': 180, ':': 180, '-': 180, '.': 380, '!': 380, '?': 380 },
      pauseKey: 8, pauseAtMs: 950,                   // talk key 8 = jaw closed; its start = 950 ms into the clip
      rule: 'play `talk` while the line types on. On a punctuation pause hold the clip at pauseAtMs (jaw closed) for ' +
            'pauseMs, then resume FROM pauseAtMs (seamless). When the line is fully shown switch to `listen`. Lines ' +
            'tagged happy play `laugh` once first. preview/voxel_bear.html does exactly this.'
    },
    sampleLine: { name: 'Bear', text: 'Hrrm. Easy, little one - I only bite honeycomb. Sit a while; the hill is quiet, ' +
                  'and I have stories.', note: 'placeholder text for the preview; the writer owns the real lines' }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { bear: A.models.bear, bearFx: A.bearFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
