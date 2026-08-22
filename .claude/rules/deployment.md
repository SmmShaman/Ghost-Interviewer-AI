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
# .env.local (optional, not committed) — frontend has NO LLM secrets
VITE_API_URL=https://ghost.vitalii.no     # Worker proxy (default)
VITE_CLAUDE_MODEL=claude-opus-5           # main model (default)
VITE_CLAUDE_MODEL_FAST=claude-haiku-4-5   # fast helper model (default)
```

### Worker secrets (backend/worker)

```bash
cd backend/worker
npx wrangler secret put CLAUDE_CODE_OAUTH_TOKEN   # Claude subscription token from `claude setup-token` (preferred)
# or
npx wrangler secret put ANTHROPIC_API_KEY         # console API key (pay-per-token)
npx wrangler deploy
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
- Claude proxy: streaming answers + fast helper calls
- Streaming mode toggle
- Stop/restart sessions
- Different languages

## Security Notes

- API keys must never be committed (`.env.local` is gitignored)
- No server component - all processing is client-side or via external APIs
- LLM credentials exist only as Cloudflare Worker secrets; the Worker accepts only `claude-*` model ids and requires a Google id token
