# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

## Product-specific direction

- The product is a desktop community intelligence dashboard for `vllm-project/vllm` and `vllm-project/vllm-ascend`.
- Every repository needs dedicated Pull Request, Issue, and AI-generated daily analysis views.
- PR and Issue lists should preserve GitHub's familiar title/meta hierarchy, omit GitHub labels, and add one concise Chinese AI summary plus an AI-generated technical-domain badge.
- Detail views prioritize title, rendered Markdown body, and metadata. Repository synchronization and initial detail loading must not persist or return concrete code patches. Initial PR details use the original light diff viewer style to show the aggregate `git diff --stat` summary plus every changed file path and its added/deleted-line totals. One explicit top-level “获取代码修改” action fetches all eligible file patches in a single request; expanding a file only reveals an already-fetched patch and must never trigger network access. When one file has more than 1000 changed lines (`additions + deletions`), the unified action skips it, its row remains non-expandable, and the UI directs the user to the PR's GitHub Files page. Never hide remaining files behind a summary count.
- A visible deep-analysis action should generate impact, risks, and next-step recommendations from a configurable prompt.
- Daily analysis must expose its prompt, support manual generation, and visibly represent an optional automatic schedule.
- Repository-level Pull Requests, Issues, and daily analysis navigation belongs inside expandable repository groups in the sidebar, not in a horizontal header tab bar.
- Repository PR and Issue lists and sidebar counts represent every record currently persisted by LoongBoard for that repository; do not silently cap the visible list below the amount collected by facts refresh. GitHub's `/issues` endpoint mixes pull requests into its result, so synchronization must filter PRs before storing or counting Issues.
- Community data refresh is split by function, never by data-cost tiers: GitHub facts, AI summaries, classification labels, and deep analysis each own independent persisted configuration, run history, status, errors, and manual actions. Facts may only mark summaries or classifications stale; they must never call AI or reclassify. Deep analysis is always manual.
- Opening PR/Issue lists or details is a read-only D1 operation. It must never request GitHub, call AI, fetch patches, reclassify, or change freshness. The explicit actions “刷新社区事实”, “更新摘要”, “重新分类”, and “开始深度分析” must not trigger one another.
- Facts refresh uses an inclusive GitHub `updated_at` watermark committed only after a successful full run. Equal timestamps may be reread and are deduplicated by `(repo_id, kind, number)`; failed runs leave the successful watermark unchanged.
- GitHub fact-list pagination must follow the API's `Link` header and opaque `after`/`before` cursor rather than constructing deep `page=N` requests. Repository Issues responses include pull requests, so filter them before persistence while retaining one current row per `(repo_id, kind, number)`.
- Cross-repository work belongs in a compact global workbench above repository navigation: a persistent watchlist, upstream-to-Ascend impact tracking, and a technical-domain map.
- AI insights is a standalone global workbench view. It should synthesize PRs, Issues, watchlist items, upstream impact relations, and domain activity into prioritized evidence-backed signals and suggested actions; keep it distinct from repository-specific daily reports.
- AI insights and repository daily reports are versioned Markdown documents with evidence references and reusable prompts, not single summary cards.
- The technical-domain map should preserve a long-lived code-architecture baseline and overlay daily changed paths, related PRs/Issues, risks, and dated snapshots. Keep it mapping-focused; do not expand it into a full task or personal-growth center.
- Technical Markdown documents are stored by technical category and support reading, creating, and editing inside the product.
- AI chat persists multiple independent threads. The standalone page is the conversation manager for creating, resuming, renaming, and deleting threads; the floating window follows the active thread. Both accept page context and selected webpage text so answers can stay grounded in what the maintainer is reading.
- Production authentication uses the hosting platform's authenticated ChatGPT identity. Local development login is allowed only when `ALLOW_DEV_AUTH=true`.
- Settings owns account profiles and AI provider management. Local development may add and switch accounts; each account keeps isolated workspace state and explicit per-task AI bindings. Production account identity and switching remain controlled by ChatGPT authentication.
- AI API tokens configured in Settings stay server-side, are encrypted at rest, and are never returned to the browser. Each account may store several OpenAI-compatible providers and bind one to each AI task; the environment-variable OpenAI-compatible provider remains a non-deletable debugging option.
- GitHub Personal Access Tokens configured in Settings are account-scoped, encrypted at rest, and never returned to the browser. They take precedence over the service-level `GITHUB_TOKEN` for GitHub refresh and explicit patch retrieval; the environment token remains a fallback.
- All configurable AI instructions live in Settings → AI 管理. Each account may keep multiple templates per AI function and activate exactly one; AI providers and prompt choices remain independent. PR/Issue details, daily reports, insights, and chat may link to the relevant setting but must not expose ad-hoc prompt editors. Keep output schemas, evidence rules, and safety constraints in the central server-side prompt catalog as non-editable system contracts, and snapshot the selected template on generated artifacts.
- The desktop sidebar can collapse to an icon-only rail without changing the mobile drawer behavior. Every navigation and settings icon must remain visible in the collapsed state, and the expand/collapse control must stay prominent on the sidebar edge with an unambiguous directional icon.
- Cross-repository impact statuses that imply a final human decision, especially “已适配” and “不适用”, must remain human-confirmed rather than being set automatically by AI.
- Production-like local data starts empty: demo seeds are opt-in, excerpts must be labeled as excerpts, and only successful model output may be labeled as an AI summary.
- “Today” means the Beijing natural day and is calculated from persisted GitHub state events. Duplicate observations of the same transition must not inflate the visible counts.
- Local/LAN authentication requires an administrator password. Local-auth mode must ignore hosting identity headers, and credentials must stay server-side.
- Cross-repository impact records are generated from synchronized items and stable architecture mappings; rule-generated confidence remains visually distinct from human-confirmed adaptation status.
- The interface supports two complete visual themes without changing information architecture: a RecehTok-inspired dark theme with deep indigo surfaces and cyan/violet emphasis, and a Purity UI-inspired light theme with pale canvas, white rounded cards, teal accents, and soft shadows.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/` and service code in `worker/`. Keep `.openai/hosting.json`, `scripts/prepare-sites-build.mjs`, migrations, and `tests/sites-worker.test.mjs` aligned so the same source can be handed to Sites. Before a Sites handoff, run `npm run typecheck`, `npm run build`, and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, `dist/.openai/hosting.json`, and the D1 migrations.

## Architecture boundaries

- Keep `worker/index.ts` as a thin same-origin shell and route manifest. HTTP
  parsing and response shaping belong in `worker/routes/`.
- Route modules must not embed SQL. Put feature data access in
  `worker/repositories/`, orchestration in `worker/services/`, external API
  clients in `worker/integrations/`, and HTTP-independent rules in
  `worker/domain/`.
- D1 migrations in `drizzle/` are the only schema source. Runtime initialization
  may verify migrated tables and seed required records, but must never create or
  alter schema.
- Keep `src/App.vue` focused on shell composition. Shared state and workflows
  belong in feature composables, API calls in feature modules under `src/api/`,
  and global CSS in ordered feature files imported by `src/styles.css`.
- Import the bounded API modules and domain type modules directly. Do not
  reintroduce aggregate facades such as `src/api/client.ts` or `src/types.ts`.
