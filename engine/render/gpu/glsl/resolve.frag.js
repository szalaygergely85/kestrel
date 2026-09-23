// US-030b (docs/architecture.md 14.2 item 3, pass B): resolves the n*n
// sub-sample G-buffer ('SGI'/'SGA'/'SDEPTH', written by the cast pass at
// 'cols*n x rows*n') down to the final per-cell 'GI'/'GA'/'DEPTH' ('cols x
// rows', the same textures 14.1 defined - deriv/shade/edge are unchanged
// consumers). With n = 1 this is a straight copy (the sub-grid IS the cell
// grid) - US-030a's parity behaviour is unaffected bit for bit.
//
// Vote rule (normative, 14.2 item 3): group the n*n sub-samples by key
// (kind, planeId, mat); winner = largest group, ties -> smaller min depth;
// the written GA/DEPTH sample is the winner GROUP's own sub-sample nearest
// the cell centre (fixed offset grid, never jittered - "nearest" tie breaks
// on scan order, i.e. the smallest sub-index, matching shade.frag.js's own
// tie break so both passes agree on which physical sub-sample is "the"
// sample for a cell). `GI.y` gains the 3-bit `cov` field (bits 13-15,
// between `mask` now 1 bit at bit 12 and `mat` at bits 16-31 - see
// common.js's GBUF_UNPACK doc): `cov = clamp(winnerCount*8/(n*n) - 1, 0, 7)`.
//
// O(n^4) worst case (16*16 = 256 compares/cell at n=4) - cheap: budgeted at
// ~0.1 ms per 14.2 item 6 ("resolve/deriv/edge/sprite ~0.1 ms each").
import { GLSL_VERSION, PRECISION, GBUF_UNPACK } from './common.js';

export const MAX_SUB = 16; // 4x4, the architecture's hard cap (n <= 4)

export const RESOLVE_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
layout(location = 0) out uvec2 outGI;
layout(location = 1) out uvec4 outGA;
layout(location = 2) out uint outDepth;

uniform usampler2D uSGI;    // RG32UI, sub-grid cols*n x rows*n
uniform usampler2D uSGA;    // RGBA32UI (floatBitsToUint u,v,z,aoD), sub-grid
uniform usampler2D uSDepth; // R32UI (floatBitsToUint dist), sub-grid
uniform usampler2D uMask;   // R8UI, cols x rows (per-cell UI overlay bit)
uniform int uN; // rays per axis (1..4)

${GBUF_UNPACK}

const int MAX_SUB = ${MAX_SUB};

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  int n2 = uN * uN;

  uint kk[MAX_SUB]; int pk[MAX_SUB]; uint mk[MAX_SUB]; float dk[MAX_SUB];
  int k = 0;
  for (int j = 0; j < 4; j++) {
    if (j >= uN) break;
    for (int i = 0; i < 4; i++) {
      if (i >= uN) break;
      ivec2 sc = ivec2(cell.x * uN + i, cell.y * uN + j);
      uvec2 sgi = texelFetch(uSGI, sc, 0).xy;
      kk[k] = giKind(sgi.y); pk[k] = int(sgi.x); mk[k] = giMat(sgi.y);
      dk[k] = uintBitsToFloat(texelFetch(uSDepth, sc, 0).x);
      k++;
    }
  }

  // Winning key: largest group, ties -> smaller min depth. Iterating a in
  // scan order and only replacing on STRICT improvement makes the pick
  // deterministic (the first-scanned member of a tied group stands).
  int bestCount = -1; float bestMinDepth = 1.0e30; int winner = 0;
  for (int a = 0; a < MAX_SUB; a++) {
    if (a >= n2) break;
    int count = 0; float minD = 1.0e30;
    for (int b = 0; b < MAX_SUB; b++) {
      if (b >= n2) break;
      if (kk[b] == kk[a] && pk[b] == pk[a] && mk[b] == mk[a]) { count++; if (dk[b] < minD) minD = dk[b]; }
    }
    if (count > bestCount || (count == bestCount && minD < bestMinDepth)) {
      bestCount = count; bestMinDepth = minD; winner = a;
    }
  }

  // Among the winning group's own members, the one nearest the (fixed,
  // never-jittered) cell centre supplies GA/DEPTH - same tie rule
  // (shade.frag.js recomputes this same pick independently, from the same
  // offsets, so both passes agree without extra plumbing).
  int nearest = -1; float nearestMag = 1.0e30;
  for (int a = 0; a < MAX_SUB; a++) {
    if (a >= n2) break;
    if (kk[a] != kk[winner] || pk[a] != pk[winner] || mk[a] != mk[winner]) continue;
    int ii = a - (a / uN) * uN, jj = a / uN;
    float ox = (float(ii) + 0.5) / float(uN) - 0.5;
    float oy = (float(jj) + 0.5) / float(uN) - 0.5;
    float mag = ox * ox + oy * oy;
    if (mag < nearestMag) { nearestMag = mag; nearest = a; }
  }

  uint kind = kk[nearest];
  uint mask = texelFetch(uMask, cell, 0).x & 1u;
  int cov = int(float(bestCount) * 8.0 / float(n2) - 1.0);
  cov = clamp(cov, 0, 7);

  ivec2 sc = ivec2(cell.x * uN + (nearest - (nearest / uN) * uN), cell.y * uN + (nearest / uN));
  if (kind == 0u) {
    outGI = uvec2(0u, mask << 12u);
    outGA = uvec4(0u);
    outDepth = 0x7f800000u;
  } else {
    uint faceBits = (texelFetch(uSGI, sc, 0).y >> 8u) & 0xfu;
    outGI = uvec2(uint(pk[nearest]), kind | (faceBits << 8u) | (mask << 12u) | (uint(cov) << 13u) | (mk[nearest] << 16u));
    outGA = texelFetch(uSGA, sc, 0);
    outDepth = texelFetch(uSDepth, sc, 0).x;
  }
}
`;
