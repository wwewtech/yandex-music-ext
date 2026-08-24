"""
Asset Generation Script for Yandex Music Downloader
Renders vector-perfect icons and modern GitHub banner adhering to Fluent Design & Anti-AI-Slop standards.
"""

import os
import math
from PIL import Image, ImageDraw, ImageFilter, ImageFont

def ensure_dir(path):
    if not os.path.exists(path):
        os.makedirs(path, exist_ok=True)

def generate_icon_master(size=1024):
    """
    Renders high-craft Fluent icon at size x size.
    Design:
    - Dark obsidian rounded squircle base (#111217) with refined 1.5px acrylic rim.
    - Vibrant amber/gold music bars and download arrow with crisp vector silhouette.
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Base Squircle
    m = int(size * 0.05)
    r = int(size * 0.22)
    
    # Outer subtle shadow
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.rounded_rectangle([m, m + int(size * 0.02), size - m, size - m + int(size * 0.02)], radius=r, fill=(0, 0, 0, 140))
    shadow = shadow.filter(ImageFilter.GaussianBlur(int(size * 0.04)))
    img.paste(shadow, (0, 0), shadow)

    # Base background (Dark Obsidian Slate)
    draw.rounded_rectangle([m, m, size - m, size - m], radius=r, fill=(18, 20, 26, 255), outline=(48, 52, 68, 255), width=int(size * 0.016))

    cx, cy = size / 2, size / 2

    # 2. Soundwave bars (Left & Right)
    gold_primary = (255, 204, 0, 255)      # Yandex Gold
    gold_secondary = (255, 160, 0, 230)    # Amber accent
    gold_tertiary = (255, 120, 0, 180)     # Deep orange

    bar_w = size * 0.048
    bar_r = bar_w / 2

    # Left bars & Right bars with harmonic heights
    bars = [
        (-0.33, 0.22, gold_tertiary),
        (-0.23, 0.44, gold_secondary),
        (-0.13, 0.62, gold_primary),
        (0.13, 0.62, gold_primary),
        (0.23, 0.44, gold_secondary),
        (0.33, 0.22, gold_tertiary),
    ]

    for x_factor, h_factor, color in bars:
        bx = cx + size * x_factor
        bh = size * h_factor
        by0 = cy - bh / 2
        by1 = cy + bh / 2
        draw.rounded_rectangle([bx - bar_w/2, by0, bx + bar_w/2, by1], radius=bar_r, fill=color)

    # 3. Center Hero: Fluent Download Arrow (Overlaying center)
    circle_r = size * 0.26
    draw.ellipse([cx - circle_r, cy - circle_r, cx + circle_r, cy + circle_r], 
                 fill=(22, 24, 32, 255), outline=(55, 60, 78, 255), width=int(size * 0.014))

    # Arrow Stem
    stem_w = size * 0.10
    stem_top = cy - size * 0.17
    stem_bottom = cy + size * 0.03
    draw.rounded_rectangle([cx - stem_w/2, stem_top, cx + stem_w/2, stem_bottom], 
                           radius=stem_w/2, fill=gold_primary)

    # Arrow Head
    arrow_span = size * 0.17
    tip_y = cy + size * 0.15
    head_y = cy - size * 0.01

    head_points = [
        (cx, tip_y),
        (cx + arrow_span, head_y),
        (cx - arrow_span, head_y)
    ]
    draw.polygon(head_points, fill=gold_primary)

    # Tray base bar
    tray_w = size * 0.32
    tray_h = size * 0.045
    tray_y = cy + size * 0.18
    draw.rounded_rectangle([cx - tray_w/2, tray_y, cx + tray_w/2, tray_y + tray_h],
                           radius=tray_h/2, fill=(255, 225, 90, 255))

    return img

def render_icons():
    ensure_dir("icons")
    master = generate_icon_master(1024)
    
    master.resize((512, 512), Image.Resampling.LANCZOS).save("icons/icon512.png", "PNG")
    master.resize((128, 128), Image.Resampling.LANCZOS).save("icons/icon128.png", "PNG")
    master.resize((48, 48), Image.Resampling.LANCZOS).save("icons/icon48.png", "PNG")
    master.resize((32, 32), Image.Resampling.LANCZOS).save("icons/icon32.png", "PNG")
    master.resize((16, 16), Image.Resampling.LANCZOS).save("icons/icon16.png", "PNG")
    print("[OK] Generated icons: 16, 32, 48, 128, 512 px")

    svg_content = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#191a24" />
      <stop offset="100%" stop-color="#0e0f15" />
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffe066" />
      <stop offset="100%" stop-color="#ff9f00" />
    </linearGradient>
  </defs>
  
  <!-- Base Squircle -->
  <rect x="7" y="7" width="114" height="114" rx="26" fill="url(#bgGrad)" stroke="#323648" stroke-width="2" />
  
  <!-- Sound Wave Bars -->
  <rect x="20" y="52" width="5" height="24" rx="2.5" fill="#ff7700" opacity="0.8" />
  <rect x="31" y="40" width="5" height="48" rx="2.5" fill="#ffaa00" opacity="0.9" />
  <rect x="42" y="28" width="5" height="72" rx="2.5" fill="#ffcc00" />
  
  <rect x="81" y="28" width="5" height="72" rx="2.5" fill="#ffcc00" />
  <rect x="92" y="40" width="5" height="48" rx="2.5" fill="#ffaa00" opacity="0.9" />
  <rect x="103" y="52" width="5" height="24" rx="2.5" fill="#ff7700" opacity="0.8" />
  
  <!-- Center Plate -->
  <circle cx="64" cy="64" r="35" fill="#181a23" stroke="#3b4055" stroke-width="1.5" />
  
  <!-- Arrow -->
  <rect x="58" y="40" width="12" height="28" rx="6" fill="url(#goldGrad)" />
  <path d="M64 85 L42 63 L86 63 Z" fill="url(#goldGrad)" />
  <rect x="42" y="89" width="44" height="6" rx="3" fill="#ffe066" />
</svg>
"""
    with open("icons/icon.svg", "w", encoding="utf-8") as f:
        f.write(svg_content)
    print("[OK] Generated icons/icon.svg")

def generate_banner(width=1280, height=640):
    ensure_dir("assets")
    # Base dark canvas (Rich Obsidian)
    img = Image.new("RGBA", (width, height), (12, 13, 17, 255))
    draw = ImageDraw.Draw(img)

    # 1. Subtle tactile background grid
    grid_size = 40
    for x in range(0, width, grid_size):
        draw.line([(x, 0), (x, height)], fill=(22, 24, 32, 255), width=1)
    for y in range(0, height, grid_size):
        draw.line([(0, y), (width, y)], fill=(22, 24, 32, 255), width=1)

    # Fonts
    try:
        font_title = ImageFont.truetype("segoeuib.ttf", 44)
        font_subtitle = ImageFont.truetype("segoeui.ttf", 18)
        font_card_title = ImageFont.truetype("segoeuib.ttf", 18)
        font_card_body = ImageFont.truetype("segoeui.ttf", 14)
        font_mono = ImageFont.truetype("consola.ttf", 12)
        font_badge = ImageFont.truetype("segoeuib.ttf", 12)
    except:
        font_title = ImageFont.load_default()
        font_subtitle = ImageFont.load_default()
        font_card_title = ImageFont.load_default()
        font_card_body = ImageFont.load_default()
        font_mono = ImageFont.load_default()
        font_badge = ImageFont.load_default()

    # 2. Master Icon in Header
    icon_img = generate_icon_master(240).resize((100, 100), Image.Resampling.LANCZOS)
    img.paste(icon_img, (80, 60), icon_img)

    # 3. Top Tag
    tag_x, tag_y = 200, 60
    draw.rounded_rectangle([tag_x, tag_y, tag_x + 180, tag_y + 24], radius=12, 
                           fill=(26, 28, 38, 255), outline=(52, 56, 74, 255), width=1)
    draw.text((tag_x + 12, tag_y + 5), "MANIFEST V3 EXTENSION", fill=(255, 204, 0, 255), font=font_badge)

    # 4. Title & Subtitle
    draw.text((200, 92), "Yandex Music Downloader", fill=(255, 255, 255, 255), font=font_title)
    draw.text((200, 146), "High-Quality MP3 (320 kbps) • ID3v2.3 Tags • In-Player Controls • 1-Click Save", 
              fill=(155, 160, 180, 255), font=font_subtitle)

    # 5. Top Telemetry Chips (Right Side)
    chips = [
        ("BITRATE", "320 KBPS HQ"),
        ("METADATA", "ID3v2.3 + APIC"),
        ("UI ENGINE", "FLUENT MICA"),
        ("SPEED", "INSTANT 1-CLICK"),
    ]
    cx = width - 80 - 140
    cy = 60
    for label, val in reversed(chips):
        draw.rounded_rectangle([cx, cy, cx + 130, cy + 42], radius=6, 
                               fill=(18, 20, 26, 255), outline=(36, 40, 52, 255), width=1)
        draw.text((cx + 10, cy + 6), label, fill=(100, 105, 122, 255), font=font_mono)
        draw.text((cx + 10, cy + 22), val, fill=(255, 204, 0, 255), font=font_mono)
        cx -= 142

    # 6. Hairline Divider
    draw.line([(80, 185), (width - 80, 185)], fill=(32, 35, 46, 255), width=1)

    # 7. Three High-Craft Feature Cards
    card_w = (width - 160 - 40) // 3
    card_y = 210
    card_h = 360

    cards_data = [
        {
            "num": "01",
            "tag": "STREAM PIPELINE",
            "title": "Direct HQ Audio Stream",
            "points": [
                "• Native MP3 extraction at 320 kbps",
                "• MD5 handshake with storage cluster",
                "• Zero quality loss & zero re-encoding",
                "• Memory-safe chunked streaming"
            ],
            "accent": (255, 204, 0, 255)
        },
        {
            "num": "02",
            "tag": "TAGGING ENGINE",
            "title": "ID3v2.3 & 400x400 Cover",
            "points": [
                "• Full Title, Artist, Album, and Year",
                "• Embedded binary APIC picture frame",
                "• Clean album art in car & mobile players",
                "• Filename sanitization for all OSes"
            ],
            "accent": (16, 185, 129, 255)
        },
        {
            "num": "03",
            "tag": "TACTILE UX",
            "title": "Native Fluent Integration",
            "points": [
                "• In-player button with 8-state feedback",
                "• Tracklist inline buttons & batch helper",
                "• Non-blocking Windows 11 InfoBar toasts",
                "• Acrylic popup with live playback detector"
            ],
            "accent": (59, 130, 246, 255)
        }
    ]

    for i, c in enumerate(cards_data):
        bx = 80 + i * (card_w + 20)
        # Card backdrop
        draw.rounded_rectangle([bx, card_y, bx + card_w, card_y + card_h], radius=10,
                               fill=(18, 20, 26, 255), outline=(36, 40, 52, 255), width=1)
        
        # Pill Number
        draw.rounded_rectangle([bx + 16, card_y + 16, bx + 52, card_y + 38], radius=5,
                               fill=(26, 29, 38, 255), outline=(46, 51, 66, 255), width=1)
        draw.text((bx + 24, card_y + 20), c["num"], fill=c["accent"], font=font_mono)

        draw.text((bx + 62, card_y + 22), c["tag"], fill=(115, 122, 140, 255), font=font_mono)
        draw.text((bx + 16, card_y + 54), c["title"], fill=(255, 255, 255, 255), font=font_card_title)
        
        draw.line([(bx + 16, card_y + 86), (bx + card_w - 16, card_y + 86)], fill=(30, 33, 44, 255), width=1)

        py = card_y + 104
        for pt in c["points"]:
            draw.text((bx + 16, py), pt, fill=(170, 175, 192, 255), font=font_card_body)
            py += 40

        # Footer badge
        draw.rounded_rectangle([bx + 16, card_y + card_h - 42, bx + card_w - 16, card_y + card_h - 16], radius=6,
                               fill=(14, 15, 20, 255), outline=(28, 31, 40, 255), width=1)
        draw.text((bx + 24, card_y + card_h - 35), "READY • PRODUCTION TESTED", fill=(60, 190, 110, 255), font=font_mono)

    # 8. Bottom Footer
    draw.line([(80, height - 38), (width - 80, height - 38)], fill=(28, 31, 40, 255), width=1)
    draw.text((80, height - 28), "WWTECH • OPEN SOURCE • MIT LICENSE", fill=(95, 100, 115, 255), font=font_mono)
    draw.text((width - 330, height - 28), "CHROME • EDGE • BRAVE • YANDEX", fill=(95, 100, 115, 255), font=font_mono)

    img.save("assets/banner.png", "PNG")
    print("[OK] Generated assets/banner.png (1280x640)")

if __name__ == "__main__":
    render_icons()
    generate_banner()
    print("[OK] All assets generated successfully!")
