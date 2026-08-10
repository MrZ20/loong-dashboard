-- Prompt templates are runtime data. There is no virtual builtin prompt and no
-- preference fallback after this migration. Existing debug bindings/templates
-- are intentionally reset so every task can bind an exact persisted template.
DELETE FROM ai_task_bindings;
DROP TABLE IF EXISTS ai_prompt_preferences;
DROP TABLE IF EXISTS ai_prompt_templates;

CREATE TABLE ai_prompt_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  feature_key TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL CHECK(length(trim(content)) > 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
  is_seed INTEGER NOT NULL DEFAULT 0 CHECK(is_seed IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, feature_key, name),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK(
    (is_seed = 1 AND user_id IS NULL AND is_default = 0) OR
    (is_seed = 0 AND user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX ai_prompt_seed_feature_idx
  ON ai_prompt_templates(feature_key) WHERE is_seed = 1;
CREATE UNIQUE INDEX ai_prompt_default_user_feature_idx
  ON ai_prompt_templates(user_id, feature_key)
  WHERE is_seed = 0 AND is_default = 1;
CREATE INDEX ai_prompt_templates_user_feature_updated_idx
  ON ai_prompt_templates(user_id, feature_key, is_default DESC, updated_at DESC);

INSERT INTO ai_prompt_templates(
  id, user_id, feature_key, name, content, revision,
  is_default, is_seed, created_at, updated_at
) VALUES
  ('seed:pr_triage', NULL, 'pr_triage', 'PR 代码摘要 · 架构定位 v3', '先定位改动所属技术领域、架构层和执行链节点，再解释代码实际采用的实现机制、影响范围、测试覆盖和证据缺口；重点关注 vLLM-Ascend 映射边界与 Review 风险。', 3, 0, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
  ('seed:issue_triage', NULL, 'issue_triage', 'Issue 摘要 · 架构定位 v3', '优先提取模型、硬件、软件版本、并行配置、复现步骤和错误证据；指出疑似所属技术领域和架构层，但必须标记为假设；严格区分事实、报告者猜测和待验证项。', 3, 0, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
  ('seed:pr_deep_analysis', NULL, 'pr_deep_analysis', 'PR 深度评审 · 调用链 v3', '从入口、调用链、关键数据流、设备适配边界到验证入口还原原有与修改后架构路径；审查正确性、兼容性、并发、多卡、缓存与测试覆盖，并给出可定位的代码证据。', 3, 0, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
  ('seed:issue_deep_analysis', NULL, 'issue_deep_analysis', 'Issue 调查分析 · 架构归因 v3', '先把现象映射到可能的技术领域、架构层和执行链节点，再按可能性排序根因假设，逐项给出支持、反对证据和具体验证方法；不能确认根因时明确保留不确定性。', 3, 0, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
  ('seed:vllm_classification', NULL, 'vllm_classification', 'vllm-classification-prompt', '严格服从仓库注册类别与证据优先级；优先解释决定主类别的源码路径，候选接近或证据不足时降低置信度。', 1, 0, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
  ('seed:vllm_ascend_classification', NULL, 'vllm_ascend_classification', 'vllm-ascend-classification-prompt', '严格服从 Ascend 仓库注册类别；将 E2E feature/arch/parallel/graph 证据映射回源码技术域，候选接近时降低置信度。', 1, 0, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
  ('seed:vllm_taxonomy_refresh', NULL, 'vllm_taxonomy_refresh', 'vllm-taxonomy-refresh-prompt', '只补充有近期真实证据支持的路径、关键词和排除规则；避免把 Buildkite area 原样复制成过细类别。', 1, 0, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
  ('seed:vllm_ascend_taxonomy_refresh', NULL, 'vllm_ascend_taxonomy_refresh', 'vllm-ascend-taxonomy-refresh-prompt', '以 CODEOWNERS、源码、测试与 E2E taxonomy 的真实变化为依据；只补充现有类别，新增类别保留为待审核建议。', 1, 0, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
  ('seed:daily_report', NULL, 'daily_report', '社区日报默认', '区分新建、更新、Draft、Ready、合入、关闭和重新打开；把重要变化定位到技术领域、架构节点和活跃路径，说明上游到 Ascend 的影响链，再识别趋势、潜在回归并按优先级给出今日建议。', 2, 0, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
  ('seed:domain_architecture_map', NULL, 'domain_architecture_map', '技术领域架构地图 v2', '以长期可复用的架构介绍为主体：解释领域边界、核心组件职责、执行链、数据流、上游与 Ascend 对应关系以及验证入口；最后单独叠加今日变化，逐条说明变化落在哪个架构节点、影响什么边界、还缺少什么证据。', 2, 0, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
  ('seed:technical_document_generation', NULL, 'technical_document_generation', '技术知识文档默认', '以长期可维护的知识文档为目标，先说明领域边界和架构位置，再整理组件职责、执行链、实现机制、验证入口与风险；保留所有证据缺口，不把推断写成已确认事实。', 1, 0, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
  ('seed:cross_repo_insight', NULL, 'cross_repo_insight', '跨仓库洞察默认', '按“上游架构节点 → Ascend 对应实现 → 变化证据 → 潜在影响”组织信号，识别重大事件、潜在回归、技术趋势与协作窗口；没有本地代码证据时不得声称检查过源码。', 2, 0, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
  ('seed:local_code_insight', NULL, 'local_code_insight', '本地代码洞察默认', '围绕用户选择的重点事项读取最小必要代码范围；把代码事实、社区事实与 AI 推断分开，所有代码结论附可定位引用。', 1, 0, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
  ('seed:chat_assistant', NULL, 'chat_assistant', '社区助手默认', '优先按“技术领域 → 架构组件 → 路径/符号 → 当前变化”的层级回答当前页面、PR/Issue 和社区协作问题；缺少证据时说明需要补充什么。', 2, 0, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
  ('seed:repository_code_chat', NULL, 'repository_code_chat', '仓库只读分析默认', '先确认仓库与 Commit，再按需搜索最小相关路径和调用链；回答附代码引用，不执行写操作或高资源命令。', 1, 0, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z');

INSERT INTO ai_prompt_templates(
  id, user_id, feature_key, name, content, revision,
  is_default, is_seed, created_at, updated_at
)
SELECT
  'default:' || users.id || ':' || seeds.feature_key,
  users.id,
  seeds.feature_key,
  seeds.name,
  seeds.content,
  seeds.revision,
  1,
  0,
  seeds.created_at,
  seeds.updated_at
FROM users
CROSS JOIN ai_prompt_templates AS seeds
WHERE seeds.is_seed = 1;

PRAGMA optimize;
