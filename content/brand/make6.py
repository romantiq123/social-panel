import sys
sys.path.insert(0, '/home/claude/carousel')
import builtins
_p = builtins.print; builtins.print = lambda *a, **k: None
from make3 import *  # noqa
builtins.print = _p

OUT6 = '/home/claude/carousel/out6'


def idea(num, title, desc, n, total, path):
    def body(d, y):
        d.text((90, y - 40), num, font=pf(230, 500, True), fill=GOLD); y += 250
        y = rich(d, (96, y), [(title, pf(80, 700), INK)], maxw=880) + 30
        d.line((96, y, 260, y), fill=GOLD, width=3); y += 50
        return text(d, (96, y), desc, it(42, 'Medium'), BODY, maxw=870, lh=1.42)
    centered(bg_light, n, total, False, 'ИДЕЯ ' + num, body, path)


T = 7; P = OUT6 + '/idei/slide{}.jpg'; L = 'ИДЕИ'
cover([('5 идей', pf(130, 800), CREAM), ('\n', pf(10), CREAM), ('для приглашения,', pf(84, 500, True), GOLD_L),
       ('\n', pf(10), CREAM), ('от которых гости ахнут', pf(64, 500, True), GOLD_L)],
      'Чтобы ссылку не просто открыли, а пересылали друг другу', 'Листайте  →', 1, T, L, P.format(1))
idea('01', 'Ваша история', 'Пара строк о том, как вы познакомились, и пара фото. Гости листают и улыбаются ещё до тоя.', 2, T, P.format(2))
idea('02', '«Та самая» песня', 'Музыка включается сразу, как гость открывает ссылку. Казахская классика или ваш трек — настроение с первой секунды.', 3, T, P.format(3))
idea('03', 'Обратный отсчёт', 'Таймер до тоя: «осталось 12 дней 5 часов». Гости возвращаются к приглашению снова и снова.', 4, T, P.format(4))
idea('04', 'Программа вечера', 'Беташар, первый танец, торт — по времени. Старшие оценят, что всё понятно заранее.', 5, T, P.format(5))
idea('05', 'Два языка', 'Апашкам — на казахском, друзьям — на русском. Одна ссылка, язык гость выбирает сам.', 6, T, P.format(6))
cta([('Всё это уже', pf(80, 700), CREAM), ('\n', pf(10), CREAM), ('в шақыру', pf(80, 500, True), GOLD_L)],
    ['История, фото и музыка', 'Таймер и программа тоя', 'Карта 2ГИС и «приду / не приду»', 'Готово в тот же день'],
    'Ссылка в профиле', 7, T, L, P.format(7))
print('ok6')
