# Deployment

## Netlify Configuration

Auto-deploy from `main` branch. Config in `netlify.toml`:

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

**Production URL:** https://ghost-interviewer-ai.netlify.app

## Build Commands

```bash
npm run dev       # Dev server on port 3000 (host: 0.0.0.0)
npm run build     # Vite production build -> dist/
npm run preview   # Preview production build locally
```

## Environment Variables

Vite exposes env vars via `import.meta.env`:

```bash
# .env.local (not committed)
GEMINI_API_KEY=...              # Exposed as process.env.GEMINI_API_KEY and process.env.API_KEY

# Azure OpenAI (optional, can use Groq instead)
VITE_AZURE_ENDPOINT=https://jobbot.openai.azure.com
VITE_AZURE_API_KEY=...
VITE_API_VERSION=2024-10-01-preview
VITE_DEPLOYMENT=gpt-5.1-codex-mini

# Groq (optional, key can be entered in UI)
VITE_GROQ_ENDPOINT=https://api.groq.com/openai/v1/chat/completions
VITE_GROQ_API_KEY=...
VITE_GROQ_MODEL=llama-3.3-70b-versatile
```

## Critical: Entry Point

The app loads via a module script in `index.html`:
```html
<script type="module" src="/index.tsx"></script>
```
Without this tag, the app shows a blank page.

## Critical: Import Maps

Dependencies are loaded via CDN import maps in `index.html`, not bundled with the app. Ensure these remain in sync with `package.json`:

```html
<script type="importmap">
{
  "imports": {
    "@google/genai": "https://aistudiocdn.com/@google/genai@^1.30.0",
    "@huggingface/transformers": "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0",
    "react": "https://aistudiocdn.com/react@^19.2.0",
    "react-dom": "https://aistudiocdn.com/react-dom@^19.2.0"
  }
}
</script>
```

## Tailwind CSS

Loaded via CDN script tag (not PostCSS/build-time):
```html
<script src="https://cdn.tailwindcss.com"></script>
```

Custom config (fonts, colors, animations) is defined inline in `index.html` via `tailwind.config`.

## TypeScript

- Target: ES2022
- Module: ESNext with bundler resolution
- `noEmit: true` (Vite handles compilation)
- `allowImportingTsExtensions: true`
- Path alias: `@/*` maps to project root

## No Automated Tests

Manual testing is required. Key test scenarios:
- All three view modes (SIMPLE/FOCUS/FULL)
- Both translation paths (Chrome API vs model-based)
- Both LLM providers (Azure vs Groq)
- Streaming mode toggle
- Stop/restart sessions
- Different languages

## Security Notes

- API keys must never be committed (`.env.local` is gitignored)
- Groq API key stored in localStorage (client-side only)
- No server component - all processing is client-side or via external APIs
- Azure `sanitizeForAzure()` masks phrases that trigger jailbreak detection
