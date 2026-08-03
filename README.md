# LoongBoard

LoongBoard is a deployable community intelligence workspace for
`vllm-project/vllm` and `vllm-project/vllm-ascend`. It combines GitHub PR and
Issue tracking, full Markdown and diff reading, evidence-backed AI analysis,
technical architecture maps, a Markdown knowledge base, and contextual chat.

## What is included

- Four independently configured refresh tasks for both repositories: GitHub
  facts (hourly by default), AI summaries (every six hours), classification
  labels (first acquisition by default), and manual-only deep analysis. D1
  stores each task's schedule, last attempt, last success, successful inclusive
  `updated_at` watermark, next run, status, pending count, and recent error.
- Community facts use idempotent `(repository, kind, number)` upserts and an
  inclusive successful watermark. Failed runs never advance that watermark.
  Opening lists or details is database-only and never calls GitHub or AI.
- PR and Issue lists with status, AI technical-domain classification, and
  concise summaries.
- Rendered Markdown bodies plus on-demand `diff --stat` and expandable
  per-file patches. Repository synchronization and initial detail reads do not
  fetch concrete code changes; users request them explicitly from the PR view.
- Versioned daily reports, deep PR/Issue analyses, and cross-repository AI
  insight documents.
- A domain architecture map with a stable baseline, daily changed paths, and
  dated snapshots.
- Categorized technical Markdown documents with an in-app editor.
- Persistent multi-conversation AI chat: create, resume, rename, and delete
  threads from the full page while the floating window follows the active
  thread. Page context and selected text can be attached to a question.
- Account settings with per-account profile, watchlist, chat history, and AI
  provider selection. Local development can add and switch accounts; production
  identity remains managed by the hosting platform.
- Multiple encrypted OpenAI-compatible API configurations per account, with an
  explicit active-provider switch and the environment-variable provider kept as
  a built-in debugging option.
- A per-account prompt center with multiple templates for PR/Issue triage, deep
  analysis, daily reports, cross-repository insights, and chat. Each function
  has one active template, while locked output contracts keep generated JSON and
  Markdown reliable. Generated analyses retain the template name, revision, and
  prompt snapshot used at creation time.
- A desktop sidebar that can collapse to an icon-only rail.
- Light and dark themes.

## Architecture

The application lives in `frontend/`:

- `src/`: Vue 3 application shell composed from feature composables, API
  modules, components, and ordered style modules.
- `worker/routes/`: HTTP parsing, authentication gates, and response shaping.
- `worker/services/`: independent facts, summary, classification, deep-analysis,
  prompt, and refresh-task orchestration.
- `worker/repositories/`: D1 reads and writes for each feature.
- `worker/integrations/`: external GitHub and AI provider clients.
- `worker/domain/`: pure community classification, review-signal, and diff
  logic.
- `drizzle/`: the single authoritative source for the D1 schema.
- `dist/client/`: generated static assets.
- `dist/server/index.js`: generated Worker bundle.

`worker/index.ts` is intentionally a thin same-origin shell. Route handlers do
not embed SQL, domain modules do not depend on HTTP, and the small compatibility
facades preserve existing imports while callers migrate toward the layered
modules.

Production identity is provided by the hosting platform through authenticated
user headers. The application never stores GitHub or AI credentials in the
browser. User-entered AI tokens are encrypted at rest in D1 and are never
returned by the API. Local email login and account switching are available only
when `ALLOW_DEV_AUTH=true`.

## Local development

```bash
cd frontend
npm install
```

Initialize the local D1 database once, then start the service:

```bash
npm run db:migrate:local
npm run dev:service
```

The full service listens on `http://127.0.0.1:4174`. At runtime the Worker
verifies that migrations have been applied and ensures the two configured
repository records exist; it never creates or mutates schema from request
code. Production-like development starts empty, so use the repository sync
action to collect real GitHub data. Sample records are inserted only when
`SEED_DEMO_DATA=true`.

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
| `CREDENTIALS_ENCRYPTION_KEY` | For saved AI providers | Encrypts per-account AI tokens stored in D1 |
| `GITHUB_TOKEN` | Recommended fallback | Service-level GitHub credential used when the current account has no saved Token |
| `ALLOW_DEV_AUTH` | Local only | Enables the signed local development session |
| `LOCAL_ADMIN_PASSWORD` | Local/LAN only | Required password for the local administrator login |
| `SESSION_SECRET` | Local only | Signs the development session cookie |
| `SEED_DEMO_DATA` | No | Enables sample records only in an isolated demo |

The environment-variable OpenAI-compatible configuration remains visible as a
built-in provider in Settings. Users can also save several per-account
OpenAI-compatible providers and choose one as active. If the selected provider
has no usable credential, AI endpoints return an explicit, deterministic
fallback document instead of pretending that a model was called.

Each account can save a GitHub Personal Access Token in Settings → Community
Data Refresh. It is encrypted at rest with the same server-side credential key,
never returned in plaintext, and takes precedence over `GITHUB_TOKEN` for fact
refreshes, summary patch collection, and explicit diff retrieval.

The checked-in `wrangler.toml` password is only for the loopback development
server. Before listening on a LAN address, replace `LOCAL_ADMIN_PASSWORD`,
`SESSION_SECRET`, and `CREDENTIALS_ENCRYPTION_KEY` with independent strong
secrets. Local-auth mode ignores hosting identity headers so LAN clients cannot
impersonate users by sending those headers directly.

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

## Legacy root prototype

The repository root still contains the earlier Python-backed prototype, but it
is not part of the maintained service or its validation path. The current
feature status is tracked in [docs/FEATURES.md](docs/FEATURES.md); the deployable
application described above lives in `frontend/`.
