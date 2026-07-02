# Architecture

## Application Flow

```
Landing Page (mode selection)
    -> Start Session (microphone auto-starts)
    -> Speech Recognition (Web Speech API, Delta Tracking)
    -> Block Splitting (silence/word count/punctuation)
    -> Dual Translation:
        Stream 1: Ghost (Chrome API > Opus > NLLB) -> instant display
        Stream 2: LLM Accumulator -> AI Queue -> Azure/Groq -> structured tags -> parsed display
    -> Stop Session (AbortController cancels in-flight LLM)
```

## Core Data Flow

### Speech -> Text (Delta Tracking in App.tsx)

Web Speech API gives full accumulated text on each event. The app extracts only new words:
- `committedWordCountRef`: how many words already processed
- `lastFullTextRef`: previous full text for diff
- `forceCommittedInterimRef`: tracks force-finalized interim words

Triggers for block finalization:
- 1.5s silence (`SILENCE_TIMEOUT_MS`)
- 12 final words (`MAX_WORDS_PER_BLOCK`)
- 20 word overflow (`MAX_WORDS_OVERFLOW`)
- Sentence-ending punctuation with 5+ words

### Ghost Translation (localTranslator.ts)

Priority chain with automatic fallback:
1. **Chrome Translator API** (Chrome 138+) - instant, no model download
2. **Opus model** (`goldcc/opus-mt-no-uk-int8`, 56MB) - fast WASM/WebGPU
3. **NLLB model** (`Xenova/nllb-200-distilled-600M`, 600MB) - multilingual fallback

Post-processing pipeline: `translation -> glossaryProcessor -> confidenceFilter`

Pivot translation (NO>EN>UK) exists in `pivotTranslator.ts` but is disabled for Ghost due to WASM latency (2-12s). Used only for higher-quality translation when needed.

### LLM Translation (geminiService.ts)

LLM accumulator collects words until threshold (6-10 words or 2s pause), then queues for processing:
- `aiQueueRef` stores queue items with question ID, response ID, target message ID
- `isAIProcessingRef` mutex prevents concurrent LLM calls
- `llmAbortControllerRef` cancels in-flight requests on STOP

Structured output uses bracketed tags parsed by `parseAndEmit()`:
```
[INPUT_TRANSLATION]...[/INPUT_TRANSLATION]
[ANALYSIS]...[/ANALYSIS]       # FULL mode only
[STRATEGY]...[/STRATEGY]       # FULL mode only
[TRANSLATION]...[/TRANSLATION]
[ANSWER]...[/ANSWER]
```

Stream processing batches UI updates every 100ms to prevent excessive re-renders.

### Streaming Mode (useStreamingMode.ts)

Advanced hook managing:
- **Hold-N (N=2)**: Hides last 2 interim words to reduce visible speech corrections
- **Frozen Zone**: LLM-translated text that won't change (previous translations locked in)
- **Debounce Accumulation**: pendingWordsRef collects words via ref to prevent loss during rapid updates
- **Forced Finalization**: 1.5s timer commits interim text during continuous speech
- **Intent Classification**: LLM-based (from [INTENT] tag) with heuristic fallback

## State Management

All state in App.tsx via `useState` + `useRef`. No external state library.

- `context` (InterviewContext): Full configuration, persisted to `localStorage` key `ghost_interviewer_context_v2`
- `messages` (Message[]): Conversation history with dual translations
- Refs for real-time data: `aiQueueRef`, `llmAccumulatorRef`, `committedWordCountRef`, etc.

## Singleton Services

All services are singleton instances exported from their modules:
- `localTranslator` - Translation with model management
- `pivotTranslator` - Two-step NO>EN>UK
- `glossaryProcessor` - IT term correction
- `knowledgeSearch` - TF-IDF document search
- `metricsCollector` - Performance tracking
- `streamingAccumulator` - Central text accumulation
- `confidenceFilter` - Translation quality scoring

## Layout Architecture

Each view mode has two layout variants:
- **Standard**: `SimpleModeLayout`, `FocusModeLayout`, `FullModeLayout`
- **Streaming**: `StreamingSimpleModeLayout`, `StreamingFocusModeLayout`, `StreamingFullModeLayout`

Toggle via `useStreamingUI` state (default: true for SIMPLE mode).

## API Integration

### Azure OpenAI
- Endpoint: `VITE_AZURE_ENDPOINT` (default: `https://jobbot.openai.azure.com`)
- Deployment: `VITE_DEPLOYMENT` (default: `gpt-5.1-codex-mini`)
- Uses `max_completion_tokens` (not `max_tokens`)
- `sanitizeForAzure()` masks imperative phrases that trigger content filtering

### Groq
- Model: `llama-3.3-70b-versatile`
- Standard OpenAI-compatible API
- API key entered in UI, stored in context (localStorage)

## Important Patterns

### Session-Level IDs
One `sessionQuestionIdRef` per recording session (Start to Stop). All blocks within a session are treated as one question for LLM context.

### AbortController for STOP
STOP button triggers:
1. `llmAbortControllerRef.current.abort()` - cancels fetch
2. `aiQueueRef.current = []` - clears queue
3. `llmAccumulatorRef` reset - discards buffered text
4. `isAIProcessingRef.current = false` - unlocks mutex

### Import Maps
Dependencies loaded via CDN import maps in `index.html`, not bundled:
- React/ReactDOM from aistudiocdn.com
- HuggingFace Transformers from jsdelivr
- Google GenAI from aistudiocdn.com
