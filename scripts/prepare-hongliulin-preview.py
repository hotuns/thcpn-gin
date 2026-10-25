"""Build the same bounded XYZ mosaic used by digital-plot-imagery.ts (Pillow)."""
import concurrent.futures
import io
from pathlib import Path
import urllib.request

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
X, Y, Z, COLUMNS, ROWS = 199854, 101083, 18, 5, 4
URL = "https://tiles-map.oss-cn-beijing.aliyuncs.com/%E9%9D%92%E6%B5%B7/%E7%BA%A2%E6%9F%B3%E6%9E%97/{z}/{x}/{y}.png"


def fetch_tile(index):
    column, row = index % COLUMNS, index // COLUMNS
    with urllib.request.urlopen(URL.format(z=Z, x=X + column, y=Y + row), timeout=20) as response:
        image = Image.open(io.BytesIO(response.read())).convert("RGBA")
    if image.size != (256, 256) or image.getchannel("A").getextrema() != (255, 255):
        raise ValueError(f"Preview window includes an incomplete tile: {column}, {row}")
    return column, row, image


if __name__ == "__main__":
    mosaic = Image.new("RGB", (COLUMNS * 256, ROWS * 256))
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        for column, row, image in executor.map(fetch_tile, range(COLUMNS * ROWS)):
            mosaic.paste(image, (column * 256, row * 256))
    target = ROOT / "app/apps/platform/public/digital-plot/hongliulin-preview.jpg"
    mosaic.save(target, quality=90, optimize=True)
    print(f"Saved {target.name}: {mosaic.width} × {mosaic.height}, {target.stat().st_size} bytes")
