<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ApiError } from "../../api/core";
import { localAnalysisApi } from "../../api/local-analysis";
import { settingsApi } from "../../api/settings";
import type { AIManagementState } from "../../types/ai";
import type { LocalAnalysisEvent, LocalAnalysisJob, LocalRunnerSettingsState } from "../../types/analysis";
import { localExecutionEngineCapabilities } from "../../domain/ai-execution";
import Octicon from "../Octicon.vue";

const emit = defineEmits<{
  "open-ai-tasks": [];
}>();

const loading = ref(true);
const saving = ref(false);
const localRunnerState = ref<LocalRunnerSettingsState | null>(null);
const aiManagement = ref<AIManagementState | null>(null);
const localActionJob = ref<LocalAnalysisJob | null>(null);
const localActionEvents = ref<LocalAnalysisEvent[]>([]);
const runnerNotice = ref<{ kind: "success" | "error"; text: string } | null>(null);
let localActionTimer: number | null = null;

const engineCapabilities = computed(() => localRunnerState.value
  ? localExecutionEngineCapabilities(aiManagement.value?.runner ?? localRunnerState.value.runner)
  : []);
const permissionProfiles = computed(() => [...new Set(
  (aiManagement.value?.runner.engines ?? []).flatMap((engine) => engine.permissionProfiles),
)]);

async function loadLocalRunnerSettings() {
  loading.value = true;
  runnerNotice.value = null;
  const [localResult, managementResult] = await Promise.allSettled([
    localAnalysisApi.localAnalysisSettings(),
    settingsApi.aiManagement(),
  ]);
  if (localResult.status === "fulfilled") localRunnerState.value = localResult.value;
  if (managementResult.status === "fulfilled") aiManagement.value = managementResult.value;
  if (localResult.status === "rejected") {
    runnerNotice.value = {
      kind: "error",
      text: localResult.reason instanceof ApiError ? localResult.reason.message : "本地运行环境设置加载失败",
    };
  } else if (managementResult.status === "rejected") {
    runnerNotice.value = {
      kind: "error",
      text: "本地运行环境已加载，但执行引擎能力状态暂时不可用",
    };
  }
  loading.value = false;
}

async function saveLocalRunnerSettings() {
  if (!localRunnerState.value) return;
  saving.value = true;
  runnerNotice.value = null;
  try {
    localRunnerState.value = await localAnalysisApi.updateLocalAnalysisSettings(localRunnerState.value.settings);
    runnerNotice.value = { kind: "success", text: "本地 Runner 设置已保存" };
  } catch (cause) {
    runnerNotice.value = {
      kind: "error",
      text: cause instanceof ApiError ? cause.message : "本地 Runner 设置保存失败",
    };
  } finally {
    saving.value = false;
  }
}

async function pollLocalAction(jobId: string) {
  if (localActionTimer !== null) window.clearTimeout(localActionTimer);
  try {
    const after = localActionEvents.value.at(-1)?.sequence ?? 0;
    const result = await localAnalysisApi.localAnalysisJob(jobId, after);
    localActionJob.value = result.job;
    localActionEvents.value.push(...result.events);
    if (!["completed", "failed", "cancelled"].includes(result.job.status)) {
      localActionTimer = window.setTimeout(() => pollLocalAction(jobId), 1_000);
      return;
    }
    const [localResult, managementResult] = await Promise.allSettled([
      localAnalysisApi.localAnalysisSettings(),
      settingsApi.aiManagement(),
    ]);
    if (localResult.status === "fulfilled") localRunnerState.value = localResult.value;
    if (managementResult.status === "fulfilled") aiManagement.value = managementResult.value;
    runnerNotice.value = result.job.status === "completed"
      ? { kind: "success", text: "本地 Runner 操作完成，详细过程见下方事件记录" }
      : { kind: "error", text: result.job.error || "本地 Runner 操作失败" };
  } catch (cause) {
    runnerNotice.value = {
      kind: "error",
      text: cause instanceof ApiError ? cause.message : "本地 Runner 操作状态读取失败",
    };
  }
}

async function runLocalAction(action: string, repository = "") {
  runnerNotice.value = null;
  localActionEvents.value = [];
  try {
    const result = await localAnalysisApi.runLocalAnalysisAction(action, repository);
    localActionJob.value = result.job;
    await pollLocalAction(result.job.id);
  } catch (cause) {
    runnerNotice.value = {
      kind: "error",
      text: cause instanceof ApiError ? cause.message : "本地 Runner 操作失败",
    };
  }
}

function localRepoLabel(repository: string) {
  const status = localRunnerState.value?.runner.repositories?.[repository];
  if (!status?.exists) return "尚未初始化";
  if (!status.git) return "目录不是 Git 仓库";
  return `就绪 · ${status.head || "未知 Head"}`;
}

onMounted(loadLocalRunnerSettings);
onBeforeUnmount(() => {
  if (localActionTimer !== null) window.clearTimeout(localActionTimer);
});
</script>

<template>
  <div>
    <div v-if="loading" class="settings-loading">正在加载本地运行环境…</div>
    <div v-else-if="localRunnerState" class="local-runner-settings">
      <section class="settings-card local-runner-overview">
        <header>
          <div>
            <strong>本地 Runner 基础设施</strong>
            <small>管理本机任务调度、仓库、工作区与权限上限，不绑定任何业务功能</small>
          </div>
          <span class="refresh-status" :data-status="localRunnerState.runner.online ? 'ready' : 'failed'">
            {{ localRunnerState.runner.online ? 'Runner 在线' : 'Runner 离线' }}
          </span>
        </header>
        <div class="local-runner-scope">
          <span class="local-runner-scope__icon"><Octicon name="shield-lock" :size="18" /></span>
          <div>
            <strong>本页不决定任务使用哪个 AI</strong>
            <p>这里管理 Runner 在线状态、本地仓库、Worktree、权限上限、并发和超时。执行方式、工作区、具体权限档案、Provider、Model 及提示词均由每个 AI 任务独立指定。</p>
          </div>
          <button class="button button--secondary" @click="emit('open-ai-tasks')">
            <Octicon name="workflow" :size="14" />前往 AI 任务配置
          </button>
        </div>
        <div class="local-runner-metrics">
          <article v-for="engine in engineCapabilities" :key="engine.id" class="local-engine-capability">
            <span>{{ engine.name }} · {{ engine.transport }}</span>
            <strong>{{ engine.statusLabel }}</strong>
            <small>{{ engine.version ? `v${engine.version} · ` : '' }}{{ engine.modelCount }} 个可用模型</small>
            <small v-if="engine.error" class="local-engine-capability__error">{{ engine.error }}</small>
          </article>
          <article><span>权限策略</span><strong>{{ localRunnerState.runner.readonlyVerified ? '基础边界已验证' : '未验证' }}</strong><small>{{ permissionProfiles.length ? permissionProfiles.join(' · ') : '等待 Runner 上报权限档案' }}</small></article>
          <article><span>Runner 版本</span><strong>{{ localRunnerState.runner.version || '未知' }}</strong><small>浏览器不会获得本地路径、密码或模型密钥</small></article>
          <article><span>活动任务</span><strong>{{ localRunnerState.runner.activeJobs }}</strong><small>{{ localRunnerState.runner.lastSeenAt ? new Date(localRunnerState.runner.lastSeenAt).toLocaleString('zh-CN') : '无心跳' }}</small></article>
        </div>
        <p v-if="runnerNotice" class="settings-context-notice" :data-kind="runnerNotice.kind" aria-live="polite">
          <Octicon :name="runnerNotice.kind === 'success' ? 'check-circle-fill' : 'alert'" :size="14" />{{ runnerNotice.text }}
        </p>
        <p v-if="localRunnerState.runner.lastError" class="inline-error">{{ localRunnerState.runner.lastError }}</p>
      </section>

      <section class="settings-card">
        <header><div><strong>Runner 调度策略</strong><small>只影响本地任务如何排队和准备代码，不覆盖任何任务的执行引擎与模型配置</small></div></header>
        <div class="settings-form">
          <label class="settings-checkbox"><input v-model="localRunnerState.settings.enabled" type="checkbox" />允许已配置为本地执行引擎的 AI 任务使用 Runner</label>
          <div class="settings-form__row">
            <label>最大并发任务<input v-model.number="localRunnerState.settings.maxConcurrency" type="number" min="1" max="8" /></label>
            <label>会话 Worktree 保留时间（小时）<input v-model.number="localRunnerState.settings.worktreeRetentionHours" type="number" min="1" max="720" /><small>临时 Worktree 在任务结束后立即清理；此处只控制连续会话和异常残留。</small></label>
          </div>
          <div class="settings-form__row">
            <label>任务超时（秒）<input v-model.number="localRunnerState.settings.timeoutSeconds" type="number" min="60" max="7200" /></label>
            <label class="settings-checkbox"><input v-model="localRunnerState.settings.autoFetch" type="checkbox" />允许选择了 Fetch 策略的任务更新远端引用</label>
          </div>
          <p class="settings-note">执行引擎、仓库路径和允许使用的权限档案在 <code>.loongboard/runner.json</code> 中配置；本页面只控制基础设施上限，不覆盖 AI 任务设置。</p>
          <div class="settings-form__actions"><button class="button button--primary" :disabled="saving" @click="saveLocalRunnerSettings"><Octicon name="check" :size="14" />保存设置</button></div>
        </div>
      </section>

      <section class="settings-card">
        <header><div><strong>本地仓库</strong><small>默认识别 LoongBoard 同级的 vllm 与 vllm-ascend；不存在时可初始化 Clone</small></div></header>
        <div class="local-repository-list">
          <article v-for="repository in ['vllm', 'vllm-ascend']" :key="repository">
            <span><Octicon name="repo" :size="16" /></span>
            <div><strong>{{ repository }}</strong><small>{{ localRepoLabel(repository) }}</small></div>
            <button v-if="!localRunnerState.runner.repositories?.[repository]?.git" class="button button--secondary" @click="runLocalAction('initialize_repository', repository)">初始化仓库</button>
          </article>
        </div>
        <div class="settings-form__actions local-runner-actions">
          <button class="button button--secondary" @click="runLocalAction('test_connection')">测试 Runner 与引擎连接</button>
          <button class="button button--secondary" @click="runLocalAction('check_repositories')">检查仓库</button>
          <button class="button button--secondary" @click="runLocalAction('refresh_models')">刷新引擎模型清单</button>
          <button class="button button--secondary" @click="runLocalAction('cleanup_worktrees')">清理过期 Worktree</button>
        </div>
      </section>

      <div v-if="localActionJob" class="local-analysis-terminal" :data-status="localActionJob.status">
        <header><div><span class="local-analysis-terminal__lamp" /><strong>Runner 操作</strong></div><small>{{ localActionJob.status }}</small></header>
        <div class="local-analysis-terminal__events">
          <p v-if="!localActionEvents.length"><code>[Queue]</code> 等待 Runner…</p>
          <p v-for="event in localActionEvents" :key="event.sequence" :data-level="event.level"><time>{{ new Date(event.createdAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</time><code>[{{ event.source }}]</code><span>{{ event.message }}</span></p>
        </div>
      </div>
    </div>
    <p v-else-if="runnerNotice" class="inline-error settings-inline-message">{{ runnerNotice.text }}</p>
  </div>
</template>
