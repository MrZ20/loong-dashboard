<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ApiError } from "../../api/core";
import { localAnalysisApi } from "../../api/local-analysis";
import { settingsApi } from "../../api/settings";
import { AI_PERMISSION_PROFILE_DEFINITIONS } from "../../../shared/contracts/ai";
import {
  AI_EXECUTION_ENGINES,
  executionEngineDefinition,
  localAgentModels,
  localAgentProviders,
  localExecutionEngineCapabilities,
  selectedLocalEngineState,
} from "../../domain/ai-execution";
import type {
  AIExecutionMode,
  AIManagementState,
  AIPromptFeature,
  AIPromptTemplate,
  AITaskKey,
  AITaskSetting,
  ClassificationTaxonomyState,
  PromptFeatureKey,
  AIProviderConfig,
} from "../../types/ai";
import type { LocalAnalysisEvent, LocalAnalysisJob } from "../../types/analysis";
import Octicon from "../Octicon.vue";

const props = defineProps<{
  initialPromptFeature?: PromptFeatureKey;
  initialRepo?: string;
}>();

const loading = ref(true);
const saving = ref(false);
const loadError = ref("");
const notice = ref<{ kind: "success" | "error"; text: string } | null>(null);
const providers = ref<AIProviderConfig[]>([]);
const aiManagement = ref<AIManagementState | null>(null);
const promptFeatures = ref<AIPromptFeature[]>([]);
const classificationTaxonomies = ref<ClassificationTaxonomyState[]>([]);
const selectedAITaskKey = ref<AITaskKey>("vllm_ascend_pr_summary");
const selectedPromptFeatureKey = ref<PromptFeatureKey>(props.initialPromptFeature || "pr_triage");
const refreshingTaxonomy = ref<"vllm" | "vllm-ascend" | "">("");
const editingPromptId = ref("");
const pendingPromptDeleteId = ref("");
const showPromptForm = ref(false);
const localActionJob = ref<LocalAnalysisJob | null>(null);
const localActionEvents = ref<LocalAnalysisEvent[]>([]);
const localActionClock = ref(Date.now());
let localActionTimer: number | null = null;
let localActionPollToken = 0;

const promptForm = reactive({
  name: "",
  content: "",
  makeActive: true,
});

const selectedPromptFeature = computed(
  () => promptFeatures.value.find((feature) => feature.key === selectedPromptFeatureKey.value) ?? promptFeatures.value[0] ?? null,
);
const allAITasks = computed(() => aiManagement.value?.groups.flatMap((group) => group.tasks) ?? []);
const selectedAITask = computed(() =>
  allAITasks.value.find((task) => task.key === selectedAITaskKey.value) ?? allAITasks.value[0] ?? null,
);
const selectedTaskProvider = computed(() =>
  providers.value.find((provider) => provider.id === selectedAITask.value?.providerConfigId) ?? null,
);
const selectedEngineState = computed(() => aiManagement.value && selectedAITask.value
  ? selectedLocalEngineState(aiManagement.value.runner, selectedAITask.value.executionMode)
  : null);
const selectedEngineProviders = computed(() => localAgentProviders(selectedEngineState.value));
const selectedEngineModels = computed(() => selectedEngineProviders.value.length
  ? selectedEngineProviders.value.find((provider) => provider.id === selectedAITask.value?.engineProviderId)?.models ?? []
  : localAgentModels(selectedEngineState.value));
const localEngineCapabilities = computed(() => aiManagement.value
  ? localExecutionEngineCapabilities(aiManagement.value.runner)
  : []);
const selectedEngineDefinition = computed(() => selectedAITask.value
  ? executionEngineDefinition(selectedAITask.value.executionMode)
  : AI_EXECUTION_ENGINES[0]);
const selectedEngineCapability = computed(() => localEngineCapabilities.value.find(
  (capability) => capability.id === selectedEngineDefinition.value.capabilityId,
) ?? null);
const selectedEngineModel = computed(() =>
  selectedEngineModels.value.find((model) => model.id === selectedAITask.value?.engineModelId) ??
  selectedEngineModels.value.find((model) => model.isDefault) ?? selectedEngineModels.value[0] ?? null,
);
const supportedReasoningEfforts = computed(() => selectedEngineModel.value?.supportedReasoningEfforts ?? []);
const workspaceModeOptions = [
  { id: "none", name: "无源码", description: "仅使用任务输入", icon: "file" },
  { id: "ephemeral_worktree", name: "临时 Worktree", description: "每任务新建，结束即清理", icon: "repo" },
  { id: "worktree", name: "会话 Worktree", description: "隔离版本，可连续使用", icon: "workflow" },
] as const;
const selectedWorkspaceMode = computed(() => workspaceModeOptions.find(
  (mode) => mode.id === selectedAITask.value?.workspaceMode,
) ?? workspaceModeOptions[0]);
const permissionProfileOptions = computed(() => AI_PERMISSION_PROFILE_DEFINITIONS.map((profile) => {
  const task = selectedAITask.value;
  const engineSupported = Boolean(task && profile.engines.includes(task.executionMode as any));
  const runnerEnabled = Boolean(selectedEngineState.value?.permissionProfiles.includes(profile.id));
  const workspaceSupported = profile.id !== "worktree_development" || task?.workspaceMode !== "none";
  let unavailableReason = "";
  if (!engineSupported) {
    unavailableReason = `仅 ${profile.engines.map(
      (engine) => executionEngineDefinition(engine as AIExecutionMode).name,
    ).join(" / ")} 支持`;
  }
  else if (!runnerEnabled) unavailableReason = "当前 Runner 未启用";
  else if (!workspaceSupported) unavailableReason = "需选择 Worktree 工作区";
  return {
    ...profile,
    available: engineSupported && runnerEnabled && workspaceSupported,
    unavailableReason,
    icon: profile.id === "safe_readonly" ? "lock" : profile.id === "community_research" ? "telescope" : "code-square",
  };
}));
const selectedPermissionProfile = computed(() => permissionProfileOptions.value.find(
  (profile) => profile.id === selectedAITask.value?.permissionProfileId,
) ?? null);
const selectedAITaskConfigured = computed(() => {
  const task = selectedAITask.value;
  if (!task) return false;
  if (task.executionMode === "api") return Boolean(task.providerConfigId);
  if (!selectedEngineState.value) return false;
  if (!task.workspaceMode || !task.permissionProfileId) return false;
  if (!selectedPermissionProfile.value?.available) return false;
  if (selectedEngineProviders.value.length) return Boolean(task.engineProviderId && task.engineModelId);
  return Boolean(task.engineModelId);
});
const taxonomyRefreshRepo = computed<"vllm" | "vllm-ascend" | null>(() => {
  if (selectedPromptFeatureKey.value === "vllm_taxonomy_refresh") return "vllm";
  if (selectedPromptFeatureKey.value === "vllm_ascend_taxonomy_refresh") return "vllm-ascend";
  return null;
});

function isTaxonomyRefreshTask(task: AITaskSetting | null | undefined) {
  return task?.featureKey === "vllm_taxonomy_refresh"
    || task?.featureKey === "vllm_ascend_taxonomy_refresh";
}

function enforceTaxonomyEvidencePolicy(task: AITaskSetting | null | undefined) {
  if (!task || !isTaxonomyRefreshTask(task)) return;
  task.workspaceMode = "none";
  task.updatePolicy = "none";
  task.permissionProfileId = "safe_readonly";
}
const selectedClassificationTaxonomy = computed(() =>
  classificationTaxonomies.value.find((taxonomy) => taxonomy.repoId === taxonomyRefreshRepo.value) ?? null,
);
const localActionProgress = computed(() => {
  const job = localActionJob.value;
  if (!job) return null;
  const terminal = ["completed", "failed", "cancelled"].includes(job.status);
  if (job.status === "completed") return { percent: 100, label: "分类标准已生成", detail: "结果正在写入并刷新页面" };
  const events = localActionEvents.value;
  const types = new Set(events.map((event) => event.eventType));
  const toolActions = events.filter((event) => ["symbol_search", "file_read", "git_query"].includes(event.eventType)).length;
  let percent = job.status === "queued" ? 5 : job.status === "claimed" ? 9 : 12;
  let label = job.status === "queued" ? "等待本地 Runner" : "准备分类标准任务";
  if (types.has("git_fetch")) { percent = 22; label = "更新仓库引用"; }
  if (types.has("worktree_create")) { percent = 32; label = "创建隔离工作区"; }
  if (types.has("repository_prepare")) { percent = 40; label = "整理仓库与样本证据"; }
  if (types.has("model_call")) { percent = Math.max(percent, 48); label = "AI 正在审查分类标准"; }
  if (toolActions) {
    percent = Math.max(percent, 48 + Math.min(34, toolActions * 4));
    label = "核对必要代码证据";
  }
  if (types.has("report_generate")) { percent = 92; label = "校验并生成分类标准"; }
  if (types.has("worktree_cleanup")) { percent = 97; label = "清理临时工作区"; }
  if (terminal) label = job.status === "failed" ? "分类标准更新失败" : "分类标准更新已取消";
  const detail = events.at(-1)?.message || (job.status === "queued" ? "任务已入队，等待 Runner 领取" : "正在启动任务");
  return { percent, label, detail };
});
const localActionElapsed = computed(() => {
  const job = localActionJob.value;
  if (!job) return "";
  const started = new Date(job.startedAt || job.createdAt).valueOf();
  if (!Number.isFinite(started)) return "";
  const finished = job.finishedAt ? new Date(job.finishedAt).valueOf() : localActionClock.value;
  const seconds = Math.max(0, Math.floor((finished - started) / 1_000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
});

const reasoningEffortLabels: Record<string, string> = {
  low: "低", medium: "中", high: "高", xhigh: "超高", max: "最大", ultra: "极致",
};

function reasoningEffortLabel(value: string) {
  return reasoningEffortLabels[value] || value;
}

function taskExecutionLabel(mode: AIExecutionMode) {
  return executionEngineDefinition(mode).name;
}

function executionEngineIcon(mode: AIExecutionMode) {
  return mode === "api" ? "key" : "terminal";
}

function taskEngineDescription(mode: AIExecutionMode) {
  if (taxonomyRefreshRepo.value) {
    return mode === "api" ? "直接分析数据库证据包" : "通过本地 Runner 分析数据库证据包";
  }
  return executionEngineDefinition(mode).description;
}

function normalizeReasoningEffort() {
  const task = selectedAITask.value;
  if (!task?.reasoningEffort) return;
  if (!supportedReasoningEfforts.value.some((option) => option.reasoningEffort === task.reasoningEffort)) {
    task.reasoningEffort = "";
  }
}

function formatRefreshTime(value: string | null) {
  if (!value) return "尚无记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function selectInitialAITask() {
  const feature = props.initialPromptFeature;
  const repo = props.initialRepo;
  const candidates = allAITasks.value.filter((task) => !feature || task.featureKey === feature);
  const selected = candidates.find((task) => task.repoScope === repo) ?? candidates[0] ?? allAITasks.value[0];
  if (selected) selectAITask(selected);
}

function selectAITask(task: AITaskSetting) {
  enforceTaxonomyEvidencePolicy(task);
  selectedAITaskKey.value = task.key;
  selectedPromptFeatureKey.value = task.featureKey;
  pendingPromptDeleteId.value = "";
  notice.value = null;
  resetPromptForm();
}

function stopLocalActionPolling() {
  localActionPollToken += 1;
  if (localActionTimer !== null) window.clearTimeout(localActionTimer);
  localActionTimer = null;
}

async function startLocalAction(job: LocalAnalysisJob) {
  stopLocalActionPolling();
  localActionJob.value = job;
  localActionEvents.value = [];
  localActionClock.value = Date.now();
  refreshingTaxonomy.value = job.repoScope === "vllm" ? "vllm" : "vllm-ascend";
  const token = localActionPollToken;
  await pollLocalAction(job.id, token);
}

async function resumeTaxonomyAction(repoId: "vllm" | "vllm-ascend" | null) {
  stopLocalActionPolling();
  localActionJob.value = null;
  localActionEvents.value = [];
  refreshingTaxonomy.value = "";
  if (!repoId) return;
  try {
    const { jobs } = await localAnalysisApi.localAnalysisJobs();
    const active = jobs.find((job) =>
      job.subjectKind === "taxonomy" &&
      job.repoScope === repoId &&
      !["completed", "failed", "cancelled"].includes(job.status),
    );
    if (active) await startLocalAction(active);
  } catch {
    // AI 任务配置仍可使用；下一次点击更新时会重新取得任务状态。
  }
}

async function loadAITaskSettings() {
  loading.value = true;
  loadError.value = "";
  const [providerResult, promptResult, taxonomyResult, managementResult] = await Promise.allSettled([
    settingsApi.aiProviders(), settingsApi.aiPrompts(), settingsApi.classificationTaxonomies(), settingsApi.aiManagement(),
  ]);
  if (providerResult.status === "fulfilled") providers.value = providerResult.value.providers;
  if (promptResult.status === "fulfilled") promptFeatures.value = promptResult.value.features;
  if (taxonomyResult.status === "fulfilled") classificationTaxonomies.value = taxonomyResult.value.taxonomies;
  if (managementResult.status === "fulfilled") aiManagement.value = managementResult.value;
  const failures = [providerResult, promptResult, taxonomyResult, managementResult]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length) {
    const reason = failures[0].reason;
    loadError.value = reason instanceof ApiError ? reason.message : "部分 AI 任务设置加载失败";
  }
  if (!promptFeatures.value.some((feature) => feature.key === selectedPromptFeatureKey.value)) {
    selectedPromptFeatureKey.value = promptFeatures.value[0]?.key ?? "pr_triage";
  }
  selectInitialAITask();
  loading.value = false;
}

async function reloadAIManagement() {
  aiManagement.value = await settingsApi.aiManagement();
}

async function reloadProviders() {
  providers.value = (await settingsApi.aiProviders()).providers;
}

async function reloadPromptFeatures() {
  promptFeatures.value = (await settingsApi.aiPrompts()).features;
}

async function saveSelectedAITask() {
  const task = selectedAITask.value;
  if (!task) return;
  enforceTaxonomyEvidencePolicy(task);
  if (!selectedEngineState.value) {
    task.engineProviderId = "";
    task.engineModelId = "";
    task.reasoningEffort = "";
    return;
  }
  saving.value = true;
  notice.value = null;
  try {
    await settingsApi.updateAITask(task.key, {
      executionMode: task.executionMode,
      providerConfigId: task.providerConfigId,
      engineProviderId: task.engineProviderId,
      engineModelId: task.engineModelId,
      reasoningEffort: task.reasoningEffort,
      workspaceMode: task.workspaceMode,
      updatePolicy: task.updatePolicy,
      permissionProfileId: task.permissionProfileId,
      promptTemplateId: task.promptTemplateId,
    });
    await Promise.all([reloadAIManagement(), reloadProviders()]);
    notice.value = { kind: "success", text: `${task.groupName} / ${task.name} 配置已保存` };
  } catch (cause) {
    notice.value = { kind: "error", text: cause instanceof ApiError ? cause.message : "AI 任务配置保存失败" };
    throw cause;
  } finally {
    saving.value = false;
  }
}

async function testSelectedAITask() {
  const task = selectedAITask.value;
  if (!task) return;
  saving.value = true;
  notice.value = null;
  try {
    await saveSelectedAITask();
    const result = await settingsApi.testAITask(task.key);
    await reloadAIManagement();
    notice.value = { kind: "success", text: result.message };
  } catch (cause) {
    notice.value = { kind: "error", text: cause instanceof ApiError ? cause.message : "当前 AI 组合测试失败" };
  } finally {
    saving.value = false;
  }
}

async function clearSelectedAITaskError() {
  const task = selectedAITask.value;
  if (!task) return;
  notice.value = null;
  try {
    await settingsApi.clearAITaskError(task.key);
    await reloadAIManagement();
    notice.value = { kind: "success", text: "过期错误记录已清除" };
  } catch (cause) {
    notice.value = { kind: "error", text: cause instanceof ApiError ? cause.message : "错误记录清除失败" };
  }
}

function normalizeEngineSelection() {
  const task = selectedAITask.value;
  if (!task) return;
  const providers = selectedEngineProviders.value;
  let models = localAgentModels(selectedEngineState.value);
  if (providers.length) {
    const provider = providers.find((candidate) => candidate.id === task.engineProviderId) ?? providers[0];
    task.engineProviderId = provider?.id ?? "";
    models = provider?.models ?? [];
  } else {
    task.engineProviderId = "";
  }
  if (!models.some((model) => model.id === task.engineModelId)) {
    task.engineModelId = models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? "";
  }
  normalizeReasoningEffort();
  normalizePermissionSelection();
}

function normalizePermissionSelection() {
  const task = selectedAITask.value;
  if (!task || task.executionMode === "api") return;
  if (!permissionProfileOptions.value.some(
    (profile) => profile.id === task.permissionProfileId && profile.available,
  )) {
    task.permissionProfileId = permissionProfileOptions.value.find((profile) => profile.available)?.id || "safe_readonly";
  }
}

function selectWorkspaceMode(mode: typeof workspaceModeOptions[number]["id"]) {
  if (!selectedAITask.value) return;
  selectedAITask.value.workspaceMode = mode;
  if (mode === "none") selectedAITask.value.updatePolicy = "none";
  normalizePermissionSelection();
}

function selectPermissionProfile(profileId: typeof AI_PERMISSION_PROFILE_DEFINITIONS[number]["id"]) {
  const profile = permissionProfileOptions.value.find((candidate) => candidate.id === profileId);
  if (!selectedAITask.value || !profile?.available) return;
  selectedAITask.value.permissionProfileId = profileId;
}

function setTaskExecutionMode(mode: AIExecutionMode) {
  if (!selectedAITask.value) return;
  selectedAITask.value.executionMode = mode;
  if (mode === "api" && !selectedAITask.value.providerConfigId) {
    selectedAITask.value.providerConfigId = providers.value[0]?.id ?? "environment";
  }
  if (mode !== "api") normalizeEngineSelection();
  if (mode === "api") {
    selectedAITask.value.workspaceMode = "none";
    selectedAITask.value.updatePolicy = "none";
    selectedAITask.value.permissionProfileId = "safe_readonly";
  } else {
    normalizePermissionSelection();
  }
  enforceTaxonomyEvidencePolicy(selectedAITask.value);
  selectedAITask.value.lastError = null;
  if (selectedAITask.value.lastStatus === "failed") selectedAITask.value.lastStatus = "never";
}

function isTaskPromptActive(template: AIPromptTemplate) {
  return selectedAITask.value?.promptTemplateId === template.id;
}

async function pollLocalAction(jobId: string, token = localActionPollToken) {
  if (localActionTimer !== null) window.clearTimeout(localActionTimer);
  try {
    const after = localActionEvents.value.at(-1)?.sequence ?? 0;
    const result = await localAnalysisApi.localAnalysisJob(jobId, after);
    if (token !== localActionPollToken) return;
    localActionJob.value = result.job;
    localActionEvents.value.push(...result.events);
    localActionClock.value = Date.now();
    if (!["completed", "failed", "cancelled"].includes(result.job.status)) {
      localActionTimer = window.setTimeout(() => pollLocalAction(jobId, token), 1_000);
      return;
    }
    classificationTaxonomies.value = (await settingsApi.classificationTaxonomies()).taxonomies;
    refreshingTaxonomy.value = "";
    notice.value = result.job.status === "completed"
      ? { kind: "success", text: "分类标准更新完成，详细过程见下方事件记录" }
      : { kind: "error", text: result.job.error || "分类标准更新失败" };
  } catch (cause) {
    if (token !== localActionPollToken) return;
    notice.value = { kind: "error", text: cause instanceof ApiError ? cause.message : "本地任务状态读取失败" };
  }
}

async function cancelTaxonomyRefresh() {
  const job = localActionJob.value;
  if (!job || ["completed", "failed", "cancelled"].includes(job.status)) return;
  try {
    await localAnalysisApi.cancelLocalAnalysisJob(job.id);
    localActionJob.value = { ...job, status: "cancel_requested" };
    notice.value = { kind: "success", text: "已请求取消分类标准更新" };
  } catch (cause) {
    notice.value = { kind: "error", text: cause instanceof ApiError ? cause.message : "取消分类标准更新失败" };
  }
}

async function refreshClassificationStandard() {
  const repoId = taxonomyRefreshRepo.value;
  if (!repoId) return;
  refreshingTaxonomy.value = repoId;
  notice.value = null;
  try {
    const result = await settingsApi.refreshClassificationTaxonomy(repoId);
    if (result.job) {
      notice.value = { kind: "success", text: "分类标准更新已交给本地 Runner" };
      await startLocalAction(result.job);
    } else if (result.taxonomy) {
      classificationTaxonomies.value = classificationTaxonomies.value.map((item) => item.repoId === repoId ? result.taxonomy! : item);
      notice.value = { kind: "success", text: `${result.taxonomy.repositoryName} 分类标准已刷新；仅经过校验的现有类别增量规则已生效` };
    }
  } catch (cause) {
    try {
      classificationTaxonomies.value = (await settingsApi.classificationTaxonomies()).taxonomies;
    } catch {
      // 保留当前状态，原始错误会显示在任务区域。
    }
    notice.value = { kind: "error", text: cause instanceof ApiError ? cause.message : "分类标准刷新失败" };
  } finally {
    if (!localActionJob.value || ["completed", "failed", "cancelled"].includes(localActionJob.value.status)) {
      refreshingTaxonomy.value = "";
    }
  }
}

function resetPromptForm() {
  editingPromptId.value = "";
  showPromptForm.value = false;
  Object.assign(promptForm, { name: "", content: "", makeActive: true });
}

function createPromptFrom(template?: AIPromptTemplate) {
  editingPromptId.value = "";
  showPromptForm.value = true;
  Object.assign(promptForm, {
    name: template ? `${template.name} 副本` : "",
    content: template?.content ?? "",
    makeActive: true,
  });
}

function editPrompt(template: AIPromptTemplate) {
  editingPromptId.value = template.id;
  showPromptForm.value = true;
  Object.assign(promptForm, { name: template.name, content: template.content, makeActive: isTaskPromptActive(template) });
}

async function savePrompt() {
  const feature = selectedPromptFeature.value;
  if (!feature) return;
  saving.value = true;
  notice.value = null;
  try {
    await settingsApi.saveAIPrompt({
      featureKey: feature.key,
      name: promptForm.name,
      content: promptForm.content,
      makeActive: editingPromptId.value ? undefined : promptForm.makeActive,
    }, editingPromptId.value || undefined);
    await reloadPromptFeatures();
    if (!editingPromptId.value && promptForm.makeActive && selectedAITask.value) {
      const created = selectedPromptFeature.value?.templates.find((template) => template.name === promptForm.name && !template.isDefault);
      if (created) {
        selectedAITask.value.promptTemplateId = created.id;
        await saveSelectedAITask();
      }
    }
    notice.value = { kind: "success", text: editingPromptId.value ? "提示词模板已更新" : "提示词模板已添加" };
    resetPromptForm();
  } catch (cause) {
    notice.value = { kind: "error", text: cause instanceof ApiError ? cause.message : "提示词保存失败" };
  } finally {
    saving.value = false;
  }
}

async function activatePrompt(template: AIPromptTemplate) {
  if (isTaskPromptActive(template) || !selectedAITask.value) return;
  saving.value = true;
  notice.value = null;
  try {
    selectedAITask.value.promptTemplateId = template.id;
    await saveSelectedAITask();
    notice.value = { kind: "success", text: `已切换到 ${template.name}` };
  } catch (cause) {
    notice.value = { kind: "error", text: cause instanceof ApiError ? cause.message : "提示词切换失败" };
  } finally {
    saving.value = false;
  }
}

async function removePrompt(template: AIPromptTemplate) {
  if (template.isDefault) {
    notice.value = { kind: "error", text: "默认提示词可以编辑，但不能删除" };
    return;
  }
  if (pendingPromptDeleteId.value !== template.id) {
    pendingPromptDeleteId.value = template.id;
    notice.value = {
      kind: "error",
      text: isTaskPromptActive(template)
        ? `该提示词正在被当前任务使用，请先切换到其他模板`
        : `再次点击确认删除 ${template.name}`,
    };
    if (isTaskPromptActive(template)) pendingPromptDeleteId.value = "";
    return;
  }
  saving.value = true;
  notice.value = null;
  try {
    await settingsApi.deleteAIPrompt(template.id);
    await Promise.all([reloadPromptFeatures(), reloadAIManagement()]);
    if (editingPromptId.value === template.id) resetPromptForm();
    pendingPromptDeleteId.value = "";
    notice.value = { kind: "success", text: "提示词模板已删除" };
  } catch (cause) {
    notice.value = { kind: "error", text: cause instanceof ApiError ? cause.message : "提示词删除失败" };
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await loadAITaskSettings();
  await resumeTaxonomyAction(taxonomyRefreshRepo.value);
});
onBeforeUnmount(() => {
  stopLocalActionPolling();
});
watch(() => [props.initialPromptFeature, props.initialRepo], () => {
  if (!props.initialPromptFeature) return;
  selectedPromptFeatureKey.value = props.initialPromptFeature;
  selectInitialAITask();
  resetPromptForm();
});
watch(taxonomyRefreshRepo, (repoId, previousRepoId) => {
  if (loading.value || repoId === previousRepoId) return;
  void resumeTaxonomyAction(repoId);
});
</script>

<template>
  <div>
    <div v-if="loading" class="settings-loading">正在加载 AI 任务…</div>
    <p v-if="loadError" class="inline-error settings-inline-message">{{ loadError }}</p>
    <div v-if="!loading" class="prompt-center-layout">
      <section class="settings-card prompt-feature-card ai-task-navigation">
        <header><div><strong>业务任务</strong><small>按页面与仓库分组</small></div><span class="settings-status-dot">{{ allAITasks.length }} 项</span></header>
        <div class="ai-task-group-list">
          <section v-for="group in aiManagement?.groups" :key="group.key" class="ai-task-group">
            <header><span>{{ group.name }}</span><small>{{ group.tasks.length }}</small></header>
            <button v-for="task in group.tasks" :key="task.key" class="prompt-feature-item" :class="{ 'prompt-feature-item--active': task.key === selectedAITask?.key }" @click="selectAITask(task)">
              <span class="prompt-feature-item__icon"><Octicon :name="task.name.includes('对话') ? 'comment-discussion' : task.name.includes('分类') ? 'stack' : task.name.includes('分析') || task.name.includes('洞察') ? 'file' : 'git-pull-request'" :size="15" /></span>
              <span><strong>{{ task.name }}</strong><small>{{ taskExecutionLabel(task.executionMode) }} · {{ task.promptTemplateName }}</small></span>
              <span class="ai-task-state-dot" :data-status="task.lastStatus" />
            </button>
          </section>
        </div>
      </section>

      <div v-if="selectedPromptFeature && selectedAITask" class="prompt-template-workspace">
        <section class="settings-card">
          <header>
            <div><strong>{{ selectedAITask.groupName }} / {{ selectedAITask.name }}</strong><small>{{ selectedAITask.description }}</small></div>
            <div class="prompt-header-actions">
              <button v-if="taxonomyRefreshRepo" class="button button--secondary" :disabled="Boolean(refreshingTaxonomy)" @click="refreshClassificationStandard"><Octicon name="sync" :size="14" />{{ refreshingTaxonomy ? "正在更新…" : "更新分类标准" }}</button>
              <button class="button button--primary" @click="createPromptFrom()"><Octicon name="plus" :size="14" />新增模板</button>
            </div>
          </header>

          <div class="ai-task-binding-panel">
            <div class="ai-task-binding-panel__heading">
              <div><span>任务级执行引擎</span><strong>{{ taxonomyRefreshRepo ? "为分类证据包选择引擎、模型与提示词" : "为当前业务任务选择引擎、模型与提示词" }}</strong></div>
              <span class="refresh-status" :data-status="selectedAITask.lastStatus === 'failed' ? 'failed' : selectedAITask.lastStatus === 'never' ? 'stale' : 'ready'">{{ selectedAITask.lastStatus === 'never' ? '尚未运行' : selectedAITask.lastStatus === 'failed' ? '最近失败' : selectedAITask.lastStatus }}</span>
            </div>
            <p v-if="notice" class="settings-context-notice" :data-kind="notice.kind" aria-live="polite"><Octicon :name="notice.kind === 'success' ? 'check-circle-fill' : 'alert'" :size="14" />{{ notice.text }}</p>
            <div class="ai-execution-mode-grid">
              <button v-for="engine in AI_EXECUTION_ENGINES" :key="engine.id" :class="{ active: selectedAITask.executionMode === engine.id }" @click="setTaskExecutionMode(engine.id)"><Octicon :name="executionEngineIcon(engine.id)" :size="16" /><strong>{{ engine.name }}</strong><small>{{ taskEngineDescription(engine.id) }}</small></button>
            </div>

            <div v-if="selectedEngineDefinition.requiresLocalRunner" class="ai-task-engine-capability" :data-status="selectedEngineCapability?.status || 'offline'">
              <span><Octicon name="server" :size="14" />本地 Runner</span>
              <strong>{{ selectedEngineCapability?.statusLabel || '尚未上报引擎能力' }}</strong>
              <small>{{ selectedEngineCapability ? `${selectedEngineCapability.transport} · ${selectedEngineCapability.modelCount} 个模型` : '请先启动 Runner，并在本地运行环境中检查连接' }}</small>
            </div>

            <div v-if="selectedAITask.executionMode === 'api'" class="settings-form__row ai-task-config-fields">
              <label>AI 配置<select v-model="selectedAITask.providerConfigId"><option value="" disabled>请选择 API 配置</option><option v-for="provider in providers" :key="provider.id" :value="provider.id">{{ provider.name }} · {{ provider.model }}</option></select></label>
              <label>当前模型<input :value="selectedTaskProvider?.model || '请先选择配置'" disabled /></label>
            </div>
            <div v-else class="settings-form__row ai-task-config-fields ai-task-config-fields--local">
              <label v-if="selectedEngineProviders.length">Provider<select v-model="selectedAITask.engineProviderId" @change="normalizeEngineSelection"><option value="" disabled>请选择 Provider</option><option v-for="provider in selectedEngineProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option></select></label>
              <label>Model<select v-model="selectedAITask.engineModelId" @change="normalizeReasoningEffort"><option value="">引擎默认模型</option><option v-for="model in selectedEngineModels" :key="model.id" :value="model.id">{{ model.name }}{{ model.isDefault ? ' · 默认' : '' }}</option></select></label>
              <label v-if="supportedReasoningEfforts.length">推理强度<select v-model="selectedAITask.reasoningEffort"><option value="">模型默认 · {{ reasoningEffortLabel(selectedEngineModel?.defaultReasoningEffort || 'medium') }}</option><option v-for="option in supportedReasoningEfforts" :key="option.reasoningEffort" :value="option.reasoningEffort">{{ reasoningEffortLabel(option.reasoningEffort) }}</option></select></label>
            </div>
            <section v-if="taxonomyRefreshRepo" class="taxonomy-evidence-policy">
              <header>
                <span class="taxonomy-evidence-policy__icon"><Octicon name="server" :size="16" /></span>
                <div><strong>数据库证据包</strong><small>分类标准更新使用服务端整理的有限证据，不接触本地源码仓库</small></div>
                <span class="taxonomy-evidence-policy__badge">服务端强制</span>
              </header>
              <div class="taxonomy-evidence-policy__facts">
                <span>最多 80 条近期样本</span>
                <span>修改文件路径</span>
                <span>GitHub Labels</span>
                <span>当前 taxonomy</span>
                <span>分类与置信度</span>
              </div>
              <p><Octicon name="shield-check" :size="14" /><strong>不 Fetch · 不创建 Worktree · 不访问源码</strong><span>执行引擎、模型和提示词仍按当前任务配置。</span></p>
            </section>
            <div v-else-if="selectedAITask.executionMode !== 'api'" class="ai-task-policy-section">
              <div class="ai-task-policy-section__heading">
                <span class="ai-task-policy-section__icon"><Octicon name="lock" :size="15" /></span>
                <div><strong>代码环境</strong><small>选择源码准备方式与 Agent 可用能力</small></div>
                <span class="ai-task-policy-section__guard">Runner 强制执行</span>
              </div>
              <section class="ai-task-policy-block">
                <header><div><strong>工作区</strong><small>{{ selectedWorkspaceMode.description }}</small></div></header>
                <div class="ai-workspace-choice-grid">
                  <button
                    v-for="mode in workspaceModeOptions"
                    :key="mode.id"
                    type="button"
                    :class="{ active: selectedAITask.workspaceMode === mode.id }"
                    @click="selectWorkspaceMode(mode.id)"
                  >
                    <span><Octicon :name="mode.icon" :size="15" /></span>
                    <span><strong>{{ mode.name }}</strong><small>{{ mode.description }}</small></span>
                    <Octicon v-if="selectedAITask.workspaceMode === mode.id" class="ai-policy-check" name="check-circle-fill" :size="13" />
                  </button>
                </div>
                <p v-if="selectedAITask.workspaceMode === 'ephemeral_worktree'" class="ai-task-policy-hint"><Octicon name="sync" :size="13" />Runner 为本任务创建独立 Worktree，不切换共享仓库；成功、失败或取消后都会立即清理，适合并行的一次性任务。</p>
                <p v-else-if="selectedAITask.workspaceMode === 'worktree'" class="ai-task-policy-hint"><Octicon name="workflow" :size="13" />Runner 保留隔离 Worktree 供同版本连续会话复用，并按本地运行环境中的保留时间清理。</p>
              </section>
              <div class="ai-task-policy-columns">
                <section class="ai-task-policy-block ai-task-policy-block--compact">
                  <header><div><strong>仓库更新</strong><small>发生在 Agent 启动之前</small></div></header>
                  <div class="ai-policy-segmented" :data-disabled="selectedAITask.workspaceMode === 'none'">
                    <button type="button" :class="{ active: selectedAITask.updatePolicy === 'none' }" :disabled="selectedAITask.workspaceMode === 'none'" @click="selectedAITask.updatePolicy = 'none'">使用本地</button>
                    <button type="button" :class="{ active: selectedAITask.updatePolicy === 'fetch' }" :disabled="selectedAITask.workspaceMode === 'none'" @click="selectedAITask.updatePolicy = 'fetch'">安全 Fetch</button>
                  </div>
                  <p>{{ selectedAITask.workspaceMode === 'none' ? '无源码模式不访问 Git。' : selectedAITask.updatePolicy === 'fetch' ? '更新远端引用后再解析任务目标，不执行 reset 或 clean。' : '直接使用本地已有对象和引用。' }}</p>
                </section>
                <section class="ai-task-policy-block ai-task-policy-block--compact">
                  <header><div><strong>Agent 权限</strong><small>提示词不能扩大权限</small></div></header>
                  <div class="ai-permission-choice-list">
                    <button
                      v-for="profile in permissionProfileOptions"
                      :key="profile.id"
                      type="button"
                      :disabled="!profile.available"
                      :class="{ active: selectedAITask.permissionProfileId === profile.id, unavailable: !profile.available }"
                      @click="selectPermissionProfile(profile.id)"
                    >
                      <span><Octicon :name="profile.icon" :size="14" /></span>
                      <span><strong>{{ profile.name }}</strong><small>{{ profile.available ? profile.description : profile.unavailableReason }}</small></span>
                      <Octicon v-if="selectedAITask.permissionProfileId === profile.id" class="ai-policy-check" name="check-circle-fill" :size="13" />
                    </button>
                  </div>
                </section>
              </div>
            </div>
            <p class="settings-note">{{ selectedAITask.executionNote }}</p>
            <div v-if="selectedAITask.lastStatus === 'failed' && selectedAITask.lastError" class="ai-task-last-error"><p class="inline-error">最近错误：{{ selectedAITask.lastError }}</p><button class="button button--secondary" :disabled="saving" @click="clearSelectedAITaskError"><Octicon name="x" :size="13" />清除记录</button></div>
            <div class="settings-form__actions"><button class="button button--secondary" :disabled="saving || !selectedAITaskConfigured" @click="testSelectedAITask"><Octicon name="beaker" :size="14" />测试当前组合</button><button class="button button--primary" :disabled="saving || !selectedAITaskConfigured" @click="saveSelectedAITask"><Octicon name="check" :size="14" />保存任务配置</button></div>
          </div>

          <div class="prompt-context-strip"><code>{{ selectedPromptFeature.promptVersion }}</code><span>自动附带</span><code v-for="source in selectedPromptFeature.contextSources" :key="source">{{ source }}</code><small>上下文由服务端安全注入，无需写入模板。</small></div>

          <div v-if="selectedClassificationTaxonomy" class="taxonomy-refresh-summary">
            <div><span>当前标准</span><strong>{{ selectedClassificationTaxonomy.effectiveVersion }}</strong><small>{{ selectedClassificationTaxonomy.categories.length }} 个主要类别 · 最近刷新 {{ formatRefreshTime(selectedClassificationTaxonomy.lastRefreshedAt) }}</small></div>
            <span class="settings-status-dot" :class="{ 'settings-status-dot--error': selectedClassificationTaxonomy.status === 'failed' }">{{ selectedClassificationTaxonomy.status === "failed" ? "刷新失败" : selectedClassificationTaxonomy.status === "running" ? "正在更新" : "规则已就绪" }}</span>
            <p v-if="selectedClassificationTaxonomy.lastError" class="inline-error">{{ selectedClassificationTaxonomy.lastError }}</p>
            <details v-if="selectedClassificationTaxonomy.analysisMd"><summary>查看最近分类标准分析</summary><pre>{{ selectedClassificationTaxonomy.analysisMd }}</pre></details>
            <small>更新只会合并已注册类别的安全增量；不会自动重跑已有 PR/Issue 标签。若要应用新标准，请到“社区数据刷新”单独执行分类标签刷新。</small>
          </div>

          <section v-if="localActionJob && localActionProgress" class="taxonomy-run-progress" :data-status="localActionJob.status" aria-live="polite">
            <header>
              <div><span class="taxonomy-run-progress__pulse" /><div><strong>{{ localActionProgress.label }}</strong><small>{{ localActionElapsed }} · {{ localActionProgress.percent }}%</small></div></div>
              <button
                v-if="!['completed', 'failed', 'cancelled'].includes(localActionJob.status)"
                class="button button--secondary"
                :disabled="localActionJob.status === 'cancel_requested'"
                @click="cancelTaxonomyRefresh"
              ><Octicon name="x" :size="13" />{{ localActionJob.status === 'cancel_requested' ? '正在取消' : '取消任务' }}</button>
            </header>
            <div class="taxonomy-run-progress__track" role="progressbar" aria-label="分类标准更新进度" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="localActionProgress.percent"><span :style="{ width: `${localActionProgress.percent}%` }" /></div>
            <p>{{ localActionProgress.detail }}</p>
          </section>

          <div v-if="localActionJob" class="local-analysis-terminal" :data-status="localActionJob.status">
            <header><div><span class="local-analysis-terminal__lamp" /><strong>本地任务执行过程</strong></div><small>{{ localActionJob.status }}</small></header>
            <div class="local-analysis-terminal__events" aria-live="polite"><p v-if="!localActionEvents.length"><code>[Queue]</code> 等待 Runner…</p><p v-for="event in localActionEvents" :key="event.sequence" :data-level="event.level"><time>{{ new Date(event.createdAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</time><code>[{{ event.source }}]</code><span>{{ event.message }}</span></p></div>
          </div>

          <div class="prompt-template-list">
            <article v-for="template in selectedPromptFeature.templates" :key="template.id" class="prompt-template-item" :class="{ 'prompt-template-item--active': isTaskPromptActive(template) }">
              <div class="prompt-template-item__heading"><span class="prompt-template-item__icon"><Octicon :name="template.isDefault ? 'shield-check' : 'file'" :size="15" /></span><div><strong>{{ template.name }}</strong><small>{{ template.isDefault ? `默认模板 · 可编辑 · r${template.revision}` : `自定义 · r${template.revision}` }}</small></div><span v-if="isTaskPromptActive(template)" class="settings-status-dot">该任务使用中</span></div>
              <p>{{ template.content }}</p>
              <div class="prompt-template-item__actions">
                <button v-if="!isTaskPromptActive(template)" class="button button--secondary" :disabled="saving" @click="activatePrompt(template)">使用</button>
                <button class="button button--secondary" @click="createPromptFrom(template)"><Octicon name="copy" :size="13" />复制</button>
                <button class="icon-button" aria-label="编辑提示词" @click="editPrompt(template)"><Octicon name="pencil" :size="13" /></button>
                <button v-if="!template.isDefault" class="icon-button provider-item__delete" :class="{ 'provider-item__delete--confirm': pendingPromptDeleteId === template.id }" :aria-label="pendingPromptDeleteId === template.id ? '确认删除提示词' : '删除提示词'" @click="removePrompt(template)"><Octicon :name="pendingPromptDeleteId === template.id ? 'check' : 'trash'" :size="13" /></button>
              </div>
            </article>
          </div>
        </section>

        <section v-if="showPromptForm" class="settings-card prompt-editor-card">
          <header><div><strong>{{ editingPromptId ? "编辑提示词" : "新增提示词" }}</strong><small>只控制分析侧重点；输出协议和安全约束由系统维护</small></div><button class="button button--secondary" @click="resetPromptForm">取消</button></header>
          <form class="settings-form" @submit.prevent="savePrompt">
            <label>模板名称<input v-model="promptForm.name" maxlength="80" placeholder="例如：Ascend 兼容性优先" required /></label>
            <label>提示词内容<textarea v-model="promptForm.content" rows="8" maxlength="8000" placeholder="描述希望模型关注的分析角度、优先级和输出偏好" required /><small>{{ promptForm.content.length }} / 8000 字</small></label>
            <label v-if="!editingPromptId" class="settings-checkbox"><input v-model="promptForm.makeActive" type="checkbox" />保存后立即用于当前任务</label>
            <p class="settings-note">修改只影响后续生成的内容；历史分析仍保留原模板名称、修订号和内容快照。</p>
            <div class="settings-form__actions"><button class="button button--primary" :disabled="saving"><Octicon name="check" :size="14" />{{ editingPromptId ? "保存修改" : "添加模板" }}</button></div>
          </form>
        </section>
      </div>
    </div>
  </div>
</template>
