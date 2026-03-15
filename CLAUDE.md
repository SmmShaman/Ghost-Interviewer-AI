# CLAUDE.md - Ghost Interviewer AI

## Project Overview

Real-time interview assistance app. Transcribes interviewer speech via Web Speech API, translates instantly using in-browser AI models, and generates strategic responses via cloud LLMs. Designed for multilingual job interviews (primary: Norwegian to Ukrainian).

**Production:** https://ghost-interviewer-ai.netlify.app

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript, Vite 6 |
| Styling | Tailwind CSS (CDN with inline config in index.html) |
| Local AI | Hugging Face Transformers.js (WebGPU/WASM) |
| Native Translation | Chrome Translator API (Chrome 138+) |
| Cloud LLM | Azure OpenAI (gpt-5.1-codex-mini) or Groq (Llama 3.3 70B) |
| Speech | Web Speech API (Chrome/Edge) |
| Knowledge Search | TF-IDF (pure TypeScript, no deps) |
| Hosting | Netlify (auto-deploy from main) |

## Quick Start

```bash
npm install
npm run dev       # http://localhost:3000
npm run build     # Production build
npm run preview   # Preview production build
```

**Environment:** Set `GEMINI_API_KEY` in `.env.local`. Azure/Groq keys configured via Vite env vars (`VITE_AZURE_API_KEY`, `VITE_GROQ_API_KEY`, etc.) or entered in the UI.

## Directory Structure

```
App.tsx                        # Main component (1835 lines): state, speech recognition, AI queue
index.tsx                      # React entry point
index.html                     # HTML with Tailwind config, animations, import maps
types.ts                       # Interfaces: InterviewContext, Message, ViewMode, ModeConfig
translations.ts                # i18n (English + Ukrainian)
config/constants.ts            # BLOCK_CONFIG, LLM_CONFIG, defaults, language maps

components/
  LandingPage.tsx              # Mode selection before session start
  SetupPanel.tsx               # Full settings (profiles, models, audio, prompts)
  GearMenu.tsx                 # Quick settings gear during sessions
  BrickRow.tsx                 # Interviewer message row + AI response
  CandidateRow.tsx             # User speech display
  StreamingTextView.tsx        # Streaming text display with animations
  LayeredPhrase.tsx            # Translation overlay (original + translated)
  Icons.tsx                    # SVG icons
  layouts/
    SimpleModeLayout.tsx       # Translation-only 3-column layout
    FocusModeLayout.tsx        # Translation + answer
    FullModeLayout.tsx         # Translation + analysis + strategy + answer
    Streaming*ModeLayout.tsx   # Streaming variants of each layout

services/
  geminiService.ts             # Cloud LLM (Azure/Groq): prompt construction, streaming, tag parsing
  localTranslator.ts           # Local translation: Chrome API > Opus > NLLB fallback chain
  pivotTranslator.ts           # Two-step NO>EN>UK via separate models
  glossaryProcessor.ts         # IT term correction with Ukrainian morphology (160+ terms)
  confidenceFilter.ts          # Heuristic translation quality scoring
  knowledgeSearch.ts           # TF-IDF search over Knowledge Base text
  metricsCollector.ts          # Performance metrics (latency, word loss, cache hits)
  streamingAccumulator.ts      # Central text accumulation service

hooks/
  useStreamingMode.ts          # Streaming translation hook with Hold-N, debounce, forced finalization
  useProgressiveTranslation.ts # Progressive translation state management

data/it-glossary.json          # 160+ IT terms with Ukrainian inflections
```

## Architecture

### Dual-Stream Translation

1. **Ghost (Local/Instant)**: Chrome Translator API > Opus model (56MB) > NLLB (600MB)
   - ~0-200ms latency, runs in-browser
2. **LLM (Cloud/Quality)**: Azure OpenAI or Groq with structured output tags
   - `[INPUT_TRANSLATION]`, `[ANALYSIS]`, `[STRATEGY]`, `[TRANSLATION]`, `[ANSWER]`

### Three View Modes

| Mode | Columns | AI Used | Purpose |
|------|---------|---------|---------|
| SIMPLE | 3 (Ghost + 2x LLM translation) | Ghost + LLM translation only | Pure translation |
| FOCUS | Translation + Answer | Ghost + LLM (translation + answer) | Quick answers |
| FULL | Translation + Analysis + Strategy + Answer | Ghost + full LLM pipeline | Deep analysis |

### Speech Block Processing (Delta Tracking)

Web Speech API returns full accumulated text. Delta tracking extracts only new words:
- `committedWordCountRef` tracks words already committed
- Silence timeout: 1.5s triggers block split
- Max 12 words per final block, 20 word overflow hard limit
- Sentence-ending punctuation with 5+ words triggers split

### Post-Translation Pipeline

`Raw Translation > Glossary Processor > Confidence Filter > Display`

### Profile System

- **CandidateProfile** (static): resume + knowledgeBase
- **JobProfile** (per-application): companyDescription + jobDescription + applicationLetter
- Stored in `localStorage` key `ghost_interviewer_context_v2`

### TF-IDF Knowledge Base

Large text pasted into Knowledge Base is indexed into ~500 char chunks. On each question, top 5 chunks by cosine similarity are sent to LLM (max 1500-3000 chars).

## Key Configuration

```typescript
// config/constants.ts
BLOCK_CONFIG.SILENCE_TIMEOUT_MS = 1500    // Block split on silence
BLOCK_CONFIG.MAX_WORDS_PER_BLOCK = 12     // Final chunk word limit
LLM_CONFIG.MIN_WORDS_FOR_LLM = 6         // Min words before LLM send
LLM_CONFIG.MAX_WORDS_FOR_LLM = 10        // Auto-send threshold

// services/knowledgeSearch.ts
CHUNK_SIZE = 500, CHUNK_OVERLAP = 100, TOP_K = 5, MIN_SCORE = 0.1
```

## LLM Prompt Tags

Parsing in `geminiService.ts parseAndEmit()`. Supports both `[/TAG]` and `</TAG>` closing styles:
- `[INPUT_TRANSLATION]` - Translation of interviewer speech
- `[ANALYSIS]` - Question analysis (FULL mode)
- `[STRATEGY]` - Response strategy (FULL mode)
- `[TRANSLATION]` - Answer in native language
- `[ANSWER]` - Answer in interview language
- `[INTENT]` - Speech classification (streaming mode)

## Styling

- Dark theme: `bg-gray-950` (#030712)
- Red: interviewer/input, Emerald: AI answers, Purple: strategy, Blue: candidate, Amber: simple mode
- Fonts: Inter (sans), JetBrains Mono (mono)
- Custom animations in index.html: fadeInUp, ghostPulse, finalFadeIn, gearSpin, slideInRight, dropDown

## Browser Requirements

Chrome 138+ recommended (native translation + WebGPU + Speech API). Falls back to WASM on other browsers. Firefox has limited Speech API support (behind flag). HTTPS required in production.

## Common Tasks

### Adding a New Language
1. Add NLLB code in `localTranslator.ts` `codeMap` and BCP-47 in `bcp47Map`
2. Add recognition code in `config/constants.ts` `LANG_MAP`
3. Update dropdowns in `SetupPanel.tsx`

### Modifying LLM Prompts
Edit `constructPrompt()` or `constructStreamingPrompt()` in `services/geminiService.ts`. Tag parsing is in `parseAndEmit()`.

### Adding IT Terms
Add entries to `data/it-glossary.json` with term, uk translation, category, and optional inflections.
