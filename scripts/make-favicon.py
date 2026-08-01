"""Generate favicons from public/enertech-mark.png — keep logo as-is on white."""
from PIL import Image
from pathlib import Path

pub = Path(__file__).resolve().parents[1] / "public"
src_path = pub / "enertech-mark.png"
if not src_path.exists():
    raise SystemExit(f"Missing source logo: {src_path}")

src = Image.open(src_path).convert("RGB")


def export(size: int, path: Path) -> Image.Image:
    out = Image.new("RGB", (size, size), (255, 255, 255))
    fitted = src.copy()
    fitted.thumbnail((size, size), Image.Resampling.LANCZOS)
    x = (size - fitted.size[0]) // 2
    y = (size - fitted.size[1]) // 2
    out.paste(fitted, (x, y))
    out.save(path, format="PNG", optimize=True)
    print("wrote", path.name, out.size, path.stat().st_size, "bytes")
    return out


export(16, pub / "favicon-16.png")
img32 = export(32, pub / "favicon-32.png")
export(48, pub / "favicon.png")
export(180, pub / "apple-touch-icon.png")
export(192, pub / "favicon-192.png")
export(512, pub / "favicon-512.png")

# Reliable ICO: write multi-resolution via Pillow sizes= from a larger master
master = export(64, pub / "_favicon-master.png")
master.save(
    pub / "favicon.ico",
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
)
(pub / "_favicon-master.png").unlink(missing_ok=True)
print("wrote favicon.ico", (pub / "favicon.ico").stat().st_size, "bytes")
