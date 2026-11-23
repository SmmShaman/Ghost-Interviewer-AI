# CLAUDE.md - Ghost Interviewer AI

## Project Overview

Real-time interview assistance app. Transcribes interviewer speech via a pluggable speech source (Web Speech API today), shows an instant machine draft translation, replaces it with a streamed LLM translation that sees the previous phrases as context, and generates grounded answers to the interviewer's questions via cloud LLMs. Designed for multilingual job interviews (primary: Norwegian to Ukrainian).

**Production:** https://ghost-interviewer-ai.netlify.app

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript, Vite 6 |
| Styling | Tailwind CSS (CDN with inline config in index.html) |
| Draft translation | Chrome Translator API (Chrome 138+) > Google Cloud NMT (via Worker `/api/translate`) > Transformers.js Opus model (WebGPU/WASM) |
| Cloud LLM | Anthropic Claude via Cloudflare Worker proxy `ghost.vitalii.no`: live translation `claude-sonnet-5-5` (fallback `claude-haiku-4-5`), answers + briefing `claude-opus-5` |
| Speech | `SpeechSource` interface; `WebSpeechSource` (Chrome/Edge), `SimulatedSpeechSource` (dev only) |
| Auth | Google Sign-In once, then a Worker-issued HMAC session token (12 h) |
| Hosting | Netlify (auto-deploy from main) |

## Quick Start

```bash
npm install
npm run dev       # http://localhost:3000
npm run build     # Production build
npm run preview   # Preview production build
```

Dev extras: `http://localhost:3000/?sim` replays a scripted Norwegian interview instead of the microphone (dev server only); `?debug` shows the speech-recognizer debug overlay.

**Environment:** LLM credentials live ONLY on the Cloudflare Worker (`backend/worker`): `CLAUDE_CODE_OAUTH_TOKEN` (Claude subscription, from `claude setup-token`) or `ANTHROPIC_API_KEY`. Frontend optional: `VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID`, `VITE_CLAUDE_MODEL`, `VITE_CLAUDE_MODEL_FAST`, `VITE_GOOGLE_TRANSLATE_KEY`.

## Directory Structure

```
App.tsx                        # Shell: context + localStorage, speech source wiring, draft translator init,
                               #   briefing selection, start/stop, keyboard shortcuts, header/mode switch
index.tsx                      # React entry point
index.html                     # HTML with Tailwind config, animations, import maps
types.ts                       # InterviewContext, Segment, QAItem, Briefing, ViewMode, AppState
translations.ts                # i18n (English + Ukrainian)
config/constants.ts            # DEFAULT_CONTEXT, STORAGE_KEY, LANG_MAP

components/
  LandingPage.tsx              # Mode selection, Google sign-in, briefing status
  LiveView.tsx                 # One screen for all modes: translation feed + answers + status bar
  BriefingPanel.tsx            # Pre-interview briefing generation/viewer
  SetupPanel.tsx               # Full settings (profiles, audio, personal instructions)
  GearMenu.tsx                 # Quick settings gear during sessions
  AudioPresetSelector.tsx      # Audio routing presets / setup guides
  Icons.tsx                    # SVG icons

hooks/
  useLiveSession.ts            # The pipeline: segmenter -> draft -> LLM translation -> questions -> answers
  useGoogleAuth.ts             # Google Sign-In + session restore/expiry
  useAudioDevices.ts           # Input/output device enumeration and presets
  useAudioPassthrough.ts       # Routes input device to an output device (VB-Cable, AUX)

services/
  segmenter.ts                 # Pure logic: interim/final stream -> Segments (utterance end / pause / clause)
  prompts.ts                   # Prompt builders + parsers (translation, answer, briefing); pure, Node-testable
  claudeService.ts             # translateSegment / generateAnswer / generateBriefing (SSE streaming via Worker)
  localTranslator.ts           # Draft translation: Chrome > Google NMT > Opus; glossary post-processing
  googleTranslateNMT.ts        # Google NMT client (Worker proxy or direct key)
  glossaryProcessor.ts         # IT term correction with Ukrainian morphology (160+ terms)
  apiClient.ts                 # Auth token storage (`ghost_interviewer_auth_v1`), Google -> session token exchange
  debugLogger.ts               # Event log: console helpers `__logs()`, dev-server file flush
  speech/
    types.ts                   # SpeechSource interface and events
    webSpeechSource.ts         # Web Speech API: auto-restart, watchdog, fresh MediaStreamTrack per restart
    simulatedSource.ts         # Scripted interview replay for `?sim`

data/it-glossary.json          # 160+ IT terms with Ukrainian inflections
tests/
  segmenter.test.ts            # Unit tests of segmentation
  prompt-check.ts              # Prints translation prompt cases for manual model comparison
backend/worker/                # Cloudflare Worker: auth, Claude proxy, Google translate proxy, profile/session API
```

## Architecture

### One Pipeline for All Modes

```
speech source -> Segmenter -> Segment
  Segment -> instant draft (grey)       localTranslator.translateDraft: Chrome > Google NMT > Opus
  Segment -> streamed LLM translation   replaces the draft; previous 3 segments sent as context
  (FOCUS/FULL) the translation call may end with an `@@Q:` line = a finished interviewer question
  question -> grounded answer           generateAnswer (claude-opus-5, prompt-cached system prompt)
```

| Mode | Shows | LLM calls |
|------|-------|-----------|
| SIMPLE | Translation feed only | Translation |
| FOCUS | Feed + suggested answers | + question detection (in the translation call) + answer |
| FULL | Feed + answers with strategy and analysis | Same as FOCUS; answer prompt also asks for `[STRATEGY]` and `[ANALYSIS]` |

The modes differ in depth, not in code path. The mode can be switched mid-session from the header.

### Speech Sources

All downstream code depends only on `SpeechSource` (`services/speech/types.ts`): `onInterim` (replaces the previous hypothesis), `onFinal` (append-only), `onState`, `onDebug`. A cloud streaming STT can be plugged in by implementing it and changing the constructor in `App.tsx`.

### Segmentation (`services/segmenter.ts`)

Segments end at (in order of preference): recognizer `final`, `pause` (interim unchanged for 900 ms; twice as long under 5 words), or `length` (speaker keeps talking: cut at sentence punctuation, before a clause opener, or at a comma, once 12+ words are uncommitted; hard cut at 22; last 3 words always held back). Not fixed word counts. Pure logic with an injected clock.

### Translation and Question Detection

- Up to 3 previous segments (source + translation) go with each call; queued segments are merged on catch-up (max 45 words), batches end at utterance ends.
- Model `claude-sonnet-5-5`, thinking off, `effort: low`; on HTTP 400/403/404 the client switches to `claude-haiku-4-5` for the rest of the session. A failed call is retried once; the segment keeps its draft (`draft-only`) if the LLM stays unavailable.
- `keyterms` from the briefing go into the translation prompt to repair recognition errors.
- Duplicate questions (word overlap >= 0.7 with the last 6) are skipped.

### Answers

`generateAnswer` sends the full candidate documents (resume, knowledge base, application letter, company, job; large caps only guard against pathological pastes, no retrieval/TF-IDF) plus the briefing in the system prompt, marked `cacheSystem` so it is prompt-cached per session. The prompt has an explicit no-invention rule. Output tags: `[STRATEGY]` (FULL), `[ANSWER]`, `[TRANSLATION]`, `[ANALYSIS]` (FULL); parsed by `parseAnswer()`.

### Briefing

`BriefingPanel` -> `generateBriefing` (`claude-opus-5`, effort high): company, vacancy requirements, requirement-to-evidence match, strengths, risks, likely questions, questions to ask, plus a `KEYTERMS:` line. Stored in `context.briefings`, keyed by `hashDocs()` of the documents and languages (max 5 kept; a briefing from older documents is shown as stale).

### Controls

Space = "I am speaking" (incoming speech is ignored; the interviewer's last words are flushed first). Enter = answer the last remark manually (FOCUS/FULL). LiveView status bar shows the draft engine, LLM status and average time to first translation token.

### Auth

Google Sign-In once -> `POST /api/auth/google` -> Worker returns an HMAC session token (`gs1.`, 12 h) -> stored in localStorage `ghost_interviewer_auth_v1`, restored after reload. The Worker also accepts raw Google ID tokens (used by the frontend only if the Worker issues no session token, with a 55 min TTL). Without sign-in the app shows machine drafts only (LLM status "offline"). A 401 triggers `markExpired` and a sign-in banner.

## Key Configuration

```typescript
// services/segmenter.ts DEFAULT_SEGMENTER_CONFIG
pauseMs: 900, shortPhraseWords: 5, softMaxWords: 12, hardMaxWords: 22, minWords: 5, holdWords: 3

// hooks/useLiveSession.ts
CONTEXT_SEGMENTS = 3, MERGE_MAX_WORDS = 45, MERGE_MIN_WORDS = 8, INTERIM_DRAFT_WORDS = 14, DUPLICATE_QUESTION = 0.7

// services/claudeService.ts
MODEL_MAIN = VITE_CLAUDE_MODEL || 'claude-opus-5'
MODEL_TRANSLATE = VITE_CLAUDE_MODEL_FAST || 'claude-sonnet-5-5'   // fallback 'claude-haiku-4-5'
```

## LLM Prompts

Prompt texts and parsers live in `services/prompts.ts` (Ukrainian prompt text on purpose). Translation output is plain text plus an optional `@@Q: <question in source language> || <question in native language>` line, parsed by `parseTranslation()` (a partial marker is hidden while streaming). Answer and briefing parsers: `parseAnswer()`, `parseBriefing()`.

## Styling

- Dark theme: `bg-gray-950` (#030712)
- Emerald: translation/answers, Red: interviewer/question, Purple: strategy, Blue: analysis, Amber: simple mode / warnings
- Fonts: Inter (sans), JetBrains Mono (mono)
- Custom animations in index.html

## Browser Requirements

Chrome 138+ recommended (native translation + WebGPU + Speech API). Speech recognition needs Chrome/Edge (Web Speech API); other browsers get an error message. HTTPS required in production.

## Audio Device Selection (Chrome 135+)

`WebSpeechSource` uses `SpeechRecognition.start(MediaStreamTrack)` (Chrome 135+) to capture a specific input device (`context.audioDeviceId`, persisted in localStorage), with echo cancellation, gain control and noise suppression disabled (they mangle loopback audio such as VB-Cable). A fresh track is acquired on every restart. If no device is selected or the overload is unavailable, it falls back to `recognition.start()` (system default mic). Audio presets in the SetupPanel/GearMenu choose the device; `useAudioPassthrough` can route the input to an output device.

## Testing

```bash
node --experimental-strip-types tests/segmenter.test.ts    # unit tests of segmentation
node --experimental-strip-types tests/prompt-check.ts      # prints translation prompt cases (JSON lines) for manual model comparison
```

There are no automated UI tests; use `?sim` for an end-to-end run without a microphone.

## Common Tasks

### Adding a New Language
1. Add the name -> BCP-47 code in `config/constants.ts` `LANG_MAP` (speech recognition), and the name -> short code in `localTranslator.ts` `setLanguages()` and `googleTranslateNMT.ts` `LANG_MAP` (draft translation)
2. Update dropdowns in `SetupPanel.tsx`
(The in-browser Opus draft model only supports Norwegian -> Ukrainian.)

### Modifying LLM Prompts
Edit the `build*` functions in `services/prompts.ts` and the matching parser. Use `tests/prompt-check.ts` to compare models on real phrases.

### Tuning Segmentation
Edit `DEFAULT_SEGMENTER_CONFIG` or the clause-opener sets in `services/segmenter.ts`, then run `tests/segmenter.test.ts`.

### Adding IT Terms
Add entries to `data/it-glossary.json` with term, uk translation, category, and optional inflections.
