"""Draw the Echo Lingo app icons (sound waves on indigo) into icons/."""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')
os.makedirs(OUT, exist_ok=True)


def icon(size, pad_frac=0.0, rounded=True):
    s = size * 4  # draw large, then downsample for smooth edges
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    bg = (79, 70, 229, 255)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=bg)
    else:
        d.rectangle([0, 0, s, s], fill=bg)
    inner = s * (1 - 2 * pad_frac)
    ox = s * pad_frac
    cx, cy = ox + inner * 0.34, ox + inner * 0.44
    # speaker dot
    r0 = inner * 0.09
    d.ellipse([cx - r0, cy - r0, cx + r0, cy + r0], fill=(255, 255, 255, 255))
    # three echo arcs, fading out
    for i, (rad, alpha) in enumerate([(0.2, 255), (0.32, 200), (0.44, 140)]):
        R = inner * rad
        w = int(inner * 0.055)
        d.arc([cx - R, cy - R, cx + R, cy + R], start=-50, end=50, fill=(255, 255, 255, alpha), width=w)
    # three colored dots: Korean blue, Japanese red, Chinese orange
    for j, col in enumerate([(107, 156, 240), (240, 112, 136), (240, 149, 75)]):
        x = ox + inner * (0.24 + j * 0.15)
        y = ox + inner * 0.84
        rr = inner * 0.045
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=col + (255,))
    return img.resize((size, size), Image.LANCZOS)


icon(192).save(os.path.join(OUT, 'icon-192.png'))
icon(512).save(os.path.join(OUT, 'icon-512.png'))
icon(512, pad_frac=0.1, rounded=False).save(os.path.join(OUT, 'icon-maskable-512.png'))
icon(180, rounded=False).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))
icon(64).save(os.path.join(OUT, 'favicon.png'))
print('icons written to', OUT)
