# CLAUDE.md - Ghost Interviewer AI

This file provides guidance for AI assistants working with this codebase.

## Project Overview

Ghost Interviewer AI is a real-time interview assistance application that:
- Transcribes interviewer speech using Web Speech API
- Provides instant translations using local AI models (Hugging Face Transformers)
- Generates strategic responses using cloud LLMs (Azure OpenAI or Groq)
- Supports multiple view modes (Simple, Focus, Full) for different use cases
- Features an animated gear menu for quick settings access during sessions

## Tech Stack

- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite 6
- **Styling**: Tailwind CSS (CDN with custom config in index.html)
- **Local AI**: Hugging Face Transformers (`@huggingface/transformers`) with WebGPU/WASM
- **Native Translation**: Chrome Translator API (Chrome 138+) - instant, no models
- **Cloud AI**: Azure OpenAI or Groq (Llama 3)
- **Speech Recognition**: Web Speech API (browser-native)
- **Hosting**: Netlify (auto-deploy from main branch)

## Directory Structure

```
/
├── App.tsx                     # Main application component (state, speech recognition, AI queue)
├── index.tsx                   # React entry point
├── index.html                  # HTML template with Tailwind config, animations, and entry script
├── types.ts                    # TypeScript interfaces and types
├── translations.ts             # i18n strings (English and Ukrainian)
├── netlify.toml                # Netlify deployment configuration
├── components/
│   ├── SetupPanel.tsx          # Full settings panel (profiles, models, audio config)
│   ├── GearMenu.tsx            # Animated gear menu with quick settings dropdowns
│   ├── BrickRow.tsx            # Main message display row (interviewer + AI response)
│   ├── CandidateRow.tsx        # User's speech display row
│   ├── AnswerCard.tsx          # Legacy answer card component
│   ├── LayeredPhrase.tsx       # Translation display with original/translated layers
│   ├── LayeredWord.tsx         # Word-level translation display
│   └── Icons.tsx               # SVG icon components
├── services/
│   ├── geminiService.ts        # Cloud LLM integration (Azure/Groq API calls)
│   ├── localTranslator.ts      # Local translation service (multi-method)
│   ├── pivotTranslator.ts      # Two-step translation NO→EN→UK
│   ├── glossaryProcessor.ts    # IT terminology with morphology
│   ├── confidenceFilter.ts     # Translation quality heuristics
│   ├── metricsCollector.ts     # Performance metrics tracking
│   └── knowledgeSearch.ts      # TF-IDF search for Knowledge Base
├── data/
│   └── it-glossary.json        # 160+ IT terms with Ukrainian inflections
├── hooks/
│   ├── useProgressiveTranslation.ts  # Hook for progressive translation states
│   └── useStreamingMode.ts     # Streaming translation with Hold-N
├── package.json                # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration
├── vite.config.ts              # Vite build configuration
└── metadata.json               # App metadata (permissions)
```

## Key Commands

```bash
# Install dependencies
npm install

# Start development server (port 3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Deployment

### Netlify Configuration (netlify.toml)

```toml
[build]
  command = "npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "20"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Critical: Entry Point in index.html

The React app is loaded via a module script in `index.html`:

```html
<body>
  <div id="root"></div>
  <script type="module" src="/index.tsx"></script>
</body>
```

**Important**: Without this script tag, the app will show a blank page!

### Import Maps

The project uses browser import maps for CDN dependencies:

```html
<script type="importmap">
{
  "imports": {
    "@huggingface/transformers": "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0",
    "react": "https://aistudiocdn.com/react@^19.2.0",
    "react-dom": "https://aistudiocdn.com/react-dom@^19.2.0"
  }
}
</script>
```

### Deployment URL

- **Production**: https://ghost-interviewer-ai.netlify.app
- **Auto-deploy**: Enabled from `main` branch

## Architecture Patterns

### Dual-Stream Translation Architecture

The app uses a parallel processing approach:

1. **Stream 1 (Ghost/Local)**: Immediate translation via local Hugging Face models
   - Fast response time (~50-200ms)
   - Runs entirely in browser (no network latency)
   - Models: `goldcc/opus-mt-no-uk-int8` (56MB) or `Xenova/nllb-200-distilled-600M` (600MB)

2. **Stream 2 (AI/Cloud)**: Strategic analysis via cloud LLMs
   - Higher quality translations and contextual responses
   - Provides structured output: `[INPUT_TRANSLATION]`, `[ANALYSIS]`, `[STRATEGY]`, `[ANSWER]`
   - Providers: Azure OpenAI or Groq (Llama 3.3 70B)

### Speech Block Processing (Delta Tracking)

Web Speech API gives **full accumulated text** each time, not deltas. The app uses Delta Tracking to extract only NEW words:

```typescript
// Track how many words already committed
const committedWordCountRef = useRef<number>(0);

// On each speech event:
const allWords = fullText.split(/\s+/);
const newWords = allWords.slice(committedWordCountRef.current);  // Only NEW

// On commit:
committedWordCountRef.current = totalWordCount;  // Update position
```

**Block splitting triggers:**
- **Silence timeout**: 1.5 seconds of silence
- **Max words per block**: 12 words (final chunks)
- **Overflow limit**: 20 words (force split interim)
- **Sentence detection**: Punctuation with 5+ words

### State Management

- Uses React `useState` and `useRef` for state
- Context stored in `localStorage` with key `ghost_interviewer_context_v2`
- AI processing queue (`aiQueueRef`) ensures sequential processing

### TF-IDF Knowledge Base Search (services/knowledgeSearch.ts)

The app uses TF-IDF (Term Frequency-Inverse Document Frequency) to efficiently search large Knowledge Bases instead of sending full text to the LLM.

**How it works:**
1. When user pastes text into Knowledge Base, it's automatically indexed
2. Text is split into ~500 character chunks with 100 char overlap
3. Each chunk is tokenized and TF-IDF scores are calculated
4. When interviewer asks a question, query is matched against chunks using cosine similarity
5. Top 5 most relevant chunks (max 3000 chars) are sent to LLM instead of full KB

**Key functions:**
```typescript
// Index new content (called in App.tsx useEffect)
knowledgeSearch.index(text: string, source: string): void

// Get relevant context for a query (called in geminiService.ts)
knowledgeSearch.getRelevantContext(query: string, maxChars: number): string

// Get stats for UI display
knowledgeSearch.getStats(): { chunks: number; terms: number; isReady: boolean }

// Clear index
knowledgeSearch.clear(): void
```

**Configuration (in knowledgeSearch.ts):**
```typescript
const CHUNK_SIZE = 500;      // Characters per chunk
const CHUNK_OVERLAP = 100;   // Overlap between chunks
const TOP_K = 5;             // Number of top results to return
const MIN_SCORE = 0.1;       // Minimum similarity score threshold
```

**Benefits:**
- Supports large Knowledge Bases (up to 10MB text)
- Reduces token usage by sending only relevant context
- No additional ML models required (pure algorithmic approach)
- Falls back to raw text if no relevant chunks found

### Profile System

The app uses a dual-profile system:

1. **CandidateProfile** (Static - rarely changes):
   - `resume`: Your CV/resume content
   - `knowledgeBase`: Technical docs, project details, skills reference

2. **JobProfile** (Dynamic - per job application):
   - `companyDescription`: Company values, products, culture
   - `jobDescription`: Job requirements, responsibilities
   - `applicationLetter`: Cover letter / Søknad for the position

Profiles are stored in `localStorage` and can be saved/loaded via SetupPanel.

### GearMenu Component (components/GearMenu.tsx)

The GearMenu provides quick access to common settings during active sessions without opening the full SetupPanel.

**Features:**
- Animated gear button with rotation on open
- Horizontal slide-out menu with staggered animations
- Dropdown submenus for each setting category
- Color-coded items (emerald for mode, blue for language, purple for AI, orange for audio)
- Click outside to close

**Menu Items:**
1. **Mode** - Switch between FULL/FOCUS/SIMPLE
2. **Language** - Select interview language (Norwegian, English, German, French)
3. **AI Model** - Choose Azure GPT-4 or Groq Llama 3
4. **Audio** - Toggle stereo mode on/off
5. **Full Settings** - Opens the complete SetupPanel

**Usage in App.tsx:**
```typescript
<GearMenu
  context={context}
  onContextChange={setContext}
  uiLang={uiLang}
  onOpenFullSettings={() => setShowSetup(true)}
/>
```

### Mode-Specific Configuration (ModeConfig)

Each view mode has its own configuration for prompts and AI settings:

```typescript
interface ModeConfig {
  full: {
    aiModel: 'azure' | 'groq';
    strategyDetailLevel: 'brief' | 'detailed' | 'comprehensive';
    translationPrompt: string;
    analysisPrompt: string;
    answerPrompt: string;
  };
  focus: {
    aiModel: 'azure' | 'groq';
    translationPrompt: string;
    answerPrompt: string;
  };
  simple: {
    translationPrompt: string;
    useChromeAPI: boolean;
  };
}
```

**Benefits:**
- Each mode can have different AI models and prompts
- SIMPLE mode can bypass cloud AI entirely with Chrome Translator API
- Users can customize prompts per-mode without affecting other modes

### SetupPanel UX Features

The SetupPanel uses collapsible dropdown sections for organization:

**Visual Feedback:**
- Save buttons show checkmark (✓) animation when profile/prompt is saved
- Progress bar for Knowledge Base size (green → orange → red as it fills)
- Dropdown options show truncated text with full title on hover

**Dropdown Sections:**
1. 🎯 Mode Selection - View mode cards with descriptions
2. 👤 Your Profile - Candidate profiles (Resume, Knowledge Base)
3. 💼 Job Application - Job profiles (Company, Job Description, Application Letter)
4. 🌐 Language Settings - Target and native language selection
5. 🎧 Audio Setup - Microphone selection, stereo mode, audio testing
6. 🧠 Advanced Prompts - Custom prompts and mode-specific prompt editors

## Key Types (types.ts)

```typescript
// View modes control layout and processing depth
type ViewMode = 'FULL' | 'FOCUS' | 'SIMPLE';

// Candidate profile (static data - your info)
interface CandidateProfile {
  id: string;
  name: string;
  resume: string;
  knowledgeBase: string;
}

// Job profile (dynamic data - per application)
interface JobProfile {
  id: string;
  name: string;
  companyDescription: string;
  jobDescription: string;
  applicationLetter: string;   // Søknad
}

// Mode-specific configuration
interface ModeConfig {
  full: ModePrompts & { aiModel: 'azure' | 'groq'; strategyDetailLevel: string };
  focus: ModePrompts & { aiModel: 'azure' | 'groq' };
  simple: { translationPrompt: string; useChromeAPI: boolean };
}

// Main context object persisted to localStorage
interface InterviewContext {
  // Active data (from selected profiles)
  resume: string;
  jobDescription: string;
  companyDescription: string;
  knowledgeBase: string;
  applicationLetter: string;

  // Language settings
  targetLanguage: string;      // Interview language (e.g., "Norwegian")
  nativeLanguage: string;      // User's language (e.g., "Ukrainian")

  // Profile system
  savedCandidateProfiles: CandidateProfile[];
  savedJobProfiles: JobProfile[];
  activeCandidateProfileId: string;
  activeJobProfileId: string;

  // UI & Model config
  viewMode: ViewMode;
  ghostModel: 'opus' | 'nllb';
  llmProvider: 'azure' | 'groq';
  groqApiKey: string;
  modeConfig: ModeConfig;      // Mode-specific prompts and settings
  // ... more fields
}

// Message roles in the conversation
interface Message {
  role: 'interviewer' | 'assistant' | 'candidate';
  text: string;
  ghostTranslation?: string;   // Local model translation
  aiTranslation?: string;      // Cloud model translation
  analysis?: string;           // AI analysis section
  strategy?: string;           // AI strategy section
  // ... more fields
}
```

## Configuration Constants (App.tsx)

```typescript
const BLOCK_CONFIG = {
  SILENCE_TIMEOUT_MS: 1500,       // Split if silence > 1.5s
  MAX_WORDS_PER_BLOCK: 12,        // Split FINAL chunks at 12 words
  MAX_WORDS_OVERFLOW: 20,         // Force split interim at 20 words
  MIN_WORDS_FOR_SENTENCE: 5,      // Allow sentence split after 5 words
  SENTENCE_END_REGEX: /[.!?।।,;:]+$/  // Punctuation detection
};
```

## API Integration

### Azure OpenAI (services/geminiService.ts)
- Endpoint: Configured in `AZURE_ENDPOINT` constant
- Requires API key (removed for security - must be configured)
- Uses streaming responses

### Groq (services/geminiService.ts)
- Model: `llama-3.3-70b-versatile`
- API key entered via UI and stored in context
- OpenAI-compatible API format

### Translation Service (services/localTranslator.ts)

Translation uses a priority-based fallback system with integrated post-processing:

```
Priority Chain:
1. Chrome Translator API (Chrome 138+) → Instant, native, no download
2. Pivot Translation (NO→EN→UK)        → Two-step for better quality
3. Direct Translation (Opus/NLLB)       → Single model, universal fallback

Post-processing Pipeline:
Translation → Glossary Processor → Confidence Filter → Output
```

**Models:**
- **Opus**: `goldcc/opus-mt-no-uk-int8` - Fast, quantized, 56MB
- **NLLB**: `Xenova/nllb-200-distilled-600M` - Higher quality, 600MB, multilingual

**Chrome Translator API (Chrome 138+):**
```typescript
// Check availability
if ('Translator' in window) {
    const translator = await Translator.create({
        sourceLanguage: 'no',
        targetLanguage: 'uk'
    });
    const result = await translator.translate(text);  // Instant!
}
```

**WebGPU Acceleration:**
```typescript
const hasWebGPU = 'gpu' in navigator;
const device = hasWebGPU ? 'webgpu' : 'wasm';  // Auto-detect

await pipeline('translation', modelId, { device });
```

**Key methods:**
```typescript
localTranslator.translatePhraseChunked(text)  // For interim (cached chunks)
localTranslator.translatePhrase(text)          // For finalized blocks
localTranslator.isUsingChromeAPI()             // Check if using native API
localTranslator.getStatus()                    // { isReady, useChromeAPI, pivotReady, usePivot, ... }
```

### Pivot Translation Architecture (services/pivotTranslator.ts)

Two-step translation pipeline for Norwegian → Ukrainian via English intermediate:

```
Norwegian (NO) → [NLLB Model] → English (EN) → [Opus Model] → Ukrainian (UK)
```

**Why Pivot?**
- Direct NO→UK models have limited training data
- English as intermediate leverages higher-quality translation paths
- NO→EN and EN→UK both have excellent model support

**Implementation:**
```typescript
class PivotTranslator {
    // Step 1: Norwegian → English (using NLLB multilingual)
    private async translateNoToEn(text: string): Promise<string> {
        // Uses Xenova/nllb-200-distilled-600M
        // Flores-200 codes: nob_Latn → eng_Latn
    }

    // Step 2: English → Ukrainian (using Opus specialized model)
    private async translateEnToUk(text: string): Promise<string> {
        // Uses Xenova/opus-mt-en-uk
        // Direct bilingual model, higher quality
    }

    // Combined translation
    async translate(norwegianText: string): Promise<PivotResult> {
        const englishText = await this.translateNoToEn(norwegianText);
        const ukrainianText = await this.translateEnToUk(englishText);
        return { originalText, englishText, ukrainianText, method: 'pivot', timings };
    }
}
```

**Caching:**
- English intermediate results are cached
- Avoids re-translating NO→EN for repeated phrases
- Cache key: normalized Norwegian text

**Status:**
```typescript
pivotTranslator.isReady()       // Both models loaded
pivotTranslator.getStatus()     // { noToEnReady, enToUkReady, isReady }
pivotTranslator.initialize()    // Load both models
```

### IT Glossary with Morphology (services/glossaryProcessor.ts)

Post-processing layer that ensures correct Ukrainian translations of IT terminology:

**Problem:** Generic translation models often mistranslate IT terms:
- "framework" → "каркас" (wrong) vs "фреймворк" (correct)
- "deploy" → "розгорнути" (correct but often wrong case)
- "API" → "АПІ" (should stay as "API")

**Solution:** Pattern-based replacement with Ukrainian morphological inflections.

**Glossary Structure (data/it-glossary.json):**
```json
{
  "terms": [
    {
      "en": "framework",
      "uk": "фреймворк",
      "inflections": {
        "nominative": "фреймворк",
        "genitive": "фреймворку",
        "dative": "фреймворку",
        "accusative": "фреймворк",
        "instrumental": "фреймворком",
        "locative": "фреймворку"
      },
      "wrongTranslations": ["каркас", "рамка", "структура"]
    }
  ]
}
```

**Categories (160+ terms):**
- **Core**: framework, API, backend, frontend, database
- **DevOps**: deploy, CI/CD, container, Kubernetes, Docker
- **Interview**: technical interview, code review, whiteboard
- **Frontend**: React, component, state, props, hooks
- **Architecture**: microservices, serverless, event-driven

**Processing Flow:**
```typescript
// After translation, fix IT terms
const processedText = glossaryProcessor.processTranslation(rawTranslation);

// Example:
// Input:  "Ми використовуємо каркас React"
// Output: "Ми використовуємо фреймворк React"
```

**Key methods:**
```typescript
glossaryProcessor.processTranslation(text)  // Fix IT terms in text
glossaryProcessor.loadGlossary(path)        // Load glossary JSON
glossaryProcessor.getStats()                // { termsLoaded, patternsGenerated }
```

### Confidence Filtering (services/confidenceFilter.ts)

Heuristic-based quality assessment for translations (since ML models don't provide confidence scores):

**Heuristics:**
1. **Length ratio** - Translation should be 0.6-1.8x original length
2. **Word count ratio** - Similar word count (0.3-2.5x)
3. **Repetition detection** - Max 50% same word
4. **Ukrainian character check** - Must contain Cyrillic for UK translations
5. **Error markers** - Detect ❌, ⚠️, ⏳ placeholders

**Scoring:**
```typescript
interface ConfidenceResult {
    confidence: number;      // 0-100
    isAcceptable: boolean;   // confidence >= 50
    reasons: string[];       // Why confidence is low
}

// Example usage
const result = calculateConfidence(original, translation);
// { confidence: 85, isAcceptable: true, reasons: [] }

// Low quality example
const badResult = calculateConfidence("Hello world", "Привіт");
// { confidence: 45, isAcceptable: false, reasons: ["Too short (ratio: 0.35)"] }
```

**Configuration:**
```typescript
const CONFIG = {
    MIN_CONFIDENCE_THRESHOLD: 50,  // Below this = low quality
    OPTIMAL_LENGTH_RATIO_MIN: 0.6,
    OPTIMAL_LENGTH_RATIO_MAX: 1.8,
    MAX_REPETITION_RATIO: 0.5,     // Max % of same word
};
```

**Behavior:**
- Logs warnings for low confidence translations
- Returns translation anyway (doesn't block)
- Metrics collector tracks confidence scores

## Styling Conventions

- **Colors**:
  - Red (`red-500`): Interviewer/input
  - Emerald (`emerald-500`): AI answers
  - Purple (`purple-500`): Strategy
  - Blue (`blue-500`): Candidate/user
  - Amber (`amber-500`): Simple mode translation

- **Custom Animations** (defined in index.html):
  - `animate-fade-in-up`: Entry animation
  - `animate-ghost-pulse`: Translation shimmer
  - `animate-final-fade-in`: Final translation reveal

## Environment Variables

```bash
# Required for development
GEMINI_API_KEY=your_key_here  # Set in .env.local
```

Note: The Vite config exposes this as `process.env.GEMINI_API_KEY`.

## Development Guidelines

### Adding New Languages

1. Add language code mapping in `localTranslator.ts`:
```typescript
const codeMap: Record<string, string> = {
  'NewLanguage': 'xxx_Xxxx',  // NLLB Flores-200 code
};
```

2. Add recognition language in `App.tsx`:
```typescript
const langMap: Record<string, string> = {
  'NewLanguage': 'xx-XX',  // BCP 47 language tag
};
```

3. Update dropdowns in `SetupPanel.tsx`

### Adding New View Modes

1. Add type to `types.ts`:
```typescript
export type ViewMode = 'FULL' | 'FOCUS' | 'SIMPLE' | 'NEW_MODE';
```

2. Update grid classes in `BrickRow.tsx`
3. Add translations in `translations.ts`
4. Add UI selector in `SetupPanel.tsx`

### Modifying AI Prompt Structure

The structured output format uses tags:
- `[INPUT_TRANSLATION]` - Translation of input
- `[ANALYSIS]` - Question analysis
- `[STRATEGY]` - Response strategy
- `[TRANSLATION]` - Answer translation
- `[ANSWER]` - Final answer script

Parsing logic is in `parseAndEmit()` in `geminiService.ts`.

## Common Issues

### Blank Page After Deployment
- **Cause**: Missing entry point script in `index.html`
- **Solution**: Ensure `<script type="module" src="/index.tsx"></script>` exists in body

### Model Loading Fails
- Check browser console for CORS errors
- Ensure Hugging Face CDN is accessible
- Try switching to the other model type in settings

### Speech Recognition Not Working
- Chrome/Edge required for Web Speech API
- HTTPS required in production
- Check microphone permissions

### Azure API Errors
- Common cause: Jailbreak detection from imperative prompts
- Solution: The `sanitizeForAzure()` function masks problematic phrases

### Netlify Deploy Issues
- Verify `netlify.toml` exists with correct build command
- Check that `publish` directory is `dist`
- Ensure Node version is set to 20

## Testing Notes

- No automated tests currently in the codebase
- Manual testing recommended with:
  - Different languages
  - All three view modes (SIMPLE/FOCUS/FULL)
  - Both model types (Opus/NLLB)
  - Both LLM providers (Azure/Groq)
  - Stereo audio mode
  - Translation methods:
    - Chrome Translator API (Chrome 138+)
    - Pivot translation (NO→EN→UK)
    - Direct translation (fallback)
  - Streaming optimizations:
    - Hold-N indicator appears during interim
    - Text doesn't "jump" on corrections
    - Long sentences auto-finalize after 1.5s
    - No words lost during rapid speech
  - IT glossary:
    - Technical terms translated correctly
    - Morphological inflections match context
  - Confidence filtering:
    - Low confidence warnings in console
    - Metrics show confidence scores

## Security Considerations

- API keys should never be committed to the repository
- The Azure API key constant is intentionally empty
- Groq API key is stored in localStorage (client-side only)
- No server-side component - all processing is client-side or via external APIs

## Browser Compatibility

| Feature | Chrome 138+ | Chrome 113+ | Edge | Firefox | Safari |
|---------|-------------|-------------|------|---------|--------|
| Web Speech API | ✅ | ✅ | ✅ | ❌ (flag) | ⚠️ Limited |
| Chrome Translator API | ✅ Native | ❌ | ❌ | ❌ | ❌ |
| WebGPU | ✅ | ✅ | ✅ | ⚠️ Flag | ⚠️ Limited |
| WASM SIMD | ✅ | ✅ | ✅ | ✅ | ✅ |

**Recommended**: Chrome 138+ for best experience (native translation + WebGPU + Speech API)

**Fallback chain:**
1. Chrome 138+: Native Translator API (instant)
2. Chrome 113+: WebGPU acceleration (4-5x faster)
3. Any modern browser: WASM (works everywhere)

## Performance Tips

- **Chrome Translator API**: No model download, instant translation
- **WebGPU**: Requires GPU, 4-5x faster than WASM
- **Chunk caching**: Repeated phrases are cached, only new chunks translated
- **Delta tracking**: Only NEW words processed, prevents duplicate commits
- **Pivot caching**: English intermediate results cached for repeated phrases
- **Hold-N (N=2)**: Hides last 2 interim words to reduce visible corrections
- **Debounce accumulation**: Ref-based word collection prevents word loss
- **Direct DOM**: requestAnimationFrame updates bypass React reconciliation
- **Forced finalization**: 1.5s timer commits text during continuous speech
- **Glossary patterns**: Pre-compiled regex patterns for fast IT term replacement

## Landing Page & Session Management

The app now has a dedicated landing page for mode selection before starting a session.

### Session State
```typescript
const [hasSessionStarted, setHasSessionStarted] = useState(false); // Landing vs Working view
```

### Landing Page Flow
1. App loads → Shows `renderLandingPage()` with mode selection cards
2. User clicks mode (SIMPLE/FOCUS/FULL) → `startSessionWithMode(mode)` is called
3. Mode is set, `hasSessionStarted = true`, microphone auto-starts
4. Working view is displayed with selected mode

### Back to Landing
- Home button in header returns to landing page
- Calls `stopListening()`, `setHasSessionStarted(false)`, `setMessages([])`

```typescript
const startSessionWithMode = (mode: 'SIMPLE' | 'FOCUS' | 'FULL') => {
  setContext({...context, viewMode: mode});
  setHasSessionStarted(true);
  setTimeout(() => {
    if (recognitionRef.current && isModelReady) {
      startListening();
    }
  }, 100);
};
```

## LLM Request Cancellation (AbortController)

The STOP button now properly cancels all pending LLM requests using AbortController.

### Implementation
```typescript
// Ref for abort controller
const llmAbortControllerRef = useRef<AbortController | null>(null);

// In processAIQueue - create controller before request
llmAbortControllerRef.current = new AbortController();
const signal = llmAbortControllerRef.current.signal;

// Pass signal to LLM service
await generateInterviewAssist(messageText, [], context, onUpdate, signal);

// In stopListening - abort everything
if (llmAbortControllerRef.current) {
    llmAbortControllerRef.current.abort();
    llmAbortControllerRef.current = null;
}
aiQueueRef.current = [];  // Clear queue
llmAccumulatorRef.current = { text: '', wordCount: 0, questionId: null, responseId: null };
```

### geminiService.ts Changes
- `generateInterviewAssist()` accepts optional `signal?: AbortSignal`
- `generateViaAzure()` and `generateViaGroq()` pass signal to fetch
- `processStream()` checks `signal.aborted` before each chunk read
- AbortError is re-thrown and handled gracefully

### What STOP Does
1. Aborts current in-flight LLM request
2. Clears LLM queue (no more pending requests)
3. Discards LLM accumulator (doesn't flush remaining text)
4. Resets processing flag

## SIMPLE Mode Three-Column Layout

SIMPLE mode displays a three-column layout for translation-focused use:

### Column Structure
```
┌─────────────────┬─────────────────────┬─────────────────────┐
│  COLUMN 1       │  COLUMN 2           │  COLUMN 3           │
│  Ghost Blocks   │  LLM Переклад       │  LLM Переклад       │
│  (Scrollable)   │  (Поточний)         │  (Full Copy)        │
├─────────────────┼─────────────────────┼─────────────────────┤
│  Original +     │  Current LLM        │  Same as Column 2   │
│  Ghost          │  translation from   │  (larger view)      │
│  translation    │  firstSessionMsg    │                     │
└─────────────────┴─────────────────────┴─────────────────────┘
```

### Column Details
- **Column 1 (Left)**: Scrollable list of interviewer blocks with Ghost translation
- **Column 2 (Center)**: LLM translation from `firstSessionMessageIdRef` - orange border
- **Column 3 (Right)**: Same LLM translation, larger view - emerald border

### Session Message Tracking
```typescript
const firstSessionMessageIdRef = useRef<string | null>(null);

// Set on first block of session
if (!firstSessionMessageIdRef.current) {
    firstSessionMessageIdRef.current = newMessageId;
}

// LLM translation updates this message
if (msg.id === firstSessionMessageIdRef.current) {
    return { ...msg, aiTranslation: partial.inputTranslation };
}
```

## LLM Accumulator Pattern

The app accumulates text before sending to LLM for more coherent translations.

### Accumulator Structure
```typescript
const llmAccumulatorRef = useRef<{
  text: string;           // Accumulated text
  wordCount: number;      // Total words accumulated
  questionId: string | null;
  responseId: string | null;
}>({ text: '', wordCount: 0, questionId: null, responseId: null });
```

### Configuration
```typescript
const LLM_ACCUMULATOR_CONFIG = {
  MAX_WORDS: 50,           // Send when accumulated 50 words
  PAUSE_TIMEOUT_MS: 2000,  // Or after 2s silence
};
```

### Flow
1. Speech block finalized → `addToLLMAccumulator(text, questionId, responseId)`
2. Accumulator collects words until MAX_WORDS or PAUSE_TIMEOUT
3. `sendLLMAccumulator()` → Enqueues accumulated text to AI queue
4. Queue processes → Updates `firstSessionMessageIdRef` message with translation

## SIMPLE Mode Prompt (geminiService.ts)

SIMPLE mode uses a minimal translation-only prompt:

```typescript
if (isSimpleMode) {
    return `Переклади наступний текст на розмовну ${context.nativeLanguage} мову.

Вхідний текст (${context.targetLanguage}): "${currentInput}"

Формат відповіді:
[INPUT_TRANSLATION]
твій переклад тут`;
}
```

This skips all context (Resume, Job, KB) and only requests translation.

## Streaming Mode Optimizations (hooks/useStreamingMode.ts)

Advanced real-time translation with multiple optimization techniques:

### Hold-N (N=2) - Word Hiding

Hides the last N words from interim display to reduce visible corrections:

```typescript
const HOLD_N = 2;  // Hide last 2 words

// Example:
// Speech: "Kan du fortelle meg om din erfaring"
// Interim shows: "Kan du fortelle meg om din" (hides "erfaring")
// After finalization: Full text appears
```

**Why Hold-N?**
- Speech recognition often corrects recent words
- Hiding last 2 words prevents visible "jumping"
- Creates smoother reading experience

**UI Indicator:**
- When words are being held, `isHoldingWords` prop is true
- Layouts show "..." or pulsing indicator

### Debounce Accumulation (pendingWordsRef)

Prevents word loss during rapid speech recognition updates:

```typescript
const pendingWordsRef = useRef<string[]>([]);

// On speech update:
pendingWordsRef.current.push(...newWords);

// On debounce timer:
const wordsToProcess = [...pendingWordsRef.current];
pendingWordsRef.current = [];
processWords(wordsToProcess);
```

**Problem Solved:**
- Web Speech API fires rapidly during speech
- React state updates can miss words
- Ref accumulation ensures no words are lost

### Forced Finalization (1.5s Timer)

Forces text commit during continuous speech:

```typescript
const FORCED_FINALIZATION_MS = 1500;

// Timer resets on each new word
// If no new words for 1.5s, force finalize current interim
useEffect(() => {
    const timer = setTimeout(() => {
        if (interimText) {
            finalizeCurrentBlock();
        }
    }, FORCED_FINALIZATION_MS);
    return () => clearTimeout(timer);
}, [interimText]);
```

**Triggers:**
- 1.5s silence during speech
- 12+ words in current block
- Sentence-ending punctuation detected

### Direct DOM Rendering

Uses refs + requestAnimationFrame instead of React state for smoother updates:

```typescript
const translationRef = useRef<HTMLDivElement>(null);

// Update DOM directly, bypassing React reconciliation
const updateTranslation = (text: string) => {
    if (translationRef.current) {
        requestAnimationFrame(() => {
            translationRef.current!.textContent = text;
        });
    }
};
```

**Benefits:**
- No React re-render on every word
- 60fps smooth text updates
- Reduced CPU usage during speech

### Scroll Anchoring

Keeps translation in view as text grows:

```typescript
const scrollContainerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
    if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
}, [translationText]);
```

## Metrics Collection (services/metricsCollector.ts)

Performance tracking for translation pipeline:

### Collected Metrics

```typescript
interface TranslationMetrics {
    // Timing
    translationTimeMs: number;     // Time to translate
    totalProcessingTimeMs: number; // End-to-end time

    // Quality
    confidenceScore: number;       // From confidence filter
    wordCount: number;
    characterCount: number;

    // Method used
    translationMethod: 'chrome' | 'pivot' | 'direct';
    modelUsed: string;

    // Errors
    errors: string[];
    retryCount: number;
}
```

### Aggregated Statistics

```typescript
metricsCollector.getStats(): {
    totalTranslations: number;
    averageTimeMs: number;
    averageConfidence: number;
    methodBreakdown: { chrome: number; pivot: number; direct: number };
    errorRate: number;
}
```

### Integration Points

```typescript
// In useStreamingMode.ts
import { metricsCollector } from '../services/metricsCollector';

// Track each translation
const startTime = performance.now();
const result = await localTranslator.translatePhrase(text);
const endTime = performance.now();

metricsCollector.record({
    translationTimeMs: endTime - startTime,
    wordCount: text.split(/\s+/).length,
    translationMethod: localTranslator.getStatus().useChromeAPI ? 'chrome' : 'direct',
    // ...
});
```

## Translation Method UI Indicator

All three layout components display the current translation method:

```typescript
const getTranslationMethodLabel = () => {
    const status = localTranslator.getStatus();
    if (status.useChromeAPI) {
        return { label: 'Chrome API', bgClass: 'bg-blue-400', textClass: 'text-blue-400' };
    }
    if (status.pivotReady && status.usePivot) {
        return { label: 'Pivot NO→EN→UK', bgClass: 'bg-purple-400', textClass: 'text-purple-400' };
    }
    return { label: 'Direct', bgClass: 'bg-cyan-400', textClass: 'text-cyan-400' };
};
```

**Colors:**
- **Blue**: Chrome Translator API (native, instant)
- **Purple**: Pivot Translation (NO→EN→UK)
- **Cyan**: Direct Translation (single model)

**Location:**
- SIMPLE mode: Bottom stats bar
- FOCUS mode: Bottom stats bar
- FULL mode: Answer section header
