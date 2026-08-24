"""
Ultra-Clean Vector Icon & Asset Generator
Designed with hyper-minimalism & genuine human craft.
"""

import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

def ensure_dir(path):
    if not os.path.exists(path):
        os.makedirs(path, exist_ok=True)

def generate_minimal_icon(size=1024):
    """
    World-class minimalist vector mark.
    Design:
    - Pure dark obsidian squircle (#121316) with subtle 1px border (#22242b).
    - Center download arrow in crisp pure white (#ffffff).
    - Flanking harmonic acoustic wave bars in signature Yandex gold (#ffcc00).
    - Balanced negative space, zero visual clutter.
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = int(size * 0.05)
    radius = int(size * 0.24)
    
    # 1. Base Squircle
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=radius,
        fill=(18, 19, 23, 255),
        outline=(38, 41, 50, 255),
        width=max(1, int(size * 0.015))
    )

    cx, cy = size / 2, size / 2

    # 2. Soundwave bars flanking the center
    gold = (255, 204, 0, 255)
    dim_gold = (255, 204, 0, 160)
    
    bar_w = size * 0.045
    bar_r = bar_w / 2

    # Left & Right bars: x offset from center, height, color
    bars = [
        (-0.35, 0.22, dim_gold),
        (-0.25, 0.44, gold),
        (0.25, 0.44, gold),
        (0.35, 0.22, dim_gold),
    ]

    for x_factor, h_factor, col in bars:
        bx = cx + size * x_factor
        bh = size * h_factor
        draw.rounded_rectangle(
            [bx - bar_w/2, cy - bh/2, bx + bar_w/2, cy + bh/2],
            radius=bar_r,
            fill=col
        )

    # 3. Center Arrow (Crisp, generous breathing room)
    stem_w = size * 0.10
    stem_top = cy - size * 0.24
    stem_bottom = cy + size * 0.02
    draw.rounded_rectangle(
        [cx - stem_w/2, stem_top, cx + stem_w/2, stem_bottom],
        radius=stem_w/2,
        fill=(255, 255, 255, 255)
    )

    # Arrow Head
    head_span = size * 0.15
    tip_y = cy + size * 0.15
    head_y = cy - size * 0.01
    head_pts = [
        (cx, tip_y),
        (cx + head_span, head_y),
        (cx - head_span, head_y)
    ]
    draw.polygon(head_pts, fill=(255, 255, 255, 255))

    # Base tray bar
    tray_w = size * 0.28
    tray_h = size * 0.045
    tray_y = cy + size * 0.20
    draw.rounded_rectangle(
        [cx - tray_w/2, tray_y, cx + tray_w/2, tray_y + tray_h],
        radius=tray_h/2,
        fill=gold
    )

    return img

def render_all_assets():
    ensure_dir("icons")
    ensure_dir("assets")

    # Render master icon
    master = generate_minimal_icon(1024)

    for sz in [512, 128, 48, 32, 16]:
        master.resize((sz, sz), Image.Resampling.LANCZOS).save(f"icons/icon{sz}.png", "PNG")
    print("[OK] Rendered icons (16, 32, 48, 128, 512 px)")

    # SVG Icon
    svg_data = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect x="7" y="7" width="114" height="114" rx="28" fill="#121316" stroke="#262932" stroke-width="2"/>
  <!-- Flanking soundwave bars -->
  <rect x="20" y="49" width="5" height="30" rx="2.5" fill="#ffcc00" opacity="0.65"/>
  <rect x="32" y="35" width="5" height="58" rx="2.5" fill="#ffcc00"/>
  <rect x="91" y="35" width="5" height="58" rx="2.5" fill="#ffcc00"/>
  <rect x="103" y="49" width="5" height="30" rx="2.5" fill="#ffcc00" opacity="0.65"/>
  <!-- Center Arrow -->
  <rect x="58.5" y="33" width="11" height="34" rx="5.5" fill="#ffffff"/>
  <path d="M64 83 L46 63 L82 63 Z" fill="#ffffff"/>
  <rect x="46" y="89" width="36" height="5.5" rx="2.75" fill="#ffcc00"/>
</svg>"""
    with open("icons/icon.svg", "w", encoding="utf-8") as f:
        f.write(svg_data)
    print("[OK] Rendered icons/icon.svg")

    # Minimal Hero Banner (1280x360 - compact, clean, no AI card grid!)
    banner_w, banner_h = 1280, 360
    banner = Image.new("RGBA", (banner_w, banner_h), (18, 19, 24, 255))
    bdraw = ImageDraw.Draw(banner)

    # Hairline frame
    bdraw.rectangle([0, 0, banner_w - 1, banner_h - 1], outline=(35, 38, 48, 255), width=1)

    # Icon in center-left
    icon_render = generate_minimal_icon(300).resize((130, 130), Image.Resampling.LANCZOS)
    banner.paste(icon_render, (100, 115), icon_render)

    # Typography
    try:
        font_h1 = ImageFont.truetype("segoeuib.ttf", 42)
        font_sub = ImageFont.truetype("segoeui.ttf", 20)
        font_pill = ImageFont.truetype("segoeuib.ttf", 12)
        font_mono = ImageFont.truetype("consola.ttf", 13)
    except:
        font_h1 = ImageFont.load_default()
        font_sub = ImageFont.load_default()
        font_pill = ImageFont.load_default()
        font_mono = ImageFont.load_default()

    # Category Pill
    pill_x, pill_y = 260, 115
    bdraw.rounded_rectangle([pill_x, pill_y, pill_x + 150, pill_y + 24], radius=12,
                            fill=(28, 30, 38, 255), outline=(50, 54, 68, 255), width=1)
    bdraw.text((pill_x + 12, pill_y + 4), "CHROME EXTENSION", fill=(255, 204, 0, 255), font=font_pill)

    # Title & Subtitle
    bdraw.text((260, 148), "Yandex Music Downloader", fill=(255, 255, 255, 255), font=font_h1)
    bdraw.text((260, 204), "Скачивание треков в MP3 (320 kbps) с обложками и ID3v2 тегами", fill=(160, 165, 180, 255), font=font_sub)

    # Subtle feature pills below
    tags = ["320 kbps MP3", "ID3v2.3 Tags", "Album Cover Art", "In-Player Button", "Manifest V3"]
    tx = 260
    ty = 246
    for t in tags:
        bdraw.rounded_rectangle([tx, ty, tx + len(t) * 9 + 20, ty + 26], radius=6,
                                fill=(24, 26, 32, 255), outline=(40, 44, 55, 255), width=1)
        bdraw.text((tx + 10, ty + 5), t, fill=(200, 205, 220, 255), font=font_mono)
        tx += len(t) * 9 + 28

    banner.save("assets/banner.png", "PNG")
    print("[OK] Rendered clean assets/banner.png (1280x360)")

if __name__ == "__main__":
    render_all_assets()
