<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { communityApi } from "../../api/community";
import { ApiError } from "../../api/core";
import { settingsApi } from "../../api/settings";
import type { ClassificationTaxonomyState } from "../../types/ai";
import type { GitHubCredentialState } from "../../types/account";
import type {
  RefreshTaskState,
  RefreshTaskType,
} from "../../types/refresh";
import Octicon from "../Octicon.vue";

const emit = defineEmits<{
  "refresh-complete": [repoId: string, taskType: RefreshTaskType];
}>();

const loading = ref(true);
const saving = ref(false);
const error = ref("");
const message = ref("");
const refreshTasks = ref<RefreshTaskState[]>([]);
const githubSettings = ref<GitHubCredentialState | null>(null);
const classificationTaxonomies = ref<ClassificationTaxonomyState[]>([]);
const githubToken = ref("");
const pendingGithubDelete = ref(false);
const selectedRefreshRepo = ref("vllm-ascend");
const refreshingTask = ref<RefreshTaskType | "">("");
let refreshStatusTimer: ReturnType<typeof setTimeout> | null = null;
const pendingRefreshTasks = new Map<
  string,
  { repoId: string; taskType: Exclude<RefreshTaskType, "deep_analysis"> }
>();

const selectedRefreshTasks = computed(() =>
  refreshTasks.value
    .filter((task) => task.repoId === selectedRefreshRepo.value)
    .sort(
      (left, right) =>
        ["facts", "summary", "classification", "deep_analysis"].indexOf(left.taskType) -
        ["facts", "summary", "classification", "deep_analysis"].indexOf(right.taskType),
    ),
);
const summaryDomainOptions = computed(() => {
  const taxonomy = classificationTaxonomies.value.find(
    (item) => item.repoId === selectedRefreshRepo.value,
  );
  return [
    { value: "all", label: "全部领域" },
    ...Array.from(
      new Set([
        ...(taxonomy?.categories.map((category) => category.name) ?? []),
        "Other",
      ]),
    ).map((domain) => ({ value: domain, label: domain })),
  ];
});

function report(cause: unknown, fallback: string) {
  error.value = cause instanceof ApiError ? cause.message : fallback;
}

async function loadRefreshSettings() {
  loading.value = true;
  error.value = "";
  const [refreshResult, githubResult, taxonomyResult] = await Promise.allSettled([
    settingsApi.refreshSettings(),
    settingsApi.githubSettings(),
    settingsApi.classificationTaxonomies(),
  ]);
  if (refreshResult.status === "fulfilled") refreshTasks.value = refreshResult.value.tasks;
  if (githubResult.status === "fulfilled") githubSettings.value = githubResult.value.github;
  if (taxonomyResult.status === "fulfilled") classificationTaxonomies.value = taxonomyResult.value.taxonomies;
  const failures = [refreshResult, githubResult, taxonomyResult]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length) {
    report(failures[0].reason, "部分社区刷新设置加载失败，可继续使用已加载区域");
  }
  loading.value = false;
}

async function saveGithubToken() {
  if (!githubToken.value.trim()) {
    error.value = "请输入 GitHub Token";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    githubSettings.value = (await settingsApi.saveGithubToken(githubToken.value)).github;
    githubToken.value = "";
    pendingGithubDelete.value = false;
    message.value = "GitHub Token 已加密保存，请测试连接";
  } catch (cause) {
    report(cause, "GitHub Token 保存失败");
  } finally {
    saving.value = false;
  }
}

async function testGithubToken() {
  saving.value = true;
  error.value = "";
  try {
    githubSettings.value = (await settingsApi.testGithubToken()).github;
    message.value = "GitHub Token 验证成功";
  } catch (cause) {
    report(cause, "GitHub Token 验证失败");
    try {
      githubSettings.value = (await settingsApi.githubSettings()).github;
    } catch {
      // 保留现有凭据状态，连接错误已展示。
    }
  } finally {
    saving.value = false;
  }
}

async function removeGithubToken() {
  if (!pendingGithubDelete.value) {
    pendingGithubDelete.value = true;
    message.value = "再次点击以确认移除当前账户的 GitHub Token";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    githubSettings.value = (await settingsApi.deleteGithubToken()).github;
    pendingGithubDelete.value = false;
    message.value = githubSettings.value.source === "environment"
      ? "账户 Token 已移除，已回退到服务端环境 Token"
      : "账户 GitHub Token 已移除";
  } catch (cause) {
    report(cause, "GitHub Token 移除失败");
  } finally {
    saving.value = false;
  }
}

function githubSourceLabel() {
  if (githubSettings.value?.source === "account") {
    return `当前账户 Token${githubSettings.value.tokenHint ? ` · ••••${githubSettings.value.tokenHint}` : ""}`;
  }
  if (githubSettings.value?.source === "environment") return "服务端环境 Token";
  return "未配置，将使用 GitHub 匿名额度";
}

function githubRateLimitLabel(resource: "rest" | "graphql") {
  const state = githubSettings.value;
  const remaining = resource === "rest" ? state?.rateLimitRemaining : state?.graphqlRateLimitRemaining;
  const limit = resource === "rest" ? state?.rateLimitLimit : state?.graphqlRateLimitLimit;
  if (remaining == null || limit == null) return "尚未测试";
  return `${remaining} / ${limit}`;
}

async function reloadRefreshTasks() {
  refreshTasks.value = (await settingsApi.refreshSettings()).tasks;
}

function scheduleRefreshStatusPoll() {
  if (refreshStatusTimer) clearTimeout(refreshStatusTimer);
  refreshStatusTimer = setTimeout(async () => {
    try {
      await reloadRefreshTasks();
      for (const [key, pending] of pendingRefreshTasks) {
        const latest = refreshTasks.value.find(
          (task) => task.repoId === pending.repoId && task.taskType === pending.taskType,
        );
        if (!latest || ["queued", "running"].includes(latest.status)) continue;
        pendingRefreshTasks.delete(key);
        if (latest.status === "ready") {
          if (pending.taskType === "facts") {
            githubSettings.value = (await settingsApi.githubSettings()).github;
          }
          message.value = `${refreshTaskTitle(pending.taskType)}刷新完成，仓库列表与计数已更新`;
          emit("refresh-complete", pending.repoId, pending.taskType);
        } else if (latest.status === "failed") {
          error.value = latest.lastError || `${refreshTaskTitle(pending.taskType)}刷新失败`;
        }
      }
      if (refreshTasks.value.some((task) => ["queued", "running"].includes(task.status))) {
        scheduleRefreshStatusPoll();
      }
    } catch {
      scheduleRefreshStatusPoll();
    }
  }, 2_500);
}

function refreshTaskTitle(taskType: RefreshTaskType) {
  return {
    facts: "社区事实",
    summary: "摘要分析",
    classification: "分类标签",
    deep_analysis: "深度分析",
  }[taskType];
}

function refreshStageLabel(stage: string) {
  return {
    pending: "等待执行",
    retrying: "等待重试",
    starting: "正在启动",
    discovering: "发现更新",
    discovered: "准备详细事实",
    enriching: "获取 PR 事实",
    enriching_files: "补齐文件统计",
    preparing_writes: "整理变化",
    saving_facts: "保存社区事实",
    finalizing: "提交成功水位",
    classifying: "正在生成分类标签",
    classification_ai_queued: "分类已保存，低置信度补判已排队",
    completed: "已完成",
    failed: "执行失败",
  }[stage] ?? "处理中";
}

function formatRefreshTime(value: string | null) {
  if (!value) return "尚无记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function saveRefreshTask(task: RefreshTaskState) {
  saving.value = true;
  error.value = "";
  try {
    await settingsApi.updateRefreshSettings(task.repoId, task.taskType, {
      autoEnabled: task.autoEnabled,
      intervalMinutes: task.intervalMinutes,
      activeRangeHours: task.activeRangeHours,
      refreshRule: task.refreshRule,
      maxItems: task.maxItems,
      includeCiChanges: task.includeCiChanges,
      includeCommentChanges: task.includeCommentChanges,
      stateFilter: task.stateFilter,
      domainFilter: task.domainFilter,
    });
    await reloadRefreshTasks();
    message.value = `${refreshTaskTitle(task.taskType)}刷新设置已保存`;
  } catch (cause) {
    report(cause, "刷新设置保存失败");
  } finally {
    saving.value = false;
  }
}

async function runRefreshTask(task: RefreshTaskState) {
  if (task.taskType === "deep_analysis") return;
  refreshingTask.value = task.taskType;
  error.value = "";
  try {
    const result = await communityApi.refreshRepositoryTask(task.repoId, task.taskType);
    await reloadRefreshTasks();
    message.value = result.run.status === "queued"
      ? `${refreshTaskTitle(task.taskType)}刷新已进入后台队列`
      : `${refreshTaskTitle(task.taskType)}刷新完成，处理 ${Number(result.run.itemCount ?? 0)} 条`;
    if (result.run.status === "queued") {
      pendingRefreshTasks.set(`${task.repoId}:${task.taskType}`, {
        repoId: task.repoId,
        taskType: task.taskType,
      });
      scheduleRefreshStatusPoll();
    } else {
      emit("refresh-complete", task.repoId, task.taskType);
    }
  } catch (cause) {
    await reloadRefreshTasks();
    report(cause, `${refreshTaskTitle(task.taskType)}刷新失败`);
  } finally {
    refreshingTask.value = "";
  }
}

onMounted(loadRefreshSettings);
onBeforeUnmount(() => {
  if (refreshStatusTimer) clearTimeout(refreshStatusTimer);
});
</script>

<template>
  <div>
    <div v-if="loading" class="settings-loading">正在加载社区刷新设置…</div>
    <p v-if="error" class="inline-error settings-inline-message">{{ error }}</p>
    <p v-if="message" class="settings-success">
      <Octicon name="check-circle-fill" :size="14" />{{ message }}
    </p>

    <div v-if="!loading" class="refresh-settings-workspace">
      <section v-if="githubSettings" class="settings-card github-token-card">
        <header>
          <div>
            <strong>GitHub API 认证</strong>
            <small>账户级 Token 优先用于社区事实刷新、摘要 Patch 和手动代码获取</small>
          </div>
          <span class="refresh-status" :data-status="githubSettings.configured ? 'ready' : 'stale'">
            {{ githubSettings.configured ? '已配置' : '匿名额度' }}
          </span>
        </header>
        <div class="github-token-card__body">
          <div class="github-token-metrics">
            <article><span>凭据来源</span><strong>{{ githubSourceLabel() }}</strong></article>
            <article><span>GitHub 账户</span><strong>{{ githubSettings.verifiedLogin || '尚未验证' }}</strong></article>
            <article><span>REST Core 额度</span><strong>{{ githubRateLimitLabel('rest') }}</strong></article>
            <article><span>GraphQL 额度</span><strong>{{ githubRateLimitLabel('graphql') }}</strong></article>
            <article><span>额度更新时间</span><strong>{{ githubSettings.rateLimitCheckedAt ? formatRefreshTime(githubSettings.rateLimitCheckedAt) : '尚未获取' }}</strong></article>
            <article><span>Token 上次验证</span><strong>{{ githubSettings.lastVerifiedAt ? formatRefreshTime(githubSettings.lastVerifiedAt) : '尚未测试' }}</strong></article>
          </div>
          <form class="github-token-form" @submit.prevent="saveGithubToken">
            <label>
              <span>GitHub Personal Access Token</span>
              <input v-model="githubToken" type="password" autocomplete="new-password" placeholder="粘贴新 Token；已保存值不会回显" />
            </label>
            <div class="settings-form__actions">
              <button class="button button--primary" :disabled="saving || !githubToken.trim()">
                <Octicon name="key" :size="14" />保存 Token
              </button>
              <button type="button" class="button button--secondary" :disabled="saving || !githubSettings.configured" @click="testGithubToken">
                <Octicon name="check-circle" :size="14" />测试连接
              </button>
              <button
                v-if="githubSettings.source === 'account'"
                type="button"
                class="button button--secondary"
                :class="{ 'button--danger': pendingGithubDelete }"
                :disabled="saving"
                @click="removeGithubToken"
              >
                <Octicon :name="pendingGithubDelete ? 'check' : 'trash'" :size="14" />
                {{ pendingGithubDelete ? '确认移除' : '移除账户 Token' }}
              </button>
            </div>
          </form>
          <p v-if="githubSettings.rateLimitResetAt || githubSettings.graphqlRateLimitResetAt" class="settings-note">
            REST 预计于 {{ githubSettings.rateLimitResetAt ? new Date(githubSettings.rateLimitResetAt).toLocaleString('zh-CN') : '未知' }} 重置；GraphQL 预计于 {{ githubSettings.graphqlRateLimitResetAt ? new Date(githubSettings.graphqlRateLimitResetAt).toLocaleString('zh-CN') : '未知' }} 重置。
          </p>
          <p v-if="githubSettings.lastError" class="inline-error">最近验证错误：{{ githubSettings.lastError }}</p>
          <p class="settings-note">Token 使用服务端 AES-GCM 加密后按账户保存；页面、日志和 API 均不会返回明文。公开仓库只需要最小只读权限。</p>
        </div>
      </section>

      <section class="settings-card refresh-settings-repos">
        <header>
          <div><strong>仓库配置</strong><small>两个仓库独立保存刷新策略与运行状态</small></div>
        </header>
        <div class="refresh-repo-switch">
          <button
            v-for="repo in ['vllm-ascend', 'vllm']"
            :key="repo"
            class="button"
            :class="selectedRefreshRepo === repo ? 'button--primary' : 'button--secondary'"
            @click="selectedRefreshRepo = repo"
          >
            <Octicon name="repo" :size="14" />{{ repo }}
          </button>
        </div>
      </section>

      <div class="refresh-task-grid">
        <section
          v-for="task in selectedRefreshTasks"
          :key="task.taskType"
          class="settings-card refresh-task-card"
          :data-task="task.taskType"
        >
          <header>
            <div>
              <strong>{{ refreshTaskTitle(task.taskType) }}</strong>
              <small>
                {{ task.taskType === 'facts'
                  ? 'GitHub 与本地规则事实，不调用 AI'
                  : task.taskType === 'summary'
                    ? '仅处理缺失或已过期的摘要'
                    : task.taskType === 'classification'
                      ? '默认仅首次分类，人工结果不会被覆盖'
                      : '始终由详情页明确启动' }}
              </small>
            </div>
            <span class="refresh-status" :data-status="task.status">
              {{ task.status === 'queued' ? '已排队' : task.status === 'running' ? '运行中' : task.status === 'failed' ? '失败' : task.stale ? '数据过期' : '正常' }}
            </span>
          </header>

          <div class="refresh-task-metrics">
            <span><small>上次成功</small><strong>{{ formatRefreshTime(task.lastSuccessfulAt) }}</strong></span>
            <span><small>下次计划</small><strong>{{ formatRefreshTime(task.nextScheduledAt) }}</strong></span>
            <span><small>待处理</small><strong>{{ task.pendingCount }} 条</strong></span>
          </div>

          <div v-if="['queued', 'running'].includes(task.status)" class="refresh-task-progress">
            <div>
              <span>{{ refreshStageLabel(task.currentStage) }}</span>
              <strong v-if="task.progressTotal">{{ task.progressCurrent }}/{{ task.progressTotal }}</strong>
            </div>
            <progress :value="task.progressTotal ? task.progressCurrent : undefined" :max="task.progressTotal || 1" />
          </div>

          <p v-if="task.lastError" class="inline-error refresh-task-error">最近错误：{{ task.lastError }}</p>

          <div v-if="task.taskType !== 'deep_analysis'" class="settings-form refresh-task-form">
            <label class="settings-checkbox"><input v-model="task.autoEnabled" type="checkbox" />启用自动刷新</label>

            <div v-if="task.taskType === 'facts'" class="settings-form__row">
              <label>刷新周期
                <select v-model.number="task.intervalMinutes">
                  <option :value="60">1 小时</option><option :value="180">3 小时</option><option :value="360">6 小时</option><option :value="720">12 小时</option>
                </select>
              </label>
              <label>首次活跃范围
                <select v-model.number="task.activeRangeHours">
                  <option :value="24">最近 24 小时</option><option :value="72">最近 3 天</option><option :value="168">最近 7 天</option><option :value="720">最近 30 天</option>
                </select>
              </label>
            </div>
            <small v-if="task.taskType === 'facts'" class="refresh-task-note">
              每次处理发现的全部增量；先批量发现 PR/Issue，再按目标 PR 批量补齐事实。代码 Patch、精确分支距离和 AI 分析不在此任务中获取。
            </small>

            <template v-if="task.taskType === 'summary'">
              <div class="settings-form__row">
                <label>刷新周期
                  <select v-model.number="task.intervalMinutes">
                    <option :value="60">1 小时</option><option :value="360">6 小时</option><option :value="720">12 小时</option><option :value="1440">24 小时</option>
                  </select>
                </label>
                <label>活跃时间范围
                  <select v-model.number="task.activeRangeHours">
                    <option :value="24">最近 24 小时</option><option :value="72">最近 3 天</option><option :value="168">最近 7 天</option><option :value="720">最近 30 天</option>
                  </select>
                </label>
              </div>
              <div class="settings-form__row">
                <label>刷新判定
                  <select v-model="task.refreshRule">
                    <option value="code_only">仅代码变化</option><option value="code_or_body">代码或正文变化</option><option value="any_update">updated_at 任意变化</option><option value="manual">仅手动</option>
                  </select>
                </label>
                <label>单次最大处理数量<input v-model.number="task.maxItems" type="number" min="1" max="500" /></label>
              </div>
              <div class="settings-form__row">
                <label>状态筛选
                  <select v-model="task.stateFilter">
                    <option value="all">全部状态</option><option value="open">Open</option><option value="draft">Draft</option><option value="merged">Merged</option><option value="closed">Closed</option>
                  </select>
                </label>
                <label>技术领域筛选
                  <select v-model="task.domainFilter">
                    <option v-for="option in summaryDomainOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
              </div>
              <div class="refresh-trigger-checks">
                <label class="settings-checkbox"><input v-model="task.includeCiChanges" type="checkbox" />CI 变化使摘要过期</label>
                <label class="settings-checkbox"><input v-model="task.includeCommentChanges" type="checkbox" />评论变化使摘要过期</label>
              </div>
            </template>

            <label v-if="task.taskType === 'classification'">刷新策略
              <select v-model="task.refreshRule">
                <option value="first_only">仅首次分类（默认）</option><option value="code_only">代码变化时重新分类</option><option value="any_update">updated_at 任意变化时重新分类</option><option value="manual">仅手动分类</option>
              </select>
            </label>

            <p class="settings-note">
              <template v-if="task.taskType === 'facts'">增量水位：{{ task.watermarkUpdatedAt || '首次刷新尚未建立' }}；边界时间会重复读取并按仓库、类型、编号幂等更新。</template>
              <template v-else-if="task.taskType === 'summary'">摘要只分析活跃范围内且命中状态、领域筛选的条目，不会重新抓取 CI 或 Review；单条手动更新不受筛选限制并使用高优先级任务。</template>
              <template v-else>分类对应的 Head SHA 和生成时间会保留；事实变化只标记可能过期。</template>
            </p>
            <div class="settings-form__actions refresh-task-actions">
              <button class="button button--secondary" :disabled="saving" @click="saveRefreshTask(task)"><Octicon name="check" :size="14" />保存配置</button>
              <button class="button button--primary" :disabled="refreshingTask === task.taskType || task.status === 'running'" @click="runRefreshTask(task)">
                <Octicon name="sync" :size="14" :class="{ spinning: refreshingTask === task.taskType }" />
                {{ task.status === 'queued' ? '继续队列任务' : task.taskType === 'classification' ? '手动重新分类' : '手动刷新' }}
              </button>
            </div>
          </div>

          <div v-else class="refresh-deep-manual">
            <span><Octicon name="shield-lock" :size="20" /></span>
            <div>
              <strong>仅手动，不提供自动定时分析</strong>
              <p>Runner：API（预留本地 Agent Runner）</p>
              <p>执行引擎与模型：在 AI 管理中为对应深度分析任务单独配置</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
