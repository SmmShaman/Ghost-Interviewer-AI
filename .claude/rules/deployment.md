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
npm run dev       # Dev server on port 3000 (host: 0.0.0.0); `/?sim` = scripted interview, `/?debug` = recognizer overlay
npm run build     # Vite production build -> dist/
npm run preview   # Preview production build locally
```

The dev server also hosts `/api/debug-logs` (writes `debug-logs.txt`, used by `debugLogger`). Vite does not see edits made from WSL on `/mnt/c`: restart it (`npx vite --force`) after changes.

## Environment Variables

Vite exposes env vars via `import.meta.env`:

```bash
# .env.local (optional, not committed) — frontend has NO LLM secrets
VITE_API_URL=https://ghost.vitalii.no     # Worker proxy (default)
VITE_GOOGLE_CLIENT_ID=...                 # Google Sign-In (without it the sign-in button is not available)
VITE_CLAUDE_MODEL=claude-opus-5           # main model: answers + briefing (default)
VITE_CLAUDE_MODEL_FAST=claude-sonnet-5-5  # live translation model (default; falls back to claude-haiku-4-5 if rejected)
VITE_GOOGLE_TRANSLATE_KEY=...             # optional: direct Google NMT for drafts (otherwise via the Worker when signed in)
```

### Worker secrets (backend/worker)

```bash
cd backend/worker
npx wrangler secret put CLAUDE_CODE_OAUTH_TOKEN   # Claude subscription token from `claude setup-token` (preferred)
# or
npx wrangler secret put ANTHROPIC_API_KEY         # console API key (pay-per-token)
npx wrangler secret put SESSION_SECRET            # HMAC key for 12 h session tokens (falls back to AI_INTERNAL_KEY)
npx wrangler secret put GOOGLE_TRANSLATE_KEY      # draft translation proxy /api/translate
npx wrangler secret put DATABASE_URL              # Neon, profile/session API
npx wrangler secret put AI_INTERNAL_KEY           # optional: server-to-server access via X-Internal-Key
npx wrangler deploy
```

Without `SESSION_SECRET` and `AI_INTERNAL_KEY` the Worker issues no session token and the app falls back to Google ID tokens, which expire after an hour (the LLM then dies mid-interview). The Worker route is `ghost.vitalii.no` (`wrangler.toml`). Deploy the Worker before the frontend when the request format changes (`cacheSystem`, `config.thinking`): an older Worker ignores them and runs live translation with thinking and without prompt caching.

## Critical: Entry Point

The app loads via a module script in `index.html`:
```html
<script type="module" src="/index.tsx"></script>
```
Without this tag, the app shows a blank page.

## Critical: Import Maps

`index.html` declares an import map for the CDN-hosted dependencies. Keep it in sync with `package.json`:

```html
<script type="importmap">
{
  "imports": {
    "@huggingface/transformers": "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0",
    "react-dom/client": "https://aistudiocdn.com/react-dom@^19.2.0/client",
    "react-dom": "https://aistudiocdn.com/react-dom@^19.2.0",
    "react/": "https://aistudiocdn.com/react@^19.2.0/",
    "react": "https://aistudiocdn.com/react@^19.2.0",
    "react-dom/": "https://aistudiocdn.com/react-dom@^19.2.0/"
  }
}
</script>
```

The Google Identity script (`https://accounts.google.com/gsi/client`) is also loaded from `index.html`.

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
- `backend` and `harness` are excluded from the root `tsconfig.json`

## Tests

There are no automated UI tests; manual testing is required. Available checks:

```bash
node --experimental-strip-types tests/segmenter.test.ts   # segmentation unit tests (exit with failures listed as FAIL)
node --experimental-strip-types tests/prompt-check.ts     # prints translation prompt cases for manual model comparison
```

Key manual scenarios:
- All three modes (SIMPLE/FOCUS/FULL), including switching mode mid-session
- `/?sim` end-to-end run (segments, drafts, LLM translation, question detection, answers)
- Both draft paths (Chrome Translator vs NMT/Opus model)
- Briefing generation, reuse, and "stale" state after editing documents
- Space (I am speaking) and Enter (answer last remark)
- Stop/restart sessions, clear session
- Sign-out / session expiry banner and re-sign-in
- Different languages

## Security Notes

- API keys must never be committed (`.env.local` is gitignored)
- No server component in the frontend - processing is client-side or via the Worker
- LLM credentials exist only as Cloudflare Worker secrets; the Worker accepts only `claude-*` model ids and requires an app session token, a Google ID token, or the internal key
