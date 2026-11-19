import sys
sys.path.insert(0, '/home/claude/carousel')
from make3 import *  # noqa  (re-renders old ones too, harmless)

OUT4 = '/home/claude/carousel/out4'


def step(when, title, desc, n, total, path):
    def body(d, y):
        d.text((96, y), when.upper(), font=it(30, 'Bold'), fill=GOLD); y += 70
        y = rich(d, (96, y), [(title, pf(84, 700), INK)], maxw=880) + 30
        d.line((96, y, 260, y), fill=GOLD, width=3); y += 50
        y = text(d, (96, y), desc, it(42, 'Medium'), BODY, maxw=860, lh=1.4)
        return y
    centered(bg_light, n, total, False, 'ЧЕК-ЛИСТ', body, path)


# ---- карусель: той чек-листі ----
T = 8; P = OUT4 + '/checklist/slide{}.jpg'; L = 'ТОЙ ЧЕК-ЛИСТІ'
cover([('Той чек-листі', pf(112, 800), CREAM), ('\n', pf(10), CREAM), ('күн санап', pf(100, 500, True), GOLD_L)],
      'Ештеңені ұмытпау үшін — сақтап қойыңыз', 'Парақтаңыз  →', 1, T, L, P.format(1))
step('Тойға 3 ай қалғанда', 'Негізгі шешімдер', 'Той күні, мейрамхана және асаба. Жақсы залдар ерте броньдалады.', 2, T, P.format(2))
step('2 ай қалғанда', 'Қонақтар тізімі', 'Тізімді жасаңыз, фотограф пен көйлекті таңдаңыз.', 3, T, P.format(3))
step('1 ай қалғанда', 'Шақыру тарату', 'Барлық қонаққа шақыру жіберіңіз — ерте алса, жоспарлап үлгереді.', 4, T, P.format(4))
step('2 апта қалғанда', 'Жауаптарды жинау', 'Кім келетінін, неше адам болатынын біліп, орын жоспарын жасаңыз.', 5, T, P.format(5))
step('3 күн қалғанда', 'Еске салу', 'Қонақтарға уақыт пен мекенжайды тағы бір рет жіберіңіз.', 6, T, P.format(6))
step('Той күні', 'Тек қуаныңыз', 'Бәрі дайын. Қалғаны — жақындарыңызбен бірге шаттық.', 7, T, P.format(7))
cta([('Шақыру мен жауаптар —', pf(70, 700), CREAM), ('\n', pf(10), CREAM), ('бір сілтемеде', pf(70, 500, True), GOLD_L)],
    ['Фото, музыка, 2ГИС картасы', 'Қонақтың жауабы тізімге өзі түседі', 'Еске салу — сол сілтемемен', 'Сол күні дайын'],
    'Сілтеме профильде', 8, T, L, P.format(8))


# ---- одиночный пост-опрос ----
img = bg_dark(); d = chrome(img, 1, 1, True, 'СҰРАҚ')
def body(d, y):
    y = rich(d, (100, y), [('Тойға қонақты', pf(84, 700), CREAM), ('\n', pf(10), CREAM),
                            ('қалай шақырдыңыз?', pf(84, 500, True), GOLD_L)], maxw=880, align='center', lh=1.12) + 60
    for letter, opt in [('А', 'Бәріне телефон соқтым'), ('Ә', 'Ашықхатты үйме-үй тараттым'),
                        ('Б', 'WhatsApp-қа сілтеме жібердім'), ('В', 'Анам бәрін өзі шешті')]:
        d.rounded_rectangle((150, y, W - 150, y + 96), radius=48, outline=GOLD, width=2)
        d.ellipse((168, y + 14, 236, y + 82), fill=GOLD)
        f = pf(40, 700); tw = d.textlength(letter, font=f)
        d.text((202 - tw / 2, y + 20), letter, font=f, fill=GREEN_D)
        d.text((262, y + 26), opt, font=it(36, 'Medium'), fill=CREAM)
        y += 120
    y += 20
    return text(d, (100, y), 'Комментарийге әрпін жазыңыз', it(34, 'SemiBold'), GOLD_L, maxw=880, align='center')
probe = ImageDraw.Draw(Image.new('RGB', (W, H))); h = body(probe, 0)
body(d, TOP + (BOT - TOP - h) / 2)
# прогресс-точка одна — убираем, перерисовав низ
save(img, OUT4 + '/poll/slide1.jpg')
print('ok4')
