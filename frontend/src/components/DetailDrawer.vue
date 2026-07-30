<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { CommunityItem } from "../types";
import DiffViewer from "./DiffViewer.vue";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import Octicon from "./Octicon.vue";

const props = defineProps<{
  item: CommunityItem;
  watched: boolean;
  analysisMd?: string;
  analyzing?: boolean;
  diffLoading?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "toggle-watch": [item: CommunityItem];
  analyze: [item: CommunityItem, prompt: string];
  "load-diff": [item: CommunityItem];
}>();
const drawer = ref<HTMLElement | null>(null);
const analysisPrompt = ref("");

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

        <section v-if="item.kind === 'pr' && item.reviewSignal" class="detail-section review-signals">
          <div class="detail-section__title">
            <h3>PR Review 信号</h3>
            <span>
              {{ item.reviewSignal.completeness === "full" ? "GitHub 实时信号" : "部分信号，详情打开时补采" }}
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
              <strong>正在准备变更统计</strong>
              <p>详情默认只读取文件路径和增删行数，不会提前返回具体代码内容。</p>
            </div>
          </div>
        </section>

        <section class="detail-section deep-analysis">
          <label class="prompt-field detail-analysis-prompt">
            <span>本次深度分析补充要求（可选）</span>
            <textarea
              v-model="analysisPrompt"
              rows="3"
              maxlength="5000"
              placeholder="例如：重点分析对 MRV2、多卡回归和 vLLM-Ascend 兼容性的影响"
            />
          </label>
          <div class="detail-section__title">
            <div>
              <span class="eyebrow">AI INSIGHT</span>
              <h3>深度分析</h3>
            </div>
            <button
              class="button button--primary"
              :disabled="analyzing"
              @click="emit('analyze', item, analysisPrompt)"
            >
              <Octicon
                :name="analyzing ? 'sync' : 'copilot'"
                :size="15"
                :class="{ spinning: analyzing }"
              />
              {{ analyzing ? "分析中…" : analysisMd ? "重新分析" : "开始深度分析" }}
            </button>
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
            <MarkdownRenderer :content="analysisMd" />
          </div>
        </section>
      </div>
    </aside>
  </div>
</template>
