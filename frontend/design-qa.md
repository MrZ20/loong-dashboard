# Design QA

## Evidence

- Light source visual truth: `/Users/lonng/Mrz20/loong-dashboard/frontend/design-qa/theme-references/purity-light.png`
- Dark source visual truth: `/Users/lonng/Mrz20/loong-dashboard/frontend/design-qa/theme-references/recehtok-dark.png`
- Light implementation: `/Users/lonng/Mrz20/loong-dashboard/frontend/design-qa/dashboard-light-viewport.png`
- Dark implementation: `/Users/lonng/Mrz20/loong-dashboard/frontend/design-qa/dashboard-dark-viewport.png`
- Full-view light comparison: `/Users/lonng/Mrz20/loong-dashboard/frontend/design-qa/theme-light-comparison.png`
- Full-view dark comparison: `/Users/lonng/Mrz20/loong-dashboard/frontend/design-qa/theme-dark-comparison.png`
- Focused light sidebar comparison: `/Users/lonng/Mrz20/loong-dashboard/frontend/design-qa/theme-light-sidebar-comparison.png`
- Focused dark dashboard comparison: `/Users/lonng/Mrz20/loong-dashboard/frontend/design-qa/theme-dark-dashboard-comparison.png`
- Desktop viewport: `1280 x 720` CSS px, device scale factor `1`
- All source and implementation viewport captures: `1280 x 720` px
- Full-view comparison canvases: `2560 x 720` px
- Density normalization: no density rescaling in full-view comparisons. Each source and implementation capture is `1280 x 720` at scale `1`.
- State: `vllm-project/vllm-ascend`, Pull Requests, default filters, repository navigation expanded.

The provided RecehTok Figma page was captured directly in the in-app browser. Its selected node was not readable through the structured Figma API, so the dark reference is the visible Figma canvas containing the template cover and embedded dashboard. The provided Purity Figma link redirected to the Figma home page; the light reference is the matching official live Purity UI dashboard.

## Findings

- No actionable P0, P1, or P2 differences remain.
- [P3] The RecehTok reference available from the Figma canvas is a cover composition rather than a clean export of the selected dashboard frame. This limits exact pixel comparison, but its deep indigo surfaces, cyan/violet emphasis, subdued text, and luminous active states are clearly represented in the dark implementation.

## Full-view comparison

- Light theme: the implementation matches Purity's pale gray canvas, white raised cards, teal accent, low-contrast borders, rounded containers, and airy dashboard rhythm. The denser list content is an intentional consequence of the GitHub community-monitoring use case.
- Dark theme: the implementation carries the RecehTok template's deep navy/indigo hierarchy, cyan active controls, violet status accents, and low-glare secondary text. It preserves the product's PR/Issue scanning density instead of copying the crypto chart layout.
- Information architecture: the former horizontal repository tabs are removed. Pull Requests, Issues, and 今日分析 are grouped under each expandable repository in the persistent sidebar, matching the annotated change request.

## Focused-region comparison

- Light sidebar: the focused comparison confirms Purity-like white navigation cards, teal active selection, soft shadows, pale canvas, quiet inactive icons, and rounded group containers.
- Dark dashboard: the focused comparison confirms the RecehTok-like relationship between dark canvas, slightly lighter cards, cyan active accents, violet semantic marks, and bright high-priority text.

## Required fidelity surfaces

- Fonts and typography: both themes use the same system sans-serif stack with stable title, metadata, summary, and control hierarchy. Long PR titles truncate only in list rows and wrap in the detail drawer.
- Spacing and layout rhythm: the permanent `248 px` sidebar, `80 px` header, `32 px` content gutter, `14 px` major card radius, and quiet vertical separators keep the dense community content scannable.
- Colors and visual tokens: light and dark modes are driven by shared semantic tokens rather than isolated overrides. State colors remain semantic in both modes, and theme switching does not alter layout.
- Image quality and asset fidelity: the product screen has no required photography or illustration. All visible interface icons use the existing Primer Octicons package; no handcrafted SVG, emoji, or CSS-drawn assets were introduced.
- Copy and content: repository names, PR/Issue terminology, AI summaries, technical-domain tags, and prompt controls remain coherent in both languages and themes.
- Accessibility: the theme control uses labeled buttons and `aria-pressed`; repository expanders expose `aria-expanded`; focus rings and reduced-motion handling remain in place.

## Interaction verification

- Switched between white and dark themes; the selected mode persists through `localStorage`.
- Expanded both repositories and verified each group exposes Pull Requests, Issues, and 今日分析.
- Switched from PRs to Issues and 今日分析 through the nested sidebar navigation.
- Opened a PR detail drawer in dark mode and verified readable title, body, metadata, and `diff --stat` summary.
- Ran deep AI analysis through loading and result states.
- Checked browser console output: only Vite connection debug messages; no warnings or errors.

## Comparison history

### Iteration 1

- The initial side-by-side comparisons found no actionable P0/P1/P2 mismatch. No visual fix was required after the comparison pass.

## Follow-up polish

- [P3] If the exact RecehTok dashboard frame later becomes available as a clean export, rerun the dark-theme comparison against that node for more precise color and spacing measurements.

final result: passed
