"""Generate favicons from public/enertech-mark.png on solid white square."""
from PIL import Image
from pathlib import Path

pub = Path(__file__).resolve().parents[1] / "public"
src_path = pub / "enertech-mark.png"
if not src_path.exists():
    raise SystemExit(f"Missing source logo: {src_path}")

src = Image.open(src_path).convert("RGBA")

# Place logo (circle or any shape) onto solid white square — as requested
side = max(src.size)
white = Image.new("RGBA", (side, side), (255, 255, 255, 255))
ox = (side - src.size[0]) // 2
oy = (side - src.size[1]) // 2
white.paste(src, (ox, oy), src)
master = white.convert("RGB")
master.save(pub / "enertech-mark.png", format="PNG", optimize=True)


def export(size: int, path: Path) -> Image.Image:
    out = master.resize((size, size), Image.Resampling.LANCZOS)
    out.save(path, format="PNG", optimize=True)
    print("wrote", path.name, out.size, path.stat().st_size, "bytes")
    return out


export(16, pub / "favicon-16.png")
export(32, pub / "favicon-32.png")
export(48, pub / "favicon.png")
export(180, pub / "apple-touch-icon.png")
export(192, pub / "favicon-192.png")
export(512, pub / "favicon-512.png")

ico_master = export(64, pub / "_favicon-master.png")
ico_master.save(
    pub / "favicon.ico",
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
)
(pub / "_favicon-master.png").unlink(missing_ok=True)
print("wrote favicon.ico", (pub / "favicon.ico").stat().st_size, "bytes")
