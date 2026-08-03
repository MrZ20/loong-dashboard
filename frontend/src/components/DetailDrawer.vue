<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type {
  AnalysisDocument,
  CommunityItem,
  LocalAnalysisEvent,
  LocalAnalysisJob,
  PromptFeatureKey,
  RefreshTaskType,
} from "../types";
import DiffViewer from "./DiffViewer.vue";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import Octicon from "./Octicon.vue";

const props = defineProps<{
  item: CommunityItem;
  watched: boolean;
  analysis?: AnalysisDocument | null;
  analyzing?: boolean;
  diffLoading?: boolean;
  taskLoading?: RefreshTaskType | "";
  localJob?: LocalAnalysisJob | null;
  localEvents?: LocalAnalysisEvent[];
}>();

const emit = defineEmits<{
  close: [];
  "toggle-watch": [item: CommunityItem];
  analyze: [item: CommunityItem, requirement: string];
  "manage-prompt": [feature: PromptFeatureKey];
  "load-diff": [item: CommunityItem];
  "refresh-facts": [item: CommunityItem];
  "update-summary": [item: CommunityItem];
  reclassify: [item: CommunityItem];
  "cancel-analysis": [];
}>();
const drawer = ref<HTMLElement | null>(null);
const analysisRequirement = ref("");
const analysisMd = computed(() => props.analysis?.contentMd || "");

const stateLabel = computed(() => {
  if (props.item.lastEventType === "reopened") return "Reopened";
  const labels = {
    open: "Open",
    merged: "Merged",
    closed: "Closed",
    draft: "Draft",
  };
  return labels[props.item.state];
});
const domainSourceLabel = computed(() => {
  const source = props.item.domainAssessment?.source;
  if (source === "files") return "修改文件";
  if (source === "files+text") return "修改文件 + 文本";
  if (source === "ai") return "AI";
  if (source === "fallback") return "未命中规则";
  return "标题与正文";
});
const confidenceText = computed(() => {
  const assessment = props.item.domainAssessment;
  if (!assessment) return "置信度待计算";
  const label = {
    high: "高置信度",
    medium: "中置信度",
    low: "低置信度",
  }[assessment.confidenceLabel];
  return `${label} · ${Math.round(assessment.confidence * 100)}%`;
});
const reviewActionIcon = computed(() => {
  const action = props.item.reviewSignal?.action;
  if (action === "ready") return "check-circle";
  if (action === "attention") return "alert";
  if (action === "blocked") return "x-circle";
  if (action === "waiting") return "clock";
  return "info";
});
const ciText = computed(() => {
  const signal = props.item.reviewSignal;
  if (!signal || signal.ciStatus === "unknown") return "尚未获取";
  if (signal.ciStatus === "success") return `${signal.checks.passed} 项通过`;
  if (signal.ciStatus === "failure") return `${signal.checks.failed} 项失败`;
  return `${signal.checks.pending} 项运行中`;
});
const mergeabilityText = computed(() => {
  const value = props.item.reviewSignal?.mergeability;
  if (value === "mergeable") return "可以合并";
  if (value === "conflicting") return "存在冲突";
  return "GitHub 计算中";
});
const reviewDecisionText = computed(() => {
  const value = props.item.reviewSignal?.reviewDecision;
  if (value === "approved") return "已批准";
  if (value === "changes_requested") return "要求修改";
  if (value === "review_required") return "等待 Review";
  return "尚无明确结论";
});

function detailTime(value: string | null | undefined) {
  if (!value) return "尚无记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortSha(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "无";
}

function evidenceLabel(value: string | null | undefined) {
  return {
    complete: "证据完整",
    partial: "证据部分完整",
    insufficient: "证据不足",
  }[value || "insufficient"] || "证据不足";
}

const summaryStatusText = computed(() => ({
  missing: "缺失",
  queued: "已排队",
  running: "生成中",
  ready: "可用",
  stale: "已过期",
  failed: "失败",
}[props.item.summaryStatus || "missing"]));

const classificationStatusText = computed(() => ({
  missing: "尚未分类",
  ready: "当前版本",
  possibly_stale: "可能过期",
  failed: "失败",
}[props.item.classificationStatus || "missing"]));

onMounted(() => drawer.value?.focus());
</script>

<template>
  <div class="drawer-backdrop" @click.self="emit('close')">
    <aside
      ref="drawer"
      class="detail-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="社区条目详情"
      tabindex="-1"
      @keydown.esc="emit('close')"
    >
      <div class="detail-drawer__topbar">
        <span>{{ item.repo === "vllm" ? "vllm-project/vllm" : "vllm-project/vllm-ascend" }} #{{ item.id }}</span>
        <div>
          <button
            class="icon-button"
            :class="{ 'detail-watch--active': watched }"
            :aria-label="watched ? '取消关注' : '加入关注'"
            :title="watched ? '取消关注' : '加入关注'"
            @click="emit('toggle-watch', item)"
          >
            <Octicon :name="watched ? 'star-fill' : 'star'" :size="17" />
          </button>
          <a
            v-if="item.htmlUrl"
            class="icon-button"
            :href="item.htmlUrl"
            target="_blank"
            rel="noreferrer"
            aria-label="在 GitHub 打开"
          >
            <Octicon name="link-external" :size="17" />
          </a>
          <button class="icon-button" aria-label="关闭详情" @click="emit('close')">
            <Octicon name="x" :size="19" />
          </button>
        </div>
      </div>

      <div class="detail-drawer__scroll">
        <header class="detail-heading">
          <div class="detail-heading__state" :data-state="item.state">
            <Octicon
              :name="
                item.kind === 'issue'
                  ? item.state === 'closed'
                    ? 'issue-closed'
                    : 'issue-opened'
                  : item.state === 'merged'
                    ? 'git-merge'
                    : item.state === 'closed'
                      ? 'git-pull-request-closed'
                      : item.state === 'draft'
                        ? 'git-pull-request-draft'
                        : 'git-pull-request'
              "
              :size="15"
            />
            {{ stateLabel }}
          </div>
          <h2>{{ item.title }}</h2>
          <p>
            <strong>{{ item.author }}</strong>
            {{ item.kind === "pr" ? "提交了这个 Pull Request" : "创建了这个 Issue" }} · {{ item.time }}
          </p>
          <div class="detail-heading__tags">
            <span class="domain-badge" :data-domain="item.domain">
              <Octicon name="file-directory" :size="12" />
              {{ domainSourceLabel }} · {{ item.domain }}
            </span>
            <span v-if="item.important" class="important-marker">
              <Octicon name="flame" :size="13" />
              今日重点
            </span>
          </div>
        </header>

        <section class="detail-section detail-refresh-state">
          <div class="detail-section__title">
            <h3>数据版本与刷新</h3>
            <span>打开详情仅从数据库读取</span>
          </div>
          <div class="detail-version-grid">
            <article>
              <span>GitHub 事实</span>
              <strong>{{ detailTime(item.factsRefreshedAt) }}</strong>
              <small>Head {{ shortSha(item.headSha) }}</small>
            </article>
            <article :data-status="item.summaryStatus">
              <span>摘要</span>
              <strong>{{ summaryStatusText }}</strong>
              <small>Head {{ shortSha(item.summaryVersion?.headSha) }} · {{ item.summaryVersion?.promptVersion || '无 Prompt 版本' }}</small>
              <small>{{ item.summaryVersion?.model || '无模型记录' }} · {{ item.summaryVersion?.provider || '无 Provider 记录' }} · {{ evidenceLabel(item.summaryVersion?.evidenceCompleteness) }}</small>
            </article>
            <article :data-status="item.classificationStatus">
              <span>分类</span>
              <strong>{{ classificationStatusText }}</strong>
              <small>Head {{ shortSha(item.classificationVersion?.headSha) }} · {{ detailTime(item.classificationVersion?.generatedAt) }}</small>
              <small>{{ item.domainAssessment?.taxonomyVersion || '无 Taxonomy 版本' }} · 置信度 {{ Math.round((item.domainAssessment?.confidence || 0) * 100) }}%</small>
            </article>
            <article :data-status="item.deepAnalysisStatus">
              <span>深度分析</span>
              <strong>{{ item.deepAnalysisStatus === 'outdated' ? '基于旧版本' : item.deepAnalysisStatus === 'ready' ? '当前版本' : item.deepAnalysisStatus === 'failed' ? '失败' : '尚未生成' }}</strong>
              <small>Head {{ shortSha(item.deepAnalysisHeadSha) }}</small>
            </article>
          </div>
          <div class="detail-refresh-actions">
            <button
              class="button button--secondary"
              :disabled="Boolean(taskLoading) || analyzing"
              @click="emit('refresh-facts', item)"
            >
              <Octicon name="sync" :size="14" :class="{ spinning: taskLoading === 'facts' }" />刷新社区事实
            </button>
            <button
              class="button button--secondary"
              :disabled="Boolean(taskLoading) || analyzing"
              @click="emit('update-summary', item)"
            >
              <Octicon name="copilot" :size="14" :class="{ spinning: taskLoading === 'summary' }" />更新摘要
            </button>
            <button
              class="button button--secondary"
              :disabled="Boolean(taskLoading) || analyzing"
              @click="emit('reclassify', item)"
            >
              <Octicon name="tag" :size="14" :class="{ spinning: taskLoading === 'classification' }" />重新分类
            </button>
          </div>
        </section>

        <section v-if="item.kind === 'pr' && item.reviewSignal" class="detail-section review-signals">
          <div class="detail-section__title">
            <h3>PR Review 信号</h3>
            <span>
              {{ item.reviewSignal.completeness === "full" ? "已保存的 GitHub 事实" : "部分信号；需手动刷新社区事实" }}
            </span>
          </div>
          <div
            class="review-signals__summary"
            :data-action="item.reviewSignal.action"
          >
            <span>
              <Octicon :name="reviewActionIcon" :size="19" />
            </span>
            <div>
              <strong>{{ item.reviewSignal.label }}</strong>
              <p>{{ item.reviewSignal.summary }}</p>
            </div>
          </div>
          <div class="review-signals__grid">
            <article :data-status="item.reviewSignal.ciStatus">
              <span>CI / Checks</span>
              <strong>{{ ciText }}</strong>
              <small v-if="item.reviewSignal.checks.total">
                共 {{ item.reviewSignal.checks.total }} 项
              </small>
              <small v-else>配置 GitHub Token 后同步批量采集</small>
            </article>
            <article :data-status="item.reviewSignal.mergeability">
              <span>合并状态</span>
              <strong>{{ mergeabilityText }}</strong>
              <small>{{ item.reviewSignal.mergeState || "由 GitHub mergeable 判断" }}</small>
            </article>
            <article>
              <span>分支新鲜度</span>
              <strong>
                {{
                  item.reviewSignal.behindBy === null
                    ? "尚未获取"
                    : item.reviewSignal.behindBy === 0
                      ? "未落后"
                      : `落后 ${item.reviewSignal.behindBy} 个提交`
                }}
              </strong>
              <small>相对目标分支</small>
            </article>
            <article :data-status="item.reviewSignal.reviewDecision">
              <span>Review 决策</span>
              <strong>{{ reviewDecisionText }}</strong>
              <small>汇总当前 Reviewer 的最新状态</small>
            </article>
          </div>
          <ul v-if="item.reviewSignal.reasons.length" class="review-signals__reasons">
            <li v-for="reason in item.reviewSignal.reasons" :key="reason">
              <Octicon name="dot-fill" :size="12" />
              {{ reason }}
            </li>
          </ul>
          <div
            v-if="item.reviewSignal.checks.details.some((check) => check.status === 'failure')"
            class="review-signals__failed-checks"
          >
            <span>失败检查</span>
            <a
              v-for="check in item.reviewSignal.checks.details.filter((entry) => entry.status === 'failure')"
              :key="check.name"
              :href="check.url || item.htmlUrl || '#'"
              target="_blank"
              rel="noreferrer"
            >
              <Octicon name="x-circle" :size="12" />
              {{ check.name }}
            </a>
          </div>
        </section>

        <section v-if="item.kind === 'pr' && item.domainAssessment" class="detail-section domain-assessment">
          <div class="detail-section__title">
            <h3>基于修改文件的领域判断</h3>
            <span>{{ confidenceText }}</span>
          </div>
          <div class="domain-assessment__summary">
            <span class="domain-badge" :data-domain="item.domain">{{ item.domain }}</span>
            <p>
              {{ domainSourceLabel }}是主要判断依据；标题和正文只作为低权重补充，不会覆盖明确的文件路径证据。
            </p>
          </div>
          <div v-if="item.domainAssessment.matchedPaths.length" class="domain-assessment__paths">
            <span>命中文件</span>
            <code v-for="path in item.domainAssessment.matchedPaths" :key="path">{{ path }}</code>
          </div>
          <div v-else class="domain-assessment__empty">
            暂未命中已知技术路径，当前结果来自文本规则；后续可在仓库设置中扩充路径规则。
          </div>
        </section>

        <section class="detail-section">
          <div class="detail-section__title">
            <h3>{{ item.kind === "pr" ? "PR 描述" : "Issue 描述" }}</h3>
            <span>GitHub Markdown</span>
          </div>
          <div class="markdown-card">
            <MarkdownRenderer :content="item.bodyMd || item.body" />
          </div>
        </section>

        <section v-if="item.kind === 'pr'" class="detail-section">
          <div class="detail-section__title">
            <h3>代码修改</h3>
            <span v-if="item.diff">{{ item.diff.files }} files changed</span>
            <span v-else>按需获取</span>
          </div>
          <DiffViewer
            v-if="item.diff"
            :diff="item.diff"
            :loading="diffLoading"
            :github-url="item.htmlUrl || undefined"
            @load-diff="emit('load-diff', item)"
          />
          <div v-else class="diff-fetch-placeholder">
            <span>
              <Octicon
                :name="diffLoading ? 'sync' : 'file-diff'"
                :size="20"
                :class="{ spinning: diffLoading }"
              />
            </span>
            <div>
              <strong>数据库中尚无变更统计</strong>
              <p>请使用“刷新社区事实”；打开详情本身不会请求 GitHub 或改变新鲜度状态。</p>
            </div>
          </div>
        </section>

        <section class="detail-section deep-analysis">
          <div class="detail-section__title">
            <div>
              <span class="eyebrow">AI INSIGHT</span>
              <h3>深度分析</h3>
            </div>
            <div class="deep-analysis__actions">
              <button
                class="button button--secondary"
                @click="emit('manage-prompt', item.kind === 'pr' ? 'pr_deep_analysis' : 'issue_deep_analysis')"
              >
                <Octicon name="gear" :size="14" />AI 管理
              </button>
              <button
                class="button button--primary"
                :disabled="analyzing || Boolean(taskLoading)"
                @click="emit('analyze', item, analysisRequirement)"
              >
                <Octicon
                  :name="analyzing ? 'sync' : 'copilot'"
                  :size="15"
                  :class="{ spinning: analyzing }"
                />
                {{
                  analyzing
                    ? "分析中…"
                    : item.deepAnalysisStatus === 'failed'
                      ? "继续上一次分析"
                      : analysisMd
                        ? "重新分析当前版本"
                        : "开始深度分析"
                }}
              </button>
            </div>
          </div>

          <label class="deep-analysis__requirement">
            <span>本次补充分析要求（可选）</span>
            <textarea
              v-model="analysisRequirement"
              maxlength="4000"
              rows="3"
              placeholder="例如：重点检查多卡场景下的生命周期与异常清理。该内容只调整关注重点，不会覆盖系统证据规则。"
            />
          </label>

          <div v-if="analysis" class="deep-analysis__metadata">
            <span>Head {{ shortSha(analysis.headSha) }}</span>
            <span>{{ analysis.promptType || '深度分析' }} · {{ analysis.promptVersion || '无 Prompt 版本' }}</span>
            <span>{{ analysis.model || '无模型记录' }} · {{ analysis.provider || '无 Provider 记录' }}</span>
            <span>{{ evidenceLabel(analysis.evidenceCompleteness) }} · {{ analysis.versionStatus === 'outdated' ? '基于旧版本' : '当前版本' }}</span>
            <span v-if="analysis.localEvidence">已核对本地源码</span>
          </div>

          <div v-if="localJob" class="local-analysis-terminal" :data-status="localJob.status">
            <header>
              <div>
                <span class="local-analysis-terminal__lamp" />
                <strong>OpenCode 本地分析</strong>
                <small>{{ localJob.providerId || '默认 Provider' }} / {{ localJob.modelId || '默认 Model' }}</small>
              </div>
              <button
                v-if="!['completed', 'failed', 'cancelled'].includes(localJob.status)"
                class="button button--secondary"
                :disabled="localJob.status === 'cancel_requested'"
                @click="emit('cancel-analysis')"
              >
                <Octicon name="stop" :size="13" />{{ localJob.status === 'cancel_requested' ? '正在取消' : '取消运行' }}
              </button>
            </header>
            <div class="local-analysis-terminal__events" aria-live="polite">
              <p v-if="!localEvents?.length"><code>[Queue]</code> 等待本地 Runner 接收任务…</p>
              <p v-for="event in localEvents" :key="event.sequence" :data-level="event.level">
                <time>{{ new Date(event.createdAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</time>
                <code>[{{ event.source }}]</code>
                <span>{{ event.message }}</span>
              </p>
            </div>
            <footer>
              <span>事件已持久化，刷新页面后可恢复</span>
              <strong v-if="localJob.error">{{ localJob.error }}</strong>
            </footer>
          </div>

          <div v-if="!analysisMd && !analyzing" class="analysis-placeholder">
            <span>
              <Octicon name="shield-check" :size="18" />
            </span>
            <p>基于标题、正文和变更统计，分析影响范围、潜在风险与建议动作。</p>
          </div>

          <div v-else-if="analyzing" class="analysis-loading">
            <span class="analysis-orbit">
              <Octicon name="copilot" :size="21" />
            </span>
            <div>
              <strong>正在阅读社区上下文</strong>
              <span>识别技术领域与潜在影响…</span>
            </div>
          </div>

          <div v-else class="analysis-result analysis-result--markdown">
            <div v-if="analysis?.codeReferences?.length" class="analysis-code-references">
              <strong>代码引用</strong>
              <code v-for="reference in analysis.codeReferences" :key="`${reference.repository}:${reference.commitSha}:${reference.path}:${reference.startLine}`">
                {{ reference.repository }}@{{ reference.commitSha.slice(0, 12) }} · {{ reference.path }} · {{ reference.symbol }}<template v-if="reference.startLine">:{{ reference.startLine }}<template v-if="reference.endLine !== reference.startLine">-{{ reference.endLine }}</template></template>
              </code>
            </div>
            <MarkdownRenderer :content="analysisMd" />
          </div>
        </section>
      </div>
    </aside>
  </div>
</template>
