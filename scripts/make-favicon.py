from PIL import Image
from pathlib import Path

pub = Path(__file__).resolve().parents[1] / "public"
src_path = pub / "enertech-mark.png"
if not src_path.exists():
    raise SystemExit(f"Missing source logo: {src_path}")

src = Image.open(src_path).convert("RGBA")

# Keep white background (no transparency)
bbox = src.getbbox()
if bbox:
    # Prefer content bounds ignoring pure-white margins only lightly
    pixels = src.load()
    w, h = src.size
    min_x, min_y, max_x, max_y = w, h, 0, 0
    found = False
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a > 0 and not (r > 245 and g > 245 and b > 245):
                found = True
                if x < min_x:
                    min_x = x
                if y < min_y:
                    min_y = y
                if x > max_x:
                    max_x = x
                if y > max_y:
                    max_y = y
    if found:
        pad = 8
        src = src.crop(
            (
                max(0, min_x - pad),
                max(0, min_y - pad),
                min(w, max_x + 1 + pad),
                min(h, max_y + 1 + pad),
            )
        )

side = max(src.size)
canvas = Image.new("RGBA", (side, side), (255, 255, 255, 255))
ox = (side - src.size[0]) // 2
oy = (side - src.size[1]) // 2
# Composite onto white so any alpha becomes white
canvas.paste(src, (ox, oy), src if src.mode == "RGBA" else None)
canvas = canvas.convert("RGB")


def export(size: int, path: Path, inset_ratio: float = 0.08) -> Image.Image:
    inset = max(1, int(size * inset_ratio))
    inner = size - inset * 2
    resized = canvas.resize((inner, inner), Image.Resampling.LANCZOS)
    out = Image.new("RGB", (size, size), (255, 255, 255))
    out.paste(resized, (inset, inset))
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
