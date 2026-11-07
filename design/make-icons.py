# Regenerates frontend/icons from design/tasks-logo.png (1254×1254, the tile on transparency): python3 design/make-icons.py
# "any" icons and favicons keep the tile with its glow; maskable and Apple icons put the mark, feathered, on the
# tile's interior colour so it fills the shape and stays inside the safe zone.
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "icons"
BG = (13, 23, 26, 255)
src = Image.open(ROOT / "design" / "tasks-logo.png").convert("RGBA")

tile = src.crop((626 - 501, 625 - 501, 626 + 501, 625 + 501))
for name, size in [("icon-512.png", 512), ("icon-192.png", 192), ("favicon-48.png", 48), ("favicon-32.png", 32)]:
    tile.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)

content = src.crop((280, 290, 975, 945))  # the M with the checklist and its glow
mask = Image.new("L", content.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((30, 30, content.size[0] - 30, content.size[1] - 30), 60, fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(18))

def full_bleed(size, share):
    canvas = Image.new("RGBA", (size, size), BG)
    w = round(size * share)
    h = round(w * content.size[1] / content.size[0])
    flat = Image.new("RGBA", (w, h), BG)
    flat.alpha_composite(content.resize((w, h), Image.LANCZOS))
    canvas.paste(flat, ((size - w) // 2, (size - h) // 2), mask.resize((w, h), Image.LANCZOS))
    return canvas.convert("RGB")

full_bleed(512, 0.60).save(OUT / "icon-maskable-512.png", optimize=True)
full_bleed(180, 0.70).save(OUT / "apple-touch-icon.png", optimize=True)
