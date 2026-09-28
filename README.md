# Social Panel — Threads + Instagram

Своя панель для постинга в Threads и Instagram через **официальные API Meta**: планирование, календарь, очередь, цепочки Threads, карусели/Reels/Stories, аналитика, автопродление токенов и MCP-сервер, чтобы Claude готовил посты за тебя.

## Возможности

| | |
|---|---|
| **Календарь** | месяц/неделя, клик по дню → новый пост, drag-n-drop для переноса |
| **Редактор** | один пост сразу в несколько каналов, свой текст под каждую площадку, превью «как в приложении», счётчики лимитов, вставка картинки из буфера (Ctrl+V), подписи-шаблоны |
| **Threads** | текст / фото / видео / карусель (до 20), цепочки (thread), тема (topic tag), кто может отвечать |
| **Instagram** | пост / карусель (до 10), Reels, Stories, первый комментарий |
| **Очередь** | слоты публикации у каждого канала, кнопка «В очередь» ставит пост в ближайший свободный |
| **Токены** | долгоживущие (60 дней), автопродление за N дней до истечения, прогресс-бар, ручное продление, пометка «истёк» при ошибке 190 |
| **Надёжность** | повтор при временных ошибках (3 попытки), защита от двойной публикации, восстановление после перезапуска |
| **Медиа** | библиотека, автоконвертация картинок в JPEG (Instagram принимает только JPEG) |
| **Аналитика** | просмотры, лайки, ответы, репосты, охват, сохранения; обновление каждые 3 часа |
| **MCP** | 17 инструментов для Claude: создать, запланировать, опубликовать, загрузить медиа, статистика, токены |

## Запуск

```bash
npm install
npm run build
npm start
```

Панель откроется на http://localhost:3001. Пароль для входа выводится в консоли при первом запуске. Можно задать свой через `PANEL_PASSWORD` в `.env` (см. `.env.example`).

Для разработки: `npm run dev`, UI с hot reload будет на http://localhost:5173.

## Настройка Meta (один раз)

### 1. Публичный HTTPS-адрес

Серверы Meta **сами скачивают** медиа по URL, а OAuth работает только с HTTPS, поэтому панели нужен публичный адрес. Проще всего поднять туннель:

```bash
cloudflared tunnel --url http://localhost:3001
```

Полученный `https://….trycloudflare.com` укажи в **Настройки → Публичный адрес**.

> Адрес быстрого туннеля меняется при каждом перезапуске. Для постоянной работы лучше named tunnel в Cloudflare или статичный домен в ngrok (`ngrok http --domain=… 3001`), иначе придётся обновлять redirect URI в Meta. Панель закрыта паролем, открытыми остаются только `/media/*` и OAuth-колбэки.

### 2. Приложение в Meta for Developers

1. На https://developers.facebook.com/apps нажми **Create app**.
2. Добавь use cases:
   - **Access the Threads API**: включи права `threads_basic`, `threads_content_publish`, `threads_manage_insights`, `threads_manage_replies`, `threads_read_replies`, `threads_delete`.
   - **Manage messaging & content on Instagram → API setup with Instagram login**: права `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`, `instagram_business_manage_comments`.
3. Скопируй **Threads App ID / Secret** и **Instagram App ID / Secret** в «Настройки» панели.
4. Скопируй из «Настроек» панели Redirect / Uninstall / Deauthorize URL и вставь их в настройки use case в Meta.
5. Пока приложение в режиме Development, добавь свои аккаунты в **App roles → Roles → Threads Testers / Instagram Testers** и прими приглашение:
   - Threads: Настройки → Аккаунт → Сайты и приложения;
   - Instagram: Настройки → Сайты и приложения.

   Для своих аккаунтов App Review не нужен.

Instagram должен быть **профессиональным** аккаунтом (Business или Creator).

### 3. Подключение каналов

Открой **Каналы** и нажми **Threads** или **Instagram**, чтобы подключиться через OAuth. Ещё можно выбрать **«По токену»** и вставить токен, сгенерированный в кабинете Meta.

## Деплой на Railway (24/7)

1. New Project → Deploy from GitHub repo → выбери этот репозиторий. Сборка идёт по `Dockerfile` (настройки в `railway.json`).
2. **Volume:** правый клик по сервису → Attach Volume, mount path `/data`. Там будут жить база и медиа. Без volume всё пропадёт при каждом деплое.
3. **Variables:**
   - `PANEL_PASSWORD`: пароль для входа (обязательно);
   - `MCP_TOKEN`: необязательно, иначе сгенерируется сам и будет виден в Настройках.
4. **Settings → Networking → Generate Domain.** Railway выдаст `https://….up.railway.app`, панель подхватит его сама (`RAILWAY_PUBLIC_DOMAIN`).
5. Открой панель → Настройки: впиши ключи Meta и скопируй redirect URI в приложение Meta.

### MCP с любого компьютера

В Настройках панели лежит готовая команда с токеном:

```bash
claude mcp add --transport http social-panel https://<домен>/mcp --header "Authorization: Bearer <токен>" --scope user
```

Локальный stdio-MCP (`.mcp.json`) работает только с локальной базой `data/`. Когда панель живёт на Railway, используй удалённый.

## MCP для Claude (локально)

В корне проекта лежит `.mcp.json`. Claude Code, открытый в этой папке, подхватит его сам. Чтобы сервер был доступен из любой папки:

```bash
claude mcp add social-panel --scope user -- node --disable-warning=ExperimentalWarning "C:/Users/Abylaikhan/IdeaProjects/social-panel/node_modules/tsx/dist/cli.mjs" "C:/Users/Abylaikhan/IdeaProjects/social-panel/src/mcp/index.ts"
```

Примеры запросов:
- «Подготовь 3 черновика для Threads про запуск продукта, с цепочкой из 3 частей»
- «Загрузи C:\photos\promo.jpg и сделай пост в Instagram с первым комментарием из хэштегов, поставь в очередь»
- «Какие посты за неделю набрали больше всего просмотров?»
- «Проверь токены каналов»

MCP по умолчанию создаёт **черновики**. Публикация сразу (`publish_now`) идёт только по явной просьбе. Публикацию по расписанию делает сервер панели, поэтому держи `npm start` запущенным (можно поставить через pm2 или Планировщик задач Windows).

## Структура

```
src/core/        общее ядро (используют и сервер, и MCP)
  providers/     клиенты Threads и Instagram Graph API
  channels.ts    OAuth, токены, автопродление
  posts.ts       посты, валидация, публикация, очередь, статистика
  media.ts       библиотека, конвертация в JPEG
  scheduler.ts   фоновые задачи
src/server/      HTTP API (Hono) + раздача UI и медиа
src/mcp/         MCP-сервер (stdio)
web/             React + Tailwind UI
data/            SQLite и загруженные файлы (не коммитится)
```

## Ограничения API

- Threads: 250 постов и 1000 ответов за 24 часа, текст до 500 символов (эмодзи считаются по байтам).
- Instagram: 100 публикаций через API за 24 часа, подпись до 2200 символов, до 30 хэштегов. Для видео нужен MP4 (H.264/AAC); Reels — от 3 секунд до 15 минут.
- Токены хранятся в локальной SQLite (`data/panel.db`), папка `data/` в `.gitignore`.
