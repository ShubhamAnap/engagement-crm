from PIL import Image
from pathlib import Path

pub = Path(r"c:\Users\User\Desktop\New folder\enertechsupport\public")
src_path = Path(
    r"C:\Users\User\AppData\Roaming\Cursor\User\workspaceStorage\a9f48b68e2e0d80efa792c589006d10a\images\Gemini_Generated_Image_pqc9slpqc9slpqc9-c1d4afdb-70a0-4a62-b6bb-39a9fa07306d.png"
)

src = Image.open(src_path).convert("RGBA")
src.save(pub / "enertech-mark.png", optimize=True)

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
