#!/usr/bin/env python3
"""INTRO-ASCII-01 (owner 2026-10-16, D-111): turn a picture into REAL glyph cells for the intro slideshow.

Usage:
  python tools/img2ascii.py design/intro/src/01-ferrum.webp --out content/intro/01-ferrum.ascii.json [--grid 400x150] [--preview out.png]
  python tools/img2ascii.py --all          # every image in design/intro/src -> content/intro/*.ascii.json (+ previews in design/intro/preview/)

Per cell (the engine's own look: dark background fill + a lit glyph on top):
  - the cell's average colour is quantised to a per-slide palette (<= 128 colours, median cut);
  - bg = that colour darkened (BG_K), fg = that colour brightened (FG_K);
  - the glyph comes from the game's `default` ramp in design/palette.js (' .,:;-=+*o#%&@'),
    picked by cell luminance with the palette's rampGamma / cutoff, plus local contrast so edges read.
Output JSON: {version, cols, rows, ramp, palette:[hex...], glyphs:"<rows*cols chars>", fg:"<base64 u8 index>", bg:"<base64 u8 index>"}.
Source images stay git-ignored (design/intro/src); the .ascii.json files are game content and are committed.
"""
import argparse, base64, json, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

RAMP = ' .,:;-=+*o#%&@'   # design/palette.js ramps.default (14 steps, index 0 = space)
GAMMA = 0.6              # palette.js rampGamma
CUTOFF = 0.03             # palette.js cutoff
BG_K = 0.36               # background = cell colour * BG_K
FG_K = 1.9               # glyph colour = cell colour * FG_K (clamped)
EDGE_K = 0.6              # how much local contrast lifts the glyph density


def convert(path, cols, rows, ncolors=128):
    src = Image.open(path).convert('RGB')
    # fill the 16:9 grid (crop to aspect, centre)
    sw, sh = src.size
    target = (cols / rows) * (2.0 / 3.0) if False else 16 / 9  # the intro is shown full-screen 16:9
    if sw / sh > target:
        nw = int(sh * target); src = src.crop(((sw - nw) // 2, 0, (sw - nw) // 2 + nw, sh))
    else:
        nh = int(sw / target); src = src.crop((0, (sh - nh) // 2, sw, (sh - nh) // 2 + nh))
    small = src.resize((cols, rows), Image.LANCZOS)
    edges = src.convert('L').filter(ImageFilter.FIND_EDGES).resize((cols, rows), Image.BOX)
    q = small.quantize(colors=ncolors, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[: ncolors * 3]
    n = len(pal) // 3

    def clamp(v): return max(0, min(255, int(round(v))))
    base = [(pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]) for i in range(n)]
    # palette = [bg variants (n)] + [fg variants (n)]
    colors = [tuple(clamp(c * BG_K) for c in b) for b in base] + [tuple(clamp(c * FG_K) for c in b) for b in base]
    idx = list(q.getdata()); px = list(small.getdata()); ed = list(edges.getdata())
    glyphs, fg, bg = [], bytearray(), bytearray()
    for i in range(cols * rows):
        r, g, b = px[i]
        lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
        lum = min(1.0, lum + EDGE_K * (ed[i] / 255.0) * 0.5)
        if lum < CUTOFF:
            k = 0
        else:
            k = 1 + int((lum ** GAMMA) * (len(RAMP) - 2) + 0.5)
            k = max(1, min(len(RAMP) - 1, k))
        glyphs.append(RAMP[k]); bg.append(idx[i]); fg.append(idx[i] + n)
    return {
        'version': 1, 'cols': cols, 'rows': rows, 'ramp': RAMP,
        'palette': ['#%02x%02x%02x' % c for c in colors],
        'glyphs': ''.join(glyphs),
        'bg': base64.b64encode(bytes(bg)).decode('ascii'),
        'fg': base64.b64encode(bytes(fg)).decode('ascii'),
    }


def preview(cells, out, width=1920):
    cols, rows = cells['cols'], cells['rows']
    cw, ch = 10, 15  # cell box before scaling (engine cells are taller than wide)
    img = Image.new('RGB', (cols * cw, rows * ch), (0, 0, 0))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 15)
    except OSError:
        font = ImageFont.load_default()
    pal = [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in cells['palette']]
    bg = base64.b64decode(cells['bg']); fg = base64.b64decode(cells['fg']); gl = cells['glyphs']
    for y in range(rows):
        for x in range(cols):
            i = y * cols + x
            d.rectangle((x * cw, y * ch, x * cw + cw - 1, y * ch + ch - 1), fill=pal[bg[i]])
            if gl[i] != ' ':
                d.text((x * cw, y * ch - 1), gl[i], fill=pal[fg[i]], font=font)
    img = img.resize((width, int(width * img.height / img.width)), Image.LANCZOS)
    img.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src', nargs='?')
    ap.add_argument('--out')
    ap.add_argument('--grid', default='400x150')
    ap.add_argument('--preview')
    ap.add_argument('--all', action='store_true')
    a = ap.parse_args()
    cols, rows = (int(v) for v in a.grid.lower().split('x'))
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    jobs = []
    if a.all:
        sdir = os.path.join(root, 'design', 'intro', 'src')
        for f in sorted(os.listdir(sdir)):
            if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                stem = os.path.splitext(f)[0]
                jobs.append((os.path.join(sdir, f), os.path.join(root, 'content', 'intro', stem + '.ascii.json'),
                             os.path.join(root, 'design', 'intro', 'preview', stem + '.png')))
    elif a.src:
        jobs.append((a.src, a.out or os.path.splitext(a.src)[0] + '.ascii.json', a.preview))
    else:
        ap.error('give an image or --all')
    for src, out, prev in jobs:
        cells = convert(src, cols, rows)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, 'w', encoding='utf-8', newline='\n') as fh:
            json.dump(cells, fh, separators=(',', ':'))
        if prev:
            os.makedirs(os.path.dirname(prev), exist_ok=True)
            preview(cells, prev)
        print('%s -> %s (%dx%d, %d colours, %d KB)' % (os.path.basename(src), os.path.relpath(out, root), cols, rows,
              len(cells['palette']), os.path.getsize(out) // 1024))


if __name__ == '__main__':
    sys.exit(main())
