# LoongBoard

LoongBoard is a deployable community intelligence workspace for
`vllm-project/vllm` and `vllm-project/vllm-ascend`. It combines GitHub PR and
Issue tracking, full Markdown and diff reading, evidence-backed AI analysis,
technical architecture maps, a Markdown knowledge base, and contextual chat.

## What is included

- GitHub synchronization for both repositories, with a cached D1 data model.
- PR and Issue lists with status, AI technical-domain classification, and
  concise summaries.
- Rendered Markdown bodies plus `diff --stat` and expandable per-file patches.
- Versioned daily reports, deep PR/Issue analyses, and cross-repository AI
  insight documents.
- A domain architecture map with a stable baseline, daily changed paths, and
  dated snapshots.
- Categorized technical Markdown documents with an in-app editor.
- A shared AI conversation available as a full page and as a floating window.
  Page context and selected text can be attached to a question.
- Light and dark themes.

## Architecture

The application lives in `frontend/`:

- `src/`: Vue 3 application.
- `worker/`: same-origin API Worker.
- `drizzle/`: D1 migration SQL.
- `dist/client/`: generated static assets.
- `dist/server/index.js`: generated Worker bundle.

Production identity is provided by the hosting platform through authenticated
user headers. The application never stores GitHub or AI credentials in the
browser. Local email login is available only when `ALLOW_DEV_AUTH=true`.

## Local development

```bash
cd frontend
npm install
npm run dev:service
```

The full service listens on `http://127.0.0.1:4174`. On first request it creates
and seeds the local D1 database. The seed data keeps the interface usable before
the first GitHub synchronization.

For frontend-only visual work, `npm run dev` is still available, but API-backed
features require `npm run dev:service`.

## Runtime configuration

Copy `frontend/.env.example` to a local secret source or configure the same
variables in the deployment environment:

| Variable | Required | Purpose |
| --- | --- | --- |
| `AI_API_KEY` | For model output | Server-side API credential |
| `AI_API_BASE_URL` | No | OpenAI-compatible API base URL |
| `AI_API_MODE` | No | `responses` or `chat_completions` |
| `AI_MODEL` | No | Provider model name |
| `GITHUB_TOKEN` | Recommended | Higher rate limits and private-repository access |
| `ALLOW_DEV_AUTH` | Local only | Enables the signed local development session |
| `SESSION_SECRET` | Local only | Signs the development session cookie |

If the AI credential is absent, all AI endpoints return an explicit,
deterministic fallback document instead of pretending that a model was called.

## Validation

```bash
cd frontend
npm run typecheck
npm run build
npm run test:sites
```

The production build bundles the Worker and copies the D1 migration into the
Sites artifact. GitHub raw diff is preferred; if GitHub times out, the service
falls back to the paginated files API so every changed file remains visible and
marks any binary or provider-truncated patch explicitly.
