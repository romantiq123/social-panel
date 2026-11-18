import sys
sys.path.insert(0, '/home/claude/carousel')
from brand import *

OUT = '/home/claude/carousel/out3'
TOP, BOT = 200, H - 170

def centered(make_bg, n, total, dark, label, body, path):
    probe = ImageDraw.Draw(Image.new('RGB', (W, H)))
    h = body(probe, 0)
    img = make_bg(); d = chrome(img, n, total, dark, label)
    body(d, TOP + (BOT - TOP - h) / 2)
    save(img, path)

def box(d, y, label, s, fill, lc, weight):
    f = it(40, weight)
    lines = len(wrap(d, s, f, 800))
    hgt = 74 + lines * 52 + 34
    d.rounded_rectangle((96, y, W - 96, y + hgt), radius=24, fill=fill)
    d.text((132, y + 30), label, font=it(24, 'Bold'), fill=lc)
    text(d, (132, y + 74), s, f, INK, maxw=800, lh=1.3)
    return y + hgt



def cover(parts, sub, cta, n, total, label, path):
    def body(d, y):
        ornament(d, W // 2, y + 10, GOLD); y += 70
        y = rich(d, (100, y), parts, maxw=880, align='center', lh=1.12) + 30
        y = text(d, (150, y), sub, it(40, 'Regular'), (214, 226, 216), maxw=780, align='center', lh=1.4) + 60
        f = it(34, 'SemiBold'); tw = d.textlength(cta, font=f); x = (W - tw) / 2
        d.rounded_rectangle((x - 40, y, x + tw + 40, y + 84), radius=42, fill=CREAM)
        d.text((x, y + 21), cta, font=f, fill=GREEN_D)
        return y + 84
    centered(bg_dark, n, total, True, label, body, path)


def mistake(num, title, bad, good, n, total, path):
    def body(d, y):
        d.text((90, y - 40), num, font=pf(230, 500, True), fill=GOLD); y += 250
        y = rich(d, (96, y), [(title, pf(76, 700), INK)], maxw=880) + 40
        y = box(d, y, 'ТАК НЕ НАДО', bad, (246, 230, 222), RED, 'Medium') + 28
        return box(d, y, 'ЛУЧШЕ ТАК', good, (224, 238, 226), GREEN_A, 'SemiBold')
    centered(bg_light, n, total, False, 'ОШИБКА ' + num, body, path)


def template(event, txt, n, total, path):
    def body(d, y):
        y = rich(d, (96, y), [(event, pf(92, 700), INK)], maxw=888)
        d.line((96, y + 34, 260, y + 34), fill=GOLD, width=3); y += 100
        d.text((78, y - 50), '«', font=pf(180, 600), fill=(226, 214, 186))
        y = text(d, (130, y + 10), txt, pf(44, 500), INK, maxw=850, lh=1.45) + 40
        d.text((130, y), 'Той иелері: [есімдер]', font=it(34, 'SemiBold'), fill=GREEN_A)
        return y + 40
    centered(bg_light, n, total, False, 'ДАЙЫН ҮЛГІ', body, path)


def cta(parts, bullets, button, n, total, label, path):
    def body(d, y):
        y = rich(d, (100, y), parts, maxw=880, align='center', lh=1.12) + 50
        for b in bullets:
            d.ellipse((170, y + 6, 214, y + 50), fill=GOLD)
            d.line((181, y + 28, 190, y + 37), fill=GREEN_D, width=5)
            d.line((190, y + 37, 204, y + 19), fill=GREEN_D, width=5)
            y = text(d, (240, y + 2), b, it(40, 'Medium'), CREAM, maxw=680, lh=1.3) + 26
        y += 30
        f = it(34, 'SemiBold'); tw = d.textlength(button, font=f); x = (W - tw) / 2
        d.rounded_rectangle((x - 44, y, x + tw + 44, y + 88), radius=44, fill=GOLD)
        d.text((x, y + 23), button, font=f, fill=GREEN_D)
        return y + 88
    centered(bg_dark, n, total, True, label, body, path)


# ---------- карусель 1: 5 ошибок (RU) ----------
T = 7; P = OUT + '/oshibki/slide{}.jpg'; L = 'ПРИГЛАШЕНИЯ'
cover([('5 ошибок', pf(120, 800), CREAM), ('\n', pf(10), CREAM), ('в приглашении', pf(96, 500, True), GOLD_L)],
      'из-за которых гости звонят вам прямо в день тоя', 'Проверьте свой текст  →', 1, T, L, P.format(1))
mistake('01', 'Время «вечером»', '«Начало вечером»', '«Сбор гостей в 18:00, начало в 18:30»', 2, T, P.format(2))
mistake('02', 'Ресторан без адреса', '«Ресторан Айсулу»', 'Название + адрес + метка в 2ГИС', 3, T, P.format(3))
mistake('03', 'Дата без дня недели', '«21 декабря»', '«21 декабря, суббота»', 4, T, P.format(4))
mistake('04', 'Нет контакта', 'Гость не знает, кому звонить', 'Номер той иесі или того, кто отвечает за гостей', 5, T, P.format(5))
mistake('05', 'Не просите ответа', 'Сколько придёт — сюрприз', '«Подтвердите, пожалуйста, до 10 декабря»', 6, T, P.format(6))
cta([('В шақыру всё это', pf(78, 700), CREAM), ('\n', pf(10), CREAM), ('уже есть', pf(78, 500, True), GOLD_L)],
    ['Точное время и карта до зала', 'Кнопка «приду / не приду»', 'Список гостей для рассадки', 'Готово в тот же день'],
    'Ссылка в профиле', 7, T, L, P.format(7))

# ---------- карусель 2: шақыру мәтіні (KZ) ----------
T = 6; P = OUT + '/matin/slide{}.jpg'; L = 'ШАҚЫРУ'
cover([('Шақыру', pf(130, 800), CREAM), ('\n', pf(10), CREAM), ('мәтіні', pf(110, 500, True), GOLD_L)],
      '4 тойға дайын үлгі — көшіріп алып, есімді қойыңыз', 'Сақтап қойыңыз', 1, T, L, P.format(1))
template('Қыз ұзату', 'Құрметті ағайын-туыс, құда-жекжат, дос-жарандар! Сіздерді аяулы қызымыз [есімі] ұзату тойына арналған салтанатты ақ дастарханымыздың қадірлі қонағы болуға шақырамыз!', 2, T, P.format(2))
template('Сүндет той', 'Құрметті ағайын-туыс, құда-жекжат, дос-жарандар! Сіздерді ұлымыз [есімі] сүндет тойына арналған салтанатты ақ дастарханымыздың қадірлі қонағы болуға шақырамыз!', 3, T, P.format(3))
template('Тұсаукесер', 'Құрметті ағайын-туыс, дос-жарандар! Сіздерді аяулы ұлымыз (қызымыз) [есімі] тұсаукесер тойына арналған ақ дастарханымыздың қадірлі қонағы болуға шақырамыз!', 4, T, P.format(4))
template('Мерейтой', 'Құрметті ағайын-туыс, дос-жарандар! Сіздерді анамыз [есімі] 60 жасқа толу мерейтойына арналған салтанатты ақ дастарханымыздың қадірлі қонағы болуға шақырамыз!', 5, T, P.format(5))
cta([('Мәтін дайын —', pf(76, 700), CREAM), ('\n', pf(10), CREAM), ('енді әдемілейік', pf(76, 500, True), GOLD_L)],
    ['Фото, музыка, 2ГИС картасы', '«Келемін / келе алмаймын» түймесі', 'Сол күні дайын', 'Төлем — көрген соң'],
    'Сілтеме профильде', 6, T, L, P.format(6))
print('ok')
