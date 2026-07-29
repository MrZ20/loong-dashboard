# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

## Product-specific direction

- The product is a desktop community intelligence dashboard for `vllm-project/vllm` and `vllm-project/vllm-ascend`.
- Every repository needs dedicated Pull Request, Issue, and AI-generated daily analysis views.
- PR and Issue lists should preserve GitHub's familiar title/meta hierarchy, omit GitHub labels, and add one concise Chinese AI summary plus an AI-generated technical-domain badge.
- Detail views prioritize title, rendered Markdown body, metadata, and a compact `git diff --stat`-like summary. PR details must also list every changed file and provide an expandable full patch; never hide remaining files behind a summary count.
- A visible deep-analysis action should generate impact, risks, and next-step recommendations from a configurable prompt.
- Daily analysis must expose its prompt, support manual generation, and visibly represent an optional automatic schedule.
- Repository-level Pull Requests, Issues, and daily analysis navigation belongs inside expandable repository groups in the sidebar, not in a horizontal header tab bar.
- Cross-repository work belongs in a compact global workbench above repository navigation: a persistent watchlist, upstream-to-Ascend impact tracking, and a technical-domain map.
- AI insights is a standalone global workbench view. It should synthesize PRs, Issues, watchlist items, upstream impact relations, and domain activity into prioritized evidence-backed signals and suggested actions; keep it distinct from repository-specific daily reports.
- AI insights and repository daily reports are versioned Markdown documents with evidence references and reusable prompts, not single summary cards.
- The technical-domain map should preserve a long-lived code-architecture baseline and overlay daily changed paths, related PRs/Issues, risks, and dated snapshots. Keep it mapping-focused; do not expand it into a full task or personal-growth center.
- Technical Markdown documents are stored by technical category and support reading, creating, and editing inside the product.
- The floating AI window and standalone AI page share the same persisted thread. Both accept page context and selected webpage text so answers can stay grounded in what the maintainer is reading.
- Production authentication uses the hosting platform's authenticated ChatGPT identity. Local development login is allowed only when `ALLOW_DEV_AUTH=true`.
- Cross-repository impact statuses that imply a final human decision, especially “已适配” and “不适用”, must remain human-confirmed rather than being set automatically by AI.
- The interface supports two complete visual themes without changing information architecture: a RecehTok-inspired dark theme with deep indigo surfaces and cyan/violet emphasis, and a Purity UI-inspired light theme with pale canvas, white rounded cards, teal accents, and soft shadows.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/` and service code in `worker/`. Keep `.openai/hosting.json`, `scripts/prepare-sites-build.mjs`, migrations, and `tests/sites-worker.test.mjs` aligned so the same source can be handed to Sites. Before a Sites handoff, run `npm run typecheck`, `npm run build`, and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, `dist/.openai/hosting.json`, and the D1 migrations.
