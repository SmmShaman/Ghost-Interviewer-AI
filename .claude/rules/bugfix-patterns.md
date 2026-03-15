# Bug Fix Patterns

## Blank Page After Deployment
**Cause:** Missing `<script type="module" src="/index.tsx"></script>` in `index.html` body.
**Fix:** Ensure the entry point script tag exists. Without it, React never mounts.

## Azure Jailbreak Detection (Content Filtering)
**Symptom:** Azure API returns 400 with content policy violation.
**Cause:** Imperative phrases like "You are an assistant" or "Act as" trigger Azure's content filter.
**Fix:** `sanitizeForAzure()` in `geminiService.ts` replaces problematic phrases:
- "You are" -> "Task: Provide"
- "Act as" -> "Function:"
- "SYSTEM:" -> "CONTEXT:"

## LLM Tag Leaking Into Translation
**Symptom:** Translation text contains `[/INPUT_TRANSLATION]` or `[INTENT]` fragments.
**Cause:** Streaming captures partial tags before they're fully formed.
**Fix:** `sanitizeTranslationText()` strips all structural tags. Also, `[INTENT]` was added as a delimiter in `parseAndEmit()` regex to prevent intent block leaking into translation.

## LLM Echoing Original Text in Translation
**Symptom:** Translation starts with the original Norwegian text followed by the actual Ukrainian translation.
**Cause:** Some LLMs repeat the source text before translating.
**Fix:** `stripOriginalTextEcho()` detects and removes original text echo from start/end of translation, including partial word-level matching (60% threshold).

## WebGPU Initialization Failure
**Symptom:** Model loading fails with GPU/adapter errors.
**Cause:** WebGPU API may be present but no adapter available (e.g., on VMs or integrated GPUs).
**Fix:** `localTranslator.initialize()` does a real adapter check (`navigator.gpu.requestAdapter()`) before trying WebGPU. Falls back to WASM if adapter is null.

## Model Cache Corruption
**Symptom:** Model loading fails with checksum/corruption errors.
**Cause:** Browser cache (IndexedDB/Cache API) contains corrupted model files.
**Fix:** `clearModelCache()` deletes transformers/onnx entries from both Cache API and IndexedDB. User needs to refresh page to re-download.

## Chrome Translator API Race Condition
**Symptom:** Multiple Chrome translator instances initialized simultaneously.
**Cause:** Rapid calls to `initChromeTranslator()` during startup.
**Fix:** `chromeInitPromise` acts as a lock - subsequent calls await the existing promise instead of starting a new initialization.

## Word Loss During Rapid Speech
**Symptom:** Some spoken words disappear from the transcript.
**Cause:** React state updates can miss words when Speech API fires rapidly.
**Fix:** `pendingWordsRef` in `useStreamingMode.ts` accumulates words via ref (not state). Words are batch-processed on debounce timer so none are lost.

## Speech Recognition Interim Text "Jumping"
**Symptom:** Displayed text changes visibly as speech recognition corrects itself.
**Cause:** Web Speech API updates interim results as it refines recognition.
**Fix:** Hold-N (N=2) hides the last 2 interim words. When `isHoldingWords` is true, layouts show a pulsing indicator. After finalization, full text appears.

## Pivot Translation Too Slow for Ghost
**Symptom:** Ghost translation takes 2-12 seconds when using Pivot (NO>EN>UK).
**Cause:** Running NLLB 600MB model through WASM is slow without WebGPU.
**Fix:** Pivot is disabled for Ghost translation path. Ghost uses direct Opus (56MB, ~200ms). LLM provides quality translation separately. Commit: `99187be`.

## LLM Trigger Delay Too Long
**Symptom:** LLM translation appears too late after interviewer finishes speaking.
**Cause:** Previous config waited for 15 words / 1500ms pause.
**Fix:** Reduced to 8 words / 800ms (`useStreamingMode.ts` defaults). Commit: `d01fb0e`.

## Placeholder Text Leaking Into Display
**Symptom:** "..." or loading placeholders appear in frozen/active translation zones.
**Fix:** Filter placeholder text before displaying in frozen/active zones. Commit: `b150af6`.

## Azure max_tokens vs max_completion_tokens
**Symptom:** Azure API rejects request with parameter error.
**Cause:** `gpt-5.1-codex-mini` deployment requires `max_completion_tokens`, not `max_tokens`.
**Fix:** Use `max_completion_tokens: 4096` in Azure request body. Note: temperature parameter is also not supported by this model (only default=1).

## Groq Token Limit
**Symptom:** Groq returns error about exceeding context length.
**Cause:** Knowledge Base context sent to Groq exceeds its 12k token limit.
**Fix:** Reduced relevant knowledge context to 1500 chars in `constructPrompt()` for Groq compatibility.

## Common Debugging Steps

1. **Translation not working:** Check `localTranslator.getStatus()` in console - shows which method is active (Chrome/Pivot/Direct), model loaded, device (WebGPU/WASM)
2. **LLM not responding:** Check if API key is set (`VITE_AZURE_API_KEY` or Groq key in UI). Check console for "Azure API Error" or "Groq API Error"
3. **Words missing:** Enable metrics via `metricsCollector.logMetrics()` in console - shows received vs displayed word counts and loss rate
4. **Speech not recognized:** Verify Chrome/Edge browser, HTTPS in production, microphone permissions granted
5. **Model download stuck:** Check console for download progress logs. Try clearing cache via DevTools > Application > Cache Storage
