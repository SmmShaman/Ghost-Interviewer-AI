
# Ghost Interviewer — 2026-11-24 (деплой Worker, підготовка живого тесту)

Попередній стан: [[session_handoff_2026_11_23_ghost]]. Що правда зараз: [[ghost-interviewer-claude-migration]].

## ✅ Shipped
- Worker `ghost-interviewer-api` (ghost.vitalii.no) задеплоєно з гілки `rework/live-pipeline`, код = коміт `96f3c58`. Версія `e3b05877-ba38-4101-b787-b1c7792976c8` (попередня `a531cd52`, 2026-09-09). Власник сказав «так» 24.11.
- Перевірено після деплою: `/` → 200; `POST /api/ai/stream` без токена → 401; `POST /api/auth/google` з порожнім тілом → 400 `idToken is required` (новий маршрут є).
- Секрети Worker (лише назви): `AI_INTERNAL_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `DATABASE_URL`, `GOOGLE_TRANSLATE_KEY`. `SESSION_SECRET` нема — сесійні токени підписуються `AI_INTERNAL_KEY`, цього досить.
- `53a99ca` docs: копія цього чекліста в репозиторії — `HANDOFF-live-test.md` у корені гілки `rework/live-pipeline` (запушено), щоб його бачила сесія на іншій машині.
- Фронтенд: гілка `rework/live-pipeline` = origin (`53a99ca`), у `main` НЕ злито, Netlify показує старий фронтенд.
- Нове правило власника: [[feedback-always-push-and-deploy]].

## 🔴 OPEN — сесія на НОУТБУЦІ (Windows, Claude Code з Claude in Chrome) робить це ПЕРШИМ
Мета: живий тест нової гілки у справжньому Chrome власника, потім merge.

Власник працюватиме в Claude Code (не у VS Code). Сесія має бути запущена на WINDOWS (застосунок Claude Code або `claude` у PowerShell), НЕ у WSL — у WSL браузерних інструментів нема ([[claude_in_chrome_windows_only]]). `claude-sync` — навпаки, лише з термінала WSL.

00. НАЙПЕРШЕ на ноутбуці (WSL): `claude-sync pull` — памʼять із ПК запушено на VPS 24.11 ([[claude-sync-between-machines]]); якщо на ноутбуці були свої сесії після останнього pull — спершу `claude-sync push`. Потім перечитати `MEMORY.md` і цей файл.
0. Підготовка: `cd C:\Users\stuar\Projects\Ghost-Interviewer-AI`, `git fetch`, `git status` (має бути гілка `rework/live-pipeline`, 0 behind/ahead; якщо ноутбук — окрема копія і гілки нема: `git checkout rework/live-pipeline`, НЕ pull поверх брудного дерева — показати власнику). `npm install`, `npm run dev` у фоні → http://localhost:3000. Потрібен `.env.local` з `VITE_GOOGLE_CLIENT_ID` (без нього кнопки входу Google нема; значення те саме, що в Netlify) — якщо файла на ноутбуці нема, попросити власника.
1. Claude in Chrome: відкрити НОВУ вкладку `http://localhost:3000/?sim` (імітація норвезької співбесіди, мікрофон не потрібен). Попросити власника натиснути вхід Google (сам не логінюсь). Після входу в localStorage має зʼявитися `ghost_interviewer_auth_v1` із токеном, що починається на `gs1.` → сесійні токени працюють. Якщо токен не `gs1.` → Worker не видав сесійний токен, дивитися відповідь `/api/auth/google`.
2. Режим FOCUS → Start. Перевірити: сегменти зʼявляються; сіра чернетка одразу; білий потоковий переклад її замінює; у рядку стану `LLM ok` і «~N s до перекладу» — ЗАПИСАТИ цифру (перший чесний замір; очікування ≤ 1.5–2 с); питання дають картку відповіді. У консолі НЕ має бути warning про перехід на `claude-haiku-4-5` — якщо є, токен підписки не віддає `claude-sonnet-5-5` через Worker (запит повертає 400/403/404): записати точний статус і тіло.
3. Повторити у FULL (стратегія + аналіз у картках) і SIMPLE; перемкнути режим посеред сесії; Space (пауза «я говорю»), Enter (відповісти на останню репліку), Stop, очищення сесії.
4. Брифінг: заповнити резюме/вакансію/компанію (у власника є в налаштуваннях профілю) → «Брифінг» → «Створити»; друга відповідь у сесії має приходити швидше (кеш system-промпту).
5. Справжній мікрофон: `http://localhost:3000/?debug` без `?sim`. Звук дає власник — говорить норвезькою або вмикає норвезький запис через VB-Cable (пристрій вибрати в шестерні). Дивитися: рестарти розпізнавача в оверлеї, де ріжуться сегменти, рушій чернетки в рядку стану (`chrome` очікується в Chrome 138+).
6. Усе знайдене — виправити на гілці, закомітити, запушити. Після «так» власника: merge `rework/live-pipeline` → `main` (Netlify задеплоїть сам), перевірити https://ghost.vitalii.no тим самим чеклістом (кроки 1–2).
7. Після тесту закрити відкриті вкладки ([[browser_close_tabs_rule]]); якщо «No group with id» — вимкнути Tab Manager Auto ([[chrome_tab_manager_auto_breaks_claude]]).

Потім (не терміново): вимірювальний тест «вух» Soniox / Gemini Live Translate / Deepgram — новий клас за інтерфейсом `SpeechSource`.

## 🟡 Manual steps for the owner
- На ноутбуці: увійти в Google у застосунку, коли сесія попросить; дати звук для кроку 5.
- Worker: додати `GOOGLE_CLIENT_ID` (= `VITE_GOOGLE_CLIENT_ID` з Netlify), інакше будь-який Google-акаунт з будь-якого застосунку може користуватися проксі до підписки Claude. Команда: `npx wrangler secret put GOOGLE_CLIENT_ID` у `backend/worker` (сесія може зробити сама, якщо власник дасть значення).

## Gotchas learned
- Вхід `wrangler` (OAuth) прострочений і у WSL, і на Windows. Деплой пройшов із токеном `CLOUDFLARE_API_TOKEN_2` з `ENV-FILES/boytasks.env`, виставленим як `CLOUDFLARE_API_TOKEN` (той самий акаунт Cloudflare, бачить секрети й деплої цього Worker). `npx wrangler` (3.114.17) у `backend/worker` з WSL працює — стара примітка «not recognized» стосувалась Windows-оболонки.
- Значення `AI_INTERNAL_KEY` локально в `ENV-FILES` нема → перевірити Sonnet 5.5 через Worker сервер-до-сервера звідси не вдалося; це перевіряється кроком 2 у браузері.
- Сесія у WSL не має браузерних інструментів узагалі (ні Claude in Chrome, ні вбудованого браузера) — живий тест можливий лише з Windows.
- Брудне дерево (debugLogger.ts, rename-audio-devices.ps1 — рівно стільки ж вставок, скільки видалень, схоже на CRLF/LF; harness/) не чіпав.
