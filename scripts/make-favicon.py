from PIL import Image
from pathlib import Path

pub = Path(__file__).resolve().parents[1] / "public"
src_path = pub / "enertech-mark.png"
if not src_path.exists():
    raise SystemExit(f"Missing source logo: {src_path}")

src = Image.open(src_path).convert("RGBA")

pixels = src.load()
w, h = src.size
for y in range(h):
    for x in range(w):
        r, g, b, a = pixels[x, y]
        if r > 245 and g > 245 and b > 245:
            pixels[x, y] = (r, g, b, 0)

bbox = src.getbbox()
if bbox:
    src = src.crop(bbox)

side = max(src.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
ox = (side - src.size[0]) // 2
oy = (side - src.size[1]) // 2
canvas.paste(src, (ox, oy), src)


def export(size: int, path: Path, inset_ratio: float = 0.08) -> Image.Image:
    inset = max(1, int(size * inset_ratio))
    inner = size - inset * 2
    resized = canvas.resize((inner, inner), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(resized, (inset, inset), resized)
    out.save(path, optimize=True)
    print("wrote", path.name, out.size)
    return out


frames = [
    export(16, pub / "favicon-16.png", 0.06),
    export(32, pub / "favicon-32.png", 0.06),
    export(48, pub / "favicon.png", 0.08),
]
export(180, pub / "apple-touch-icon.png", 0.08)
export(192, pub / "favicon-192.png", 0.08)
export(512, pub / "favicon-512.png", 0.08)

frames[0].save(
    pub / "favicon.ico",
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48)],
    append_images=frames[1:],
)
print("wrote favicon.ico")
