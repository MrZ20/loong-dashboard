# LoongBoard

LoongBoard is a deployable community intelligence workspace for
`vllm-project/vllm` and `vllm-project/vllm-ascend`. It combines GitHub PR and
Issue tracking, full Markdown and diff reading, evidence-backed AI analysis,
technical architecture maps, a Markdown knowledge base, and contextual chat.

## What is included

- GitHub synchronization for both repositories, with a cached D1 data model.
  Sidebar counts describe the bounded recent snapshot stored by LoongBoard,
  rather than GitHub's repository-wide open backlog.
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
- A desktop sidebar that can collapse to an icon-only rail.
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
browser. User-entered AI tokens are encrypted at rest in D1 and are never
returned by the API. Local email login and account switching are available only
when `ALLOW_DEV_AUTH=true`.

## Local development

```bash
cd frontend
npm install
npm run dev:service
```

The full service listens on `http://127.0.0.1:4174`. On first request it creates
the local D1 schema and the two configured repository records. Production-like
development starts empty; use the repository sync action to collect real GitHub
data. Sample records are inserted only when `SEED_DEMO_DATA=true`.

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
| `GITHUB_TOKEN` | Recommended | Higher rate limits and private-repository access |
| `ALLOW_DEV_AUTH` | Local only | Enables the signed local development session |
| `LOCAL_ADMIN_PASSWORD` | Local/LAN only | Required password for the local administrator login |
| `SESSION_SECRET` | Local only | Signs the development session cookie |
| `SEED_DEMO_DATA` | No | Enables sample records only in an isolated demo |

The environment-variable OpenAI-compatible configuration remains visible as a
built-in provider in Settings. Users can also save several per-account
OpenAI-compatible providers and choose one as active. If the selected provider
has no usable credential, AI endpoints return an explicit, deterministic
fallback document instead of pretending that a model was called.

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

The repository root also contains the earlier Python-backed prototype. Its
feature backlog remains in [docs/FEATURES.md](docs/FEATURES.md), and it can be
started with the root-level `npm run dev` after installing
`requirements.txt` in `.venv`. The maintained deployable application described
above lives in `frontend/`.
