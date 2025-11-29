# CLAUDE.md - Ghost Interviewer AI

This file provides guidance for AI assistants working with this codebase.

## Project Overview

Ghost Interviewer AI is a real-time interview assistance application that:
- Transcribes interviewer speech using Web Speech API
- Provides instant translations using local AI models (Hugging Face Transformers)
- Generates strategic responses using cloud LLMs (Azure OpenAI or Groq)
- Supports multiple view modes (Simple, Focus, Full) for different use cases
- Features a "stealth mode" for discreet usage during video interviews

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
│   ├── SetupPanel.tsx          # Settings sidebar (profiles, models, audio config)
│   ├── BrickRow.tsx            # Main message display row (interviewer + AI response)
│   ├── CandidateRow.tsx        # User's speech display row
│   ├── AnswerCard.tsx          # Legacy answer card component
│   ├── LayeredPhrase.tsx       # Translation display with original/translated layers
│   ├── LayeredWord.tsx         # Word-level translation display
│   └── Icons.tsx               # SVG icon components
├── services/
│   ├── geminiService.ts        # Cloud LLM integration (Azure/Groq API calls)
│   ├── localTranslator.ts      # Local translation service (Opus/NLLB models)
│   └── knowledgeSearch.ts      # TF-IDF search for Knowledge Base
├── hooks/
│   └── useProgressiveTranslation.ts  # Hook for progressive translation states
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

Translation uses a priority-based fallback system:

```
1. Chrome Translator API (Chrome 138+) → Instant, native, no download
2. Transformers.js + WebGPU → 4-5x faster than WASM
3. Transformers.js + WASM → Universal fallback
```

**Models:**
- **Opus**: `goldcc/opus-mt-no-uk-int8` - Fast, quantized, 56MB
- **NLLB**: `Xenova/nllb-200-distilled-600M` - Higher quality, 600MB

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
localTranslator.getStatus()                    // { isReady, useChromeAPI, ... }
```

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
  - All three view modes
  - Both model types (Opus/NLLB)
  - Both LLM providers (Azure/Groq)
  - Stereo audio mode

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
