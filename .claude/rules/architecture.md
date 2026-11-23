# Architecture

## Application Flow

```
Landing Page (mode selection, Google sign-in, briefing status)
    -> Start Session (microphone auto-starts)
    -> SpeechSource (WebSpeechSource | SimulatedSpeechSource with ?sim in dev)
    -> Segmenter (utterance end / pause / clause boundary) -> Segment
    -> Segment shown at once as an instant draft (grey)
    -> Streamed LLM translation (previous segments as context) replaces the draft
    -> FOCUS/FULL: the translation call flags a finished interviewer question (@@Q:)
    -> Grounded answer (full documents + briefing, prompt-cached)
    -> Stop Session (flushes the unfinished phrase; running calls finish)
```

All three modes (SIMPLE / FOCUS / FULL) use this one pipeline in `hooks/useLiveSession.ts`; they differ only in depth: SIMPLE = translation, FOCUS = + answers, FULL = + strategy and analysis per answer. The mode can be changed mid-session; `contextRef` always holds the latest context for async work.

## Core Data Flow

### Speech -> Text (`services/speech/`)

`SpeechSource` (types.ts) is the only thing the pipeline knows about speech: `onInterim(text)` replaces the current hypothesis, `onFinal(text)` is append-only, `onState`, `onDebug`. `App.tsx` creates one source for the app's lifetime (`speechRef`); swap the constructor to use a cloud streaming STT.

`WebSpeechSource` keeps Chrome's recognizer alive for a whole interview: restart on `onend` with back-off, watchdog for silent hangs (6 s without events), a fresh `MediaStreamTrack` per restart (`start(track)`, Chrome 135+), raw audio constraints (no AEC/AGC/NS), fatal errors (`not-allowed`, `service-not-allowed`, `language-not-supported`) reported via `onState('error')`, which stops the session.

`SimulatedSpeechSource` replays a scripted Norwegian interview (350 ms per word, final 600 ms after the last word). Only when `import.meta.env.DEV` and `?sim` is in the URL; `window.__ghostSimScript` can replace the script.

### Segmentation (`services/segmenter.ts`)

Pure class, no timers: the caller feeds `pushInterim`, `pushFinal`, `tick(now)` (every 100 ms from the hook), `flush()`. A segment ends on `final` (recognizer finished the utterance), `pause` (interim unchanged for `pauseMs` = 900, doubled when fewer than 5 words are pending), or `length` (speaker keeps going: once 12+ words are uncommitted, cut at sentence punctuation, then before a clause opener, then after a comma; hard cut at 22 words; the last 3 words are held back because the recognizer still revises them). Over-long finals are split the same way. Clause openers are `men/fordi/siden/hvis/når...` (plus English/German); `og`/`eller` count only when followed by a subject pronoun; `så` and `selv` are deliberately not boundaries. Unit tests: `tests/segmenter.test.ts`.

`useLiveSession` skips tick processing after a main-thread stall (>400 ms between ticks), because queued recognizer events make "no new words" meaningless then.

### Draft Translation (`services/localTranslator.ts`)

`translateDraft(text)` never throws or blocks; it returns the first working engine's output (glossary-processed) or `null`:
1. **Chrome Translator API** (Chrome 138+) - on-device, instant
2. **Google Cloud NMT** (`googleTranslateNMT.ts`) - through the Worker `/api/translate` when signed in, or direct with `VITE_GOOGLE_TRANSLATE_KEY` / `context.googleTranslateKey`
3. **Opus model** (`goldcc/opus-mt-no-uk-int8`, 56MB, Norwegian -> Ukrainian only) - WebGPU/WASM, loaded in the background only when 1 and 2 are unavailable

Drafts are LRU-cached (200 entries). `getStatus().method` (`chrome | nmt | opus | none`) feeds the status bar. The interim phrase in progress also gets a debounced draft (last 14 words).

### LLM Translation (`services/claudeService.ts` + `services/prompts.ts`)

`pumpTranslations` processes a queue of segment ids one at a time (`translatingRef` mutex). Each call carries the last 3 translated segments as context, `speakerContinues` (boundary was `length`), the questions already handled and the briefing's keyterms. When several segments are waiting they are merged into one (max 45 words; a batch ends at an utterance end once it has 8+ words). The stream updates the segment token by token; `latencyMs` is segment creation to first token. One quick retry on a non-auth error before any token arrived; on failure the segment keeps its draft (`status: 'draft-only'`).

Models: `claude-sonnet-5-5`, thinking off (`config.thinking: false`), `effort: low`; if the Worker rejects it (400/403/404) the client switches to `claude-haiku-4-5` for the session. Answers and the briefing use `claude-opus-5`.

### Question Detection and Answers

With `detectQuestions` (FOCUS/FULL) the translation prompt asks the model to append one line `@@Q: <question in source language> || <question in native language>` when the interviewer finished a question. `parseTranslation()` hides the marker while streaming and extracts the question when the stream is complete. `startAnswer` (not awaited, so translation never waits for it) skips near-duplicates (`questionSimilarity` >= 0.7 against the last 6), then `generateAnswer` streams `[STRATEGY]` (FULL) / `[ANSWER]` / `[TRANSLATION]` / `[ANALYSIS]` (FULL), parsed by `parseAnswer()`. Enter triggers `answerLast()` manually for the last unanswered segments.

The answer system prompt (documents + briefing + personal instructions + no-invention rule) is identical for every question of a session and is sent with `cacheSystem: true`, so the Worker marks it as a prompt-cache breakpoint. Documents are sent in full; `CAPS` in `prompts.ts` only guard against pathological pastes. There is no retrieval layer.

### Briefing

`BriefingPanel` -> `generateBriefing` (Opus, effort high, abortable). Result `{text, keyterms}` is saved in `context.briefings[hashDocs(docs, targetLanguage, nativeLanguage)]` (newest 5 kept). `text` goes into every answer's system prompt; `keyterms` into every translation prompt. A briefing built from other documents is offered as stale, not used.

## State Management

All state is local React state; no external library.

- `App.tsx`: `context` (InterviewContext, persisted to `localStorage` key `ghost_interviewer_context_v2`, merged over `DEFAULT_CONTEXT` on load), `appState`, UI flags
- `useLiveSession`: `LiveState` (`segments`, `qa`, `interim`, `interimDraft`, `llmStatus`, `llmError`, `isPaused`...) plus refs mirroring it (`segmentsRef`, `qaRef`, `queueRef`) so async work never reads stale state
- Auth token: `apiClient` singleton, localStorage key `ghost_interviewer_auth_v1`

## Singleton Services

Exported instances: `localTranslator`, `googleTranslateNMT`, `glossaryProcessor`, `debugLogger`, `apiClient`.

## Layout

`LiveView.tsx` is the only live screen: a translation feed (draft in grey italics, LLM text in white, source text underneath) and, in FOCUS/FULL, an answers column of `QACard`s (strategy and analysis shown only in FULL). Status bar: segment count, average time to first translation token (last 10), draft engine, `LLM <status>`, REC. LLM problems show as a banner (`offline` = not signed in, `auth` = session expired, `error` = message from the call).

## API Integration

### Anthropic Claude (via Cloudflare Worker)
- Frontend never holds LLM credentials. `claudeService.ts` calls `POST {VITE_API_URL}/api/ai/stream` on `ghost.vitalii.no` (SSE) with `Authorization: Bearer <session token>`. Request fields: `model`, `prompt`, `systemInstruction`, `cacheSystem`, `config: { maxOutputTokens, effort, thinking }`.
- Worker (`backend/worker/src/index.ts`) calls `https://api.anthropic.com/v1/messages`. Auth: `CLAUDE_CODE_OAUTH_TOKEN` (subscription OAuth token -> `Authorization: Bearer` + `anthropic-beta: oauth-2025-04-20`) or `ANTHROPIC_API_KEY` (`x-api-key`). Set with `npx wrangler secret put <NAME>`.
- Subscription OAuth tokens serve Opus/Sonnet ONLY when the first `system` block is exactly `You are Claude Code, Anthropic's official CLI for Claude.` - `buildAnthropicBody()` always prepends it (app prompt = 2nd block, with `cache_control: ephemeral` when `cacheSystem`). Without it every non-Haiku model returns an instant `rate_limit_error`.
- Thinking: every model except `haiku-4-5` gets adaptive thinking (`output_config.effort`, default low) unless `config.thinking === false`.
- On a 429 from Anthropic the Worker retries once on `claude-haiku-4-5`. Worker only accepts `claude-*` model ids. `X-Internal-Key` (= `AI_INTERNAL_KEY`) lets the owner's other Workers call the proxy server-to-server.
- Stream protocol is unchanged: SSE lines `data: {"text": "..."}` then `data: [DONE]`; `data: {"error": "..."}` aborts (the client throws `LLMError`).

### Session Tokens
`POST /api/auth/google` verifies the Google ID token once and returns the user plus `sessionToken` (`gs1.<payload>.<HMAC-SHA256>`, 12 h, key from `SESSION_SECRET` or `AI_INTERNAL_KEY`) and `sessionExpiresAt`. `verifyBearer()` checks session tokens locally (no network) and still accepts raw Google ID tokens (1 h, verified via Google on each request). If neither secret is set the Worker returns `sessionToken: null` and the frontend falls back to the Google token with a 55 min TTL.

## Important Patterns

### AbortController
`abortRef` in `useLiveSession` is recreated in the mount effect and aborted on unmount and on `reset()`; every LLM call passes its signal. STOP does not abort: the unfinished phrase is flushed into a segment and running translations/answers finish. Clearing the session aborts and starts a fresh controller.

### Pause ("I am speaking")
While paused, interim and final events are ignored. On pause the interviewer's pending words are flushed; on resume the segmenter is reset, and an utterance that started during the pause is dropped until the recognizer finalizes it (`skipUntilFinalRef`).

### Errors Are Surfaced
LLM failures set `llmStatus`/`llmError` (banner) and mark the item `error`/`draft-only`; nothing is converted to an empty string. After a new sign-in `retryDrafts()` re-queues the last 6 `draft-only` segments.

### Import Maps
`index.html` declares an import map (React/ReactDOM from aistudiocdn.com, `@huggingface/transformers` 3.0.0 from jsdelivr). Keep it in sync with `package.json`.
