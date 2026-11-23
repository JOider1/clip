"""Генерує іконку застосунку ClipForge (build/icon.png + build/icon.ico).

Запуск: python scripts/make-icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"

ACCENT_TOP = (214, 255, 105, 255)
ACCENT_BOTTOM = (170, 232, 32, 255)
INK = (14, 17, 10, 255)

# Точки блискавки з SVG (viewBox 0 0 24 24)
BOLT = [
    (6.5, 8.2),
    (18.0, 3.5),
    (12.8, 12.0),
    (18.0, 12.0),
    (6.5, 20.0),
    (11.3, 11.8),
    (6.5, 11.8),
]


def make_master() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    # Вертикальний градієнт лаймової плитки
    grad = Image.new("RGBA", (1, SIZE))
    for y in range(SIZE):
        t = y / (SIZE - 1)
        grad.putpixel(
            (0, y),
            tuple(int(ACCENT_TOP[i] + (ACCENT_BOTTOM[i] - ACCENT_TOP[i]) * t) for i in range(4)),
        )
    grad = grad.resize((SIZE, SIZE))

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=int(SIZE * 0.22), fill=255)
    img.paste(grad, (0, 0), mask)

    # Легкий внутрішній контур, щоб плитка читалась на світлому тлі
    ring = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(ring).rounded_rectangle(
        (3, 3, SIZE - 4, SIZE - 4), radius=int(SIZE * 0.215), outline=(80, 110, 20, 60), width=6
    )
    img.alpha_composite(ring)

    # Блискавка
    scale = SIZE * 0.62 / 24
    offset = (SIZE - 24 * scale) / 2
    pts = [(offset + x * scale, offset + y * scale) for x, y in BOLT]

    bolt_mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(bolt_mask).polygon(pts, fill=255)

    bolt = Image.new("RGBA", (SIZE, SIZE), INK)
    img.paste(bolt, (0, 0), bolt_mask)
    return img


def main() -> None:
    BUILD.mkdir(exist_ok=True)
    master = make_master()
    master.resize((512, 512), Image.LANCZOS).save(BUILD / "icon.png")
    master.save(
        BUILD / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"OK: {BUILD / 'icon.ico'}")


if __name__ == "__main__":
    main()
