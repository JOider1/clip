from PIL import Image, ImageOps, ImageEnhance

bg = Image.open(r"C:\Users\stasb\Downloads\Нова папка\Artwork_Featured.png").convert("RGBA")
rei = Image.open(r"C:\Users\stasb\Downloads\Нова папка\16f51ba3-9d98-4913-b2b5-c93f12d90c27.png").convert("RGBA")

# Scale Rei up so it blends nicely (background is 630x824)
rei_size = 260
rei = rei.resize((rei_size, rei_size), Image.LANCZOS)
rei = ImageEnhance.Brightness(rei).enhance(0.72)   # darker to match the gloomy bg
rei = ImageEnhance.Color(rei).enhance(1.0)

w = h = rei_size
# Alpha mask: opaque in the center/bottom, faded generously on top and left edges
mask = Image.new("L", (w, h), 255)
px = mask.load()
fade = 130  # wide soft fade
for y in range(h):
    for x in range(w):
        a = 255
        if x < fade:
            a = min(a, int(255 * (x / fade) ** 1.5))
        if y < fade:
            a = min(a, int(255 * (y / fade) ** 1.5))
        if y > h - 25:  # slight fade at very bottom
            a = min(a, int(255 * (h - y) / 25 + 60))
        px[x, y] = max(0, min(255, a))

# Position: bottom-right corner, partially over the dark railing
pos_x = bg.width - w + 30
pos_y = bg.height - h - 15

rei.putalpha(mask)
bg.alpha_composite(rei, (pos_x, pos_y))
bg.convert("RGB").save(r"C:\Users\stasb\OneDrive\Документи\Типовий проєкт\steam_banner.png", "PNG")
print("done")
