# Ghost Interviewer — HANDOFF 2026-11-25 (мобільна версія + серверні логи тестів)

> **ОНОВЛЕННЯ 25.11, друга сесія (ПК) — читати ПЕРШИМ; розділ «🔴 OPEN» нижче застарів.**
>
> - Worker задеплоєно з `main`: версія `1fa8b8d6`, `/api/logs` + D1 працюють; додано секрет `GOOGLE_CLIENT_ID`.
> - `dcc0845` fix(segmenter): Chrome на Android замінює гіпотезу новою фразою без final — перекладалась лише перша фраза сесії. Виправлено, тест 14.
> - `69f5903` fix(speech): на телефоні розпізнавач перезапускається через 2.5 с тиші після фрази (було 6–9 с).
> - Логи тестів власника лежать у D1 (5 сесій з телефона). Читати: `wrangler d1 execute ghost-test-logs --remote` з повним токеном `CLOUDFLARE_API_TOKEN` з `ENV-FILES/minielvarika.env` (токен деплою з `boytasks.env` D1 не читає).
> - Висновок з логів: Web Speech на Android дає одну фразу за запуск і мовчить 2–5 с після кожного перезапуску — з безперервної мови ловиться приблизно чверть. Кодом застосунку не лікується.
>
> **🔴 Відкрито:** (1) рішення власника про хмарне розпізнавання (Soniox / Deepgram / Gemini Live) як новий `SpeechSource`, потрібен ключ; (2) базовий тест на комп'ютері в Chrome — десктопних сесій у логах ще нема; (3) час до першого токена перекладу нестабільний, 1–5 с; (4) перевірити новий вхід Google після `GOOGLE_CLIENT_ID` (якщо падає — `npx wrangler secret delete GOOGLE_CLIENT_ID`).

Хмарна сесія Claude Code: https://claude.ai/code/session_015mpzwRSrxoH9YofgSiiDBH
(вміст цієї розмови нова сесія НЕ бачить — усе потрібне записано тут).
Цей файл замінює `HANDOFF-live-test.md` (крок «merge у main» з нього виконано).

## ✅ Зроблено й задеплоєно

- **`main` = `8927d08`** (гілка `claude/nifty-hawking-tnx5i9` — та сама). Netlify задеплоїв: https://ghost-interviewer-ai.netlify.app
- `rework/live-pipeline` злито в `main` (fast-forward) з дозволу власника. Новий конвеєр (сегменти, потоковий переклад, брифінг) — у продакшні.
- `83e7ba6` **збірка Netlify**: `npm install` падав, бо `onnxruntime-node` (залежність transformers.js) качає CUDA-бінарник з адреси, що тепер дає 404. У `netlify.toml` додано `ONNXRUNTIME_NODE_INSTALL_CUDA = "skip"`. Локально так само: `ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install`.
- `cfda506` **мобільна версія (PWA)**: `public/manifest.webmanifest`, `public/sw.js` (network-first, офлайн-оболонка), кнопка «Встановити застосунок» (`components/InstallAppButton.tsx`), нижня панель дій на телефоні, Wake Lock, на телефоні завжди вбудований мікрофон через `recognition.start()` (`services/device.ts`). APK не робили: Web Speech API не працює у WebView.
- `8927d08` **логи тестів**: `services/sessionRecorder.ts` пише кожну гіпотезу (interim) і фінал розпізнавача, межі фраз, чернетку (рушій, затримка), переклад LLM (модель, перший токен, повністю), питання/відповіді, перезапуски розпізнавача, зміну режиму. Зберігає в localStorage (`ghost_test_logs_v1`) і кожні 3 с відправляє на Worker `POST /api/logs` (ідемпотентно за `seq`); після Stop (+10 с) — повний читабельний текст. Невідправлене чекає на телефоні й іде пізніше (навіть після перезапуску). Панель «📋 Логи тестів» на головній.
- **Cloudflare D1** `ghost-test-logs` створено (id `80cc2afa-335a-4a22-8a76-5bf438dfa20e`, регіон WEUR), таблиці `log_sessions`, `log_events` уже є. Прив'язка `LOGS_DB` — у `backend/worker/wrangler.toml`.

## 🔴 OPEN — зробити ПЕРШИМ

### 1. Задеплоїти Worker `ghost-interviewer-api` (ghost.vitalii.no)
Код з `/api/logs` є в `main`, але на ghost.vitalii.no працює стара версія (`96f3c58`, деплой 24.11). Без цього логи з телефона лише накопичуються в черзі (застосунок пробує раз на хвилину).

**Ключ.** Хмарна сесія токена Cloudflare не знайшла: у контейнері його нема, доступу до VPS / `claude-sync` / пам'яті з ПК не було, власник відхилив захищену форму. Де шукати на ПК:
- 24.11 деплой пройшов з `CLOUDFLARE_API_TOKEN_2` з файлу `ENV-FILES/boytasks.env`, виставленого як `CLOUDFLARE_API_TOKEN` (той самий акаунт Cloudflare). OAuth-вхід `wrangler` прострочений і у WSL, і на Windows.
- Потрібне право: Workers Scripts: Edit (+ D1, бо прив'язується база).
- Значення токена НЕ комітити, не писати в чат і в цей файл.

**Деплой (з WSL на ПК):**
```bash
cd backend/worker
git pull
npm install
CLOUDFLARE_API_TOKEN=<токен з ENV-FILES> npx wrangler deploy
```
Секрети Worker деплой не чіпає (`AI_INTERNAL_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `DATABASE_URL`, `GOOGLE_TRANSLATE_KEY` лишаються). Перед деплоєм 25.11 звірено: задеплоєний код = `96f3c58`, тобто нових змін, крім `/api/logs` і прив'язки D1, деплой не принесе.

**Перевірка після деплою:**
- `curl -X POST https://ghost.vitalii.no/api/logs` → 401 `Authorization required` (без токена так і має бути);
- власник відкриває застосунок на телефоні, увійшовши в Google → у панелі «Логи тестів» сесії мають стати «☁ на сервері»;
- у D1 з'являються рядки (див. нижче, як читати).

### 2. Прочитати логи тестів власника і розібрати якість
Що розпізнано → яка чернетка → який переклад LLM, де ріжуться фрази, затримки. Читати:
- конектор Cloudflare (MCP) у хмарній сесії: `d1_database_query` з `database_id` вище, напр. `SELECT id, user_email, started_at, ended_at, meta FROM log_sessions ORDER BY started_at DESC` і `SELECT full_text FROM log_sessions WHERE id = ?`; для незавершених — `SELECT t, kind, data FROM log_events WHERE session_id = ? ORDER BY seq`;
- або з ПК: `npx wrangler d1 execute ghost-test-logs --remote --command "<SQL>"`;
- або через API застосунку з токеном користувача: `GET /api/logs`, `GET /api/logs/<id>.txt`.

Логи тестів ДО 25.11 (до коміту `8927d08`) втрачено: тоді журнал жив лише в пам'яті браузера.

## 🟡 Інше відкрите
- Worker: додати секрет `GOOGLE_CLIENT_ID` (= `VITE_GOOGLE_CLIENT_ID` з Netlify), інакше проксі приймає Google-токен будь-якого застосунку: `npx wrangler secret put GOOGLE_CLIENT_ID`.
- Дрібниці з тесту 24.11 (`?sim`, макет LLM): (1) якщо рушій чернетки ще не готовий, перша фраза лишається «…» назавжди; (2) дві паралельні перевірки Chrome Translator → перша чернетка чекає 5 с тайм-ауту (у справжньому Chrome 138+, найімовірніше, не проявиться); (3) після тимчасового збою LLM фрази `draft-only` перекладаються повторно лише після нового входу.
- Телефон: на iPhone застосунок з головного екрана має окреме сховище (вхід Google ще раз усередині застосунку); на Android Chrome може пищати при перезапусках розпізнавання — поведінка Chrome.
- Справжня затримка «~N s до перекладу» і чи віддає Worker `claude-sonnet-5-5` без переходу на Haiku — досі не заміряно на живому LLM (лише на макеті).

## Gotchas
- Хмарна сесія: немає VPS, `claude-sync`, SSH, пам'яті з ПК; є конектори Cloudflare (D1 / список Workers / код Worker, але НЕ деплой), Gmail, Google Drive, GitHub.
- `backend/worker`: `tsc` має ~115 старих помилок типів Neon (`NeonQueryFunction`), вони не від нових змін і деплою не заважають; `wrangler deploy --dry-run` проходить.
- Локальна перевірка Worker: `npx wrangler dev --local --persist-to <dir> --var AI_INTERNAL_KEY:testkey --var DATABASE_URL:postgres://u:p@localhost/db` + таблиці через `wrangler d1 execute ghost-test-logs --local --persist-to <dir>`; сесійний токен `gs1.` підписується HMAC-SHA256 ключем `ghost-session:<AI_INTERNAL_KEY>`.
- `?sim` працює лише на dev-сервері, не на сайті.
- `components/LandingPage.tsx` має змішані закінчення рядків (CRLF + 54 LF) ще до цих змін — при правках зберігати як є.
