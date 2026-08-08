#!/usr/bin/env python3
"""生成 1200×630 品牌分享图 frontend/public/share-card.png（OG/Twitter 卡片用）。

用法：python scripts/gen_share_card.py
依赖：Pillow + Noto Sans CJK（/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc）。
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
OUT = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "share-card.png")


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def main():
    img = Image.new("RGB", (W, H))
    top, bottom = (29, 78, 216), (23, 37, 84)  # #1d4ed8 -> #172554
    px = img.load()
    for y in range(H):
        c = lerp(top, bottom, y / H)
        for x in range(W):
            px[x, y] = c
    d = ImageDraw.Draw(img, "RGBA")

    # 雷达图案（右侧，半透明同心圆 + 扫描扇形 + 光点）
    cx, cy, rmax = 950, 315, 240
    for r in (80, 140, 200, 240):
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(255, 255, 255, 46), width=3)
    d.line((cx - rmax, cy, cx + rmax, cy), fill=(255, 255, 255, 36), width=2)
    d.line((cx, cy - rmax, cx, cy + rmax), fill=(255, 255, 255, 36), width=2)
    d.pieslice((cx - rmax, cy - rmax, cx + rmax, cy + rmax), -90, -20,
               fill=(96, 165, 250, 60))
    a = math.radians(-20)
    d.line((cx, cy, cx + rmax * math.cos(a), cy + rmax * math.sin(a)),
           fill=(147, 197, 253, 180), width=4)
    for ang, rr in ((-60, 170), (-35, 110), (15, 205), (140, 150), (200, 95)):
        t = math.radians(ang)
        x, y = cx + rr * math.cos(t), cy + rr * math.sin(t)
        d.ellipse((x - 7, y - 7, x + 7, y + 7), fill=(255, 255, 255, 220))

    brand = ImageFont.truetype(FONT, 118)
    tagline = ImageFont.truetype(FONT, 40)
    small = ImageFont.truetype(FONT, 34)
    d.text((90, 180), "上岸雷达", font=brand, fill=(255, 255, 255))
    d.text((94, 330), "全国公务员 · 事业单位 · 校招岗位库", font=tagline,
           fill=(219, 234, 254))
    d.rounded_rectangle((94, 430, 470, 492), radius=14, fill=(255, 255, 255, 28))
    d.text((116, 438), "jobs.zalize.com", font=small, fill=(255, 255, 255))
    d.text((94, 540), "每日更新 · 一键筛选 · 截止提醒", font=small, fill=(147, 197, 253))

    img.save(OUT, optimize=True)
    print(f"written: {os.path.abspath(OUT)} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()
