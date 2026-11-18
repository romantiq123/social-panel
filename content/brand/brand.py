"""invite / shaqyru — брендовый рендерер слайдов 1080x1350 для Instagram.
Палитра под профиль @invite.helpify: глубокий зелёный + кремовый + золото.
Шрифты: Playfair Display (заголовки, курсив-акцент), Inter (текст)."""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1080, 1350
FD = '/home/claude/fonts/'
FI = '/usr/share/fonts/opentype/inter/'

# палитра
GREEN_D = (13, 52, 32)      # #0D3420
GREEN = (24, 84, 50)        # #185432
GREEN_A = (46, 125, 79)     # #2E7D4F акцент на светлом
MINT = (205, 239, 211)      # #CDEFD3 (как лого)
CREAM = (247, 243, 234)     # #F7F3EA
CREAM_2 = (239, 232, 218)
INK = (23, 45, 33)          # #172D21
BODY = (74, 90, 79)         # #4A5A4F
GOLD = (201, 164, 92)       # #C9A45C
GOLD_L = (222, 196, 140)
RED = (176, 82, 63)         # #B0523F

_cache = {}
def pf(size, w=700, italic=False):
    k = ('pf', size, w, italic)
    if k not in _cache:
        f = ImageFont.truetype(FD + ('PlayfairDisplay-Italic.ttf' if italic else 'PlayfairDisplay.ttf'), size)
        f.set_variation_by_axes([w]); _cache[k] = f
    return _cache[k]

def it(size, w='Medium'):
    k = ('in', size, w)
    if k not in _cache: _cache[k] = ImageFont.truetype(FI + f'Inter-{w}.otf', size)
    return _cache[k]


def wrap(d, text, f, maxw):
    out = []
    for para in text.split('\n'):
        cur = ''
        for w in para.split(' '):
            t = (cur + ' ' + w).strip()
            if d.textlength(t, font=f) <= maxw or not cur: cur = t
            else: out.append(cur); cur = w
        out.append(cur)
    return out


def text(d, xy, s, f, fill, maxw=880, lh=1.25, align='left', tracking=0):
    x, y = xy
    for ln in wrap(d, s, f, maxw):
        if tracking:
            tw = sum(d.textlength(c, font=f) + tracking for c in ln) - tracking
            cx = x + (maxw - tw) / 2 if align == 'center' else x
            for c in ln:
                d.text((cx, y), c, font=f, fill=fill); cx += d.textlength(c, font=f) + tracking
        else:
            tw = d.textlength(ln, font=f)
            cx = x + (maxw - tw) / 2 if align == 'center' else x
            d.text((cx, y), ln, font=f, fill=fill)
        y += f.size * lh
    return y


def rich(d, xy, parts, maxw=880, lh=1.18, align='left'):
    """заголовок из кусков [(текст, font, цвет)] с переносом по словам"""
    words = []
    for s, f, c in parts:
        for i, w in enumerate(s.split(' ')):
            if w == '\n': words.append(('\n', f, c)); continue
            words.append((w, f, c))
    lines, cur, curw = [], [], 0
    for w, f, c in words:
        if w == '\n': lines.append(cur); cur, curw = [], 0; continue
        sw = d.textlength(' ', font=f) if cur else 0
        ww = d.textlength(w, font=f)
        if cur and curw + sw + ww > maxw:
            lines.append(cur); cur, curw, sw = [], 0, 0
        cur.append((w, f, c, sw)); curw += sw + ww
    if cur: lines.append(cur)
    x0, y = xy
    for ln in lines:
        lw = sum(sw + d.textlength(w, font=f) for w, f, c, sw in ln)
        x = x0 + (maxw - lw) / 2 if align == 'center' else x0
        size = max(f.size for _, f, _, _ in ln)
        for w, f, c, sw in ln:
            x += sw
            d.text((x, y + (size - f.size) * 0.8), w, font=f, fill=c)
            x += d.textlength(w, font=f)
        y += size * lh
    return y


def bg_dark():
    img = Image.new('RGB', (W, H), GREEN_D)
    # мягкое свечение
    glow = Image.new('RGB', (W, H), GREEN_D)
    g = ImageDraw.Draw(glow)
    g.ellipse((-200, -300, W + 300, 900), fill=GREEN)
    glow = glow.filter(ImageFilter.GaussianBlur(220))
    img = Image.blend(img, glow, 0.9)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((44, 44, W - 44, H - 44), radius=28, outline=GOLD + (0,), width=2)
    return img


def bg_light():
    img = Image.new('RGB', (W, H), CREAM)
    d = ImageDraw.Draw(img)
    d.rectangle((0, H - 150, W, H), fill=CREAM_2)
    return img


def ornament(d, cx, y, color, w=160):
    d.line((cx - w, y, cx - 16, y), fill=color, width=2)
    d.line((cx + 16, y, cx + w, y), fill=color, width=2)
    d.polygon([(cx, y - 9), (cx + 9, y), (cx, y + 9), (cx - 9, y)], fill=color)


def logo(d, x, y, dark):
    r = 26
    d.ellipse((x, y, x + 2 * r, y + 2 * r), fill=MINT if dark else GREEN)
    f = it(26, 'Bold')
    t = 'in'; tw = d.textlength(t, font=f)
    d.text((x + r - tw / 2, y + r - 17), t, font=f, fill=GREEN_D if dark else CREAM)
    d.text((x + 2 * r + 14, y + 6), 'invite', font=pf(36, 700, True), fill=CREAM if dark else INK)


def chrome(img, n, total, dark, label):
    d = ImageDraw.Draw(img)
    logo(d, 96, 92, dark)
    lab_f = it(24, 'SemiBold')
    lw = sum(d.textlength(c, font=lab_f) + 4 for c in label) - 4
    text(d, (W - 96 - lw, 104), label, lab_f, GOLD if dark else GREEN_A, maxw=lw + 2, tracking=4)
    # низ
    fy = H - 112
    d.text((96, fy), 'shaqyru.helpify.kz', font=it(28, 'Medium'), fill=GOLD_L if dark else BODY)
    # точки прогресса
    dot_w, gap = 12, 10
    x = W - 96 - total * dot_w - (total - 1) * gap - 18
    for i in range(1, total + 1):
        c = (GOLD if dark else GREEN) if i == n else ((60, 100, 75) if dark else (205, 198, 182))
        if i == n:
            d.rounded_rectangle((x, fy + 10, x + dot_w + 18, fy + 10 + dot_w), radius=6, fill=c); x += 18
        else:
            d.ellipse((x, fy + 10, x + dot_w, fy + 10 + dot_w), fill=c)
        x += dot_w + gap
    return d


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, quality=94)
