<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1TCQKSwYRqFQTxRqJpyrrCIJfxi04oHSU

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. LLM credentials are server-side only: set `CLAUDE_CODE_OAUTH_TOKEN` (Claude subscription) or `ANTHROPIC_API_KEY` on the Cloudflare Worker in `backend/worker` (`npx wrangler secret put ...`)
3. Run the app:
   `npm run dev`
