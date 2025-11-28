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
- **Local AI**: Hugging Face Transformers (`@huggingface/transformers`)
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
│   └── localTranslator.ts      # Local translation service (Opus/NLLB models)
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

### Speech Block Processing

Speech is processed in blocks based on:
- **Silence timeout**: 2 seconds of silence triggers commit
- **Max words**: 25 words force a block split
- **Sentence detection**: Punctuation with 8+ words triggers split

### State Management

- Uses React `useState` and `useRef` for state
- Context stored in `localStorage` with key `ghost_interviewer_context_v2`
- AI processing queue (`aiQueueRef`) ensures sequential processing

## Key Types (types.ts)

```typescript
// View modes control layout and processing depth
type ViewMode = 'FULL' | 'FOCUS' | 'SIMPLE';

// Main context object persisted to localStorage
interface InterviewContext {
  resume: string;
  jobDescription: string;
  companyDescription: string;
  knowledgeBase: string;
  targetLanguage: string;      // Interview language (e.g., "Norwegian")
  nativeLanguage: string;      // User's language (e.g., "Ukrainian")
  viewMode: ViewMode;
  ghostModel: 'opus' | 'nllb';
  llmProvider: 'azure' | 'groq';
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
  SILENCE_TIMEOUT_MS: 2000,    // Split if silence > 2s
  MAX_WORDS_PER_BLOCK: 25,     // Force split at 25 words
  MIN_WORDS_FOR_SENTENCE: 8,   // Only split on punctuation if > 8 words
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

### Local Models (services/localTranslator.ts)
- **Opus**: `goldcc/opus-mt-no-uk-int8` - Fast, quantized, 56MB
- **NLLB**: `Xenova/nllb-200-distilled-600M` - Higher quality, 600MB
- Loaded from Hugging Face CDN on first use

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

- **Required**: Chrome, Edge, or other Chromium-based browsers
- **Reason**: Web Speech API support
- Firefox and Safari have limited or no Web Speech API support
