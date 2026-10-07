// MESH-UVMAP-01: dependency-free PNG decoder (node:zlib inflate only). 8-bit greyscale / grey+alpha / RGB / RGBA / palette,
// non-interlaced. Returns { width, height, channels: 4, data: Uint8Array RGBA }. Throws (naming the problem) on anything else.
import zlib from 'node:zlib';

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function readPng(buf) {
  if (buf.length < 8 || SIG.some((b, i) => buf[i] !== b)) throw new Error('png-read: not a PNG (bad signature)');
  let o = 8, hdr = null, plte = null, trns = null;
  const idat = [];
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8);
    const body = buf.subarray(o + 8, o + 8 + len);
    o += 12 + len; // length + type + data + crc
    if (type === 'IHDR') hdr = { w: body.readUInt32BE(0), h: body.readUInt32BE(4), depth: body[8], ctype: body[9], interlace: body[12] };
    else if (type === 'PLTE') plte = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  if (!hdr) throw new Error('png-read: missing IHDR');
  if (hdr.depth !== 8) throw new Error(`png-read: unsupported bit depth ${hdr.depth} (8 only)`);
  if (hdr.interlace) throw new Error('png-read: interlaced PNG not supported');
  const spp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[hdr.ctype];
  if (!spp) throw new Error(`png-read: unsupported colour type ${hdr.ctype}`);
  if (hdr.ctype === 3 && !plte) throw new Error('png-read: palette PNG without PLTE');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = hdr.w * spp;
  if (raw.length < (stride + 1) * hdr.h) throw new Error('png-read: truncated pixel data');
  const px = new Uint8Array(stride * hdr.h);
  for (let y = 0; y < hdr.h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= spp ? px[dst + x - spp] : 0;
      const b = y ? px[dst - stride + x] : 0;
      const c = x >= spp && y ? px[dst - stride + x - spp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (f !== 0) throw new Error(`png-read: bad filter type ${f} on row ${y}`);
      px[dst + x] = v & 255;
    }
  }
  const data = new Uint8Array(hdr.w * hdr.h * 4);
  for (let i = 0; i < hdr.w * hdr.h; i++) {
    const s = i * spp, d = i * 4;
    if (hdr.ctype === 6) { data[d] = px[s]; data[d + 1] = px[s + 1]; data[d + 2] = px[s + 2]; data[d + 3] = px[s + 3]; }
    else if (hdr.ctype === 2) { data[d] = px[s]; data[d + 1] = px[s + 1]; data[d + 2] = px[s + 2]; data[d + 3] = 255; }
    else if (hdr.ctype === 0) { data[d] = data[d + 1] = data[d + 2] = px[s]; data[d + 3] = 255; }
    else if (hdr.ctype === 4) { data[d] = data[d + 1] = data[d + 2] = px[s]; data[d + 3] = px[s + 1]; }
    else { const p = px[s]; data[d] = plte[p * 3]; data[d + 1] = plte[p * 3 + 1]; data[d + 2] = plte[p * 3 + 2]; data[d + 3] = trns && p < trns.length ? trns[p] : 255; }
  }
  return { width: hdr.w, height: hdr.h, channels: 4, data };
}

/** Nearest-pixel sample at uv (wraps, v down like glTF): returns [r,g,b,a]. */
export function samplePng(img, u, v) {
  const fx = u - Math.floor(u), fy = v - Math.floor(v);
  const x = Math.min(img.width - 1, Math.floor(fx * img.width)), y = Math.min(img.height - 1, Math.floor(fy * img.height));
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}
