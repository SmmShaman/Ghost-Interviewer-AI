# Bug Fix Patterns

## Blank Page After Deployment
**Cause:** Missing `<script type="module" src="/index.tsx"></script>` in `index.html` body.
**Fix:** Ensure the entry point script tag exists. Without it, React never mounts.

## Every LLM Call Silently Cancelled in Dev
**Symptom:** In `npm run dev` nothing is ever translated or answered, no error shown; production works.
**Cause:** An `AbortController` created once (`useRef(new AbortController())`) and aborted in an effect cleanup stays aborted after React StrictMode's dev double-mount (mount, cleanup, mount), so every fetch gets an already-aborted signal.
**Fix:** Create the controller inside the effect (`useLiveSession`: `abortRef.current = new AbortController()` in the mount effect, abort in its cleanup).

## Phrases Cut at "og" / "så" / "selv"
**Symptom:** Segments end in the middle of a phrase: "react og typescript", "ikke så viktig", "deg selv" are split, giving unreadable translations.
**Cause:** Treating common coordinators/adverbs as clause boundaries.
**Fix:** `services/segmenter.ts`: `så` and `selv` are not boundaries at all; `og`/`eller` (and `and/or/und/oder`) count only when the next word is a subject pronoun ("og vi jobber"); a coordinator at the very end of the hypothesis is undecidable and never cut. Covered by test 9 in `tests/segmenter.test.ts`; add a case there for every new false split.

## Edits Made From WSL Do Not Show Up in the Dev Server
**Symptom:** Code on disk is changed but the browser still runs the old behaviour.
**Cause:** Vite's file watcher does not see edits made from WSL on `/mnt/c` (no inotify events on the Windows drive).
**Fix:** Restart the dev server after changes (`npx vite --force` to also drop the dependency cache) and hard-reload the page.

## LLM Stops Working After an Hour
**Symptom:** Translation/answers work, then every call fails with 401 mid-interview.
**Cause:** Google ID tokens expire after one hour (and each check costs a round trip to Google).
**Fix:** The Worker verifies the Google token once and issues its own 12 h HMAC session token (`POST /api/auth/google`, `issueSessionToken`); `apiClient` stores it in localStorage (`ghost_interviewer_auth_v1`). If the Worker has neither `SESSION_SECRET` nor `AI_INTERNAL_KEY` it issues no session token and the frontend falls back to the Google token (55 min TTL) - set one of them. On 401 the UI asks for a new sign-in and `retryDrafts()` re-translates segments that stayed draft-only.

## LLM Errors Swallowed as Empty Output
**Symptom:** Translation or answer panel stays empty or shows only the machine draft, nothing in the UI says why.
**Cause:** Catching a failed LLM call and returning an empty string looks like "no result".
**Fix:** `streamText` throws `LLMError` (HTTP status or SSE `error`); `translateSegment`/`generateAnswer` also throw on an empty result; `useLiveSession.handleLLMError` sets `llmStatus` (`auth` | `error`) and `llmError`, which `LiveView` shows as a banner. Never return `''` from a failed call.

## Preferred Translation Model Rejected
**Symptom:** Every segment fails with 400/403/404 after changing `VITE_CLAUDE_MODEL_FAST`.
**Cause:** The model id is not served for the account/token.
**Fix:** `translateSegment` switches to `claude-haiku-4-5` for the rest of the session on 400/403/404 (logs a warning); fix the env value. The Worker separately retries once on Haiku after a 429.

## Question Marker Leaking Into Translation
**Symptom:** `@@Q: ...` or a lone `@` appears in the translation text while streaming.
**Cause:** The question line arrives token by token after the translation.
**Fix:** `parseTranslation()` cuts everything from the first `@@` and strips a trailing `@` while the stream is incomplete; the question is extracted only when the stream is complete.

## WebGPU Initialization Failure
**Symptom:** Model loading fails with GPU/adapter errors.
**Cause:** WebGPU API may be present but no adapter available (e.g., on VMs or integrated GPUs).
**Fix:** `localTranslator.loadOpus()` does a real adapter check (`navigator.gpu.requestAdapter()`) before trying WebGPU and falls back to WASM on WebGPU errors.

## Model Cache Corruption
**Symptom:** Opus model loading fails with checksum/corruption errors.
**Cause:** Browser cache (IndexedDB/Cache API) contains corrupted model files.
**Fix:** `clearModelCache()` deletes transformers/onnx entries from both Cache API and IndexedDB. User needs to refresh the page to re-download.

## Chrome Translator API Race Condition
**Symptom:** Multiple Chrome translator instances initialized simultaneously.
**Cause:** Rapid calls to `initChromeTranslator()` during startup.
**Fix:** `chromeInitPromise` acts as a lock - concurrent calls await the existing promise instead of starting a new initialization. `Translator.availability()` can also hang, so checks run under a timeout (`CHROME_CHECK_TIMEOUT_MS`).

## Speech Recognition Stops After a Few Minutes
**Symptom:** Chrome's recognizer ends or hangs silently during a long interview.
**Cause:** Web Speech API sessions end on their own (`onend`, `no-speech`, network errors) and sometimes stop emitting events without any error.
**Fix:** `WebSpeechSource` restarts on `onend` with back-off, a watchdog forces a restart after 6 s without events, and a fresh `MediaStreamTrack` is acquired on every restart. Only fatal errors stop the session and surface in the red banner. Enable `?debug` to watch it.

## Common Debugging Steps

1. **Translation not working:** Look at the status bar in `LiveView`: draft engine (`chrome | nmt | opus | none`), `LLM <status>` and average time to translation. `localTranslator.getStatus()` in the console gives the same engine info.
2. **LLM not responding:** User must be signed in with Google. Banner "LLM is off" = signed out, "session expired" = 401 (sign in again), "LLM error: ..." = message from the Worker/Anthropic. 503 `AI service not configured` = neither `CLAUDE_CODE_OAUTH_TOKEN` nor `ANTHROPIC_API_KEY` is set on the Worker; a 401 from Anthropic = subscription token expired/revoked, regenerate with `claude setup-token`.
3. **Speech not recognized / session stopped:** Open the app with `?debug` for the recognizer overlay (restarts, watchdog, no-speech counts). Verify Chrome/Edge, HTTPS in production, microphone permission and the selected input device.
4. **Test without a microphone:** `npm run dev`, open `/?sim` (dev server only) to replay the scripted Norwegian interview through the whole pipeline.
5. **Slow or wrong segmentation:** `node --experimental-strip-types tests/segmenter.test.ts`; in the console `__logs()` copies the event log (`SEGMENT`, `SEG_TTFT`, `ANSWER_TTFT`, ...).
6. **Translation quality:** `tests/prompt-check.ts` prints prompt cases (JSON lines) to run against different models.
7. **Model download stuck:** Check console for download progress logs. Try clearing cache via DevTools > Application > Cache Storage.
8. **Code change has no effect in dev:** see "Edits Made From WSL" above - restart Vite.
