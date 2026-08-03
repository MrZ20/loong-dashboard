<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { api, ApiError } from "../api/client";
import type {
  AIProviderConfig,
  AIExecutionMode,
  AIManagementState,
  AIPromptFeature,
  AIPromptTemplate,
  AITaskKey,
  AITaskSetting,
  ClassificationTaxonomyState,
  PromptFeatureKey,
  RefreshTaskState,
  RefreshTaskType,
  LocalAnalysisEvent,
  LocalAnalysisJob,
  LocalRunnerSettingsState,
  GitHubCredentialState,
  UserAccount,
} from "../types";
import Octicon from "./Octicon.vue";

const emit = defineEmits<{
  "update:user": [value: UserAccount];
}>();

const props = defineProps<{
  initialTab?: "account" | "management" | "refresh";
  initialPromptFeature?: PromptFeatureKey;
  initialRepo?: string;
}>();

const activeTab = ref<"account" | "management" | "refresh">(
  props.initialTab || "account",
);
const aiManagerSection = ref<"tasks" | "configs" | "opencode">("tasks");
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const message = ref("");
const accounts = ref<UserAccount[]>([]);
const canAddAccounts = ref(false);
const providers = ref<AIProviderConfig[]>([]);
const aiManagement = ref<AIManagementState | null>(null);
const selectedAITaskKey = ref<AITaskKey>("vllm_ascend_pr_summary");
const promptFeatures = ref<AIPromptFeature[]>([]);
const classificationTaxonomies = ref<ClassificationTaxonomyState[]>([]);
const refreshingTaxonomy = ref<"vllm" | "vllm-ascend" | "">("");
const refreshTasks = ref<RefreshTaskState[]>([]);
const githubSettings = ref<GitHubCredentialState | null>(null);
const githubToken = ref("");
const pendingGithubDelete = ref(false);
const selectedRefreshRepo = ref("vllm-ascend");
const refreshingTask = ref<RefreshTaskType | "">("");
const selectedPromptFeatureKey = ref<PromptFeatureKey>(
  props.initialPromptFeature || "pr_triage",
);
const currentProfile = ref<UserAccount | null>(null);
const showAccountForm = ref(false);
const editingProviderId = ref("");
const pendingProviderDeleteId = ref("");
const editingPromptId = ref("");
const pendingPromptDeleteId = ref("");
const showPromptForm = ref(false);
const localRunnerState = ref<LocalRunnerSettingsState | null>(null);
const localActionJob = ref<LocalAnalysisJob | null>(null);
const localActionEvents = ref<LocalAnalysisEvent[]>([]);
let localActionTimer: number | null = null;

const profileForm = reactive({
  displayName: "",
  role: "",
  organization: "",
  bio: "",
});
const accountForm = reactive({
  email: "",
  displayName: "",
  role: "",
  organization: "",
});
const providerForm = reactive({
  name: "",
  baseUrl: "https://api.openai.com/v1",
  apiMode: "responses" as AIProviderConfig["apiMode"],
  model: "gpt-5-mini",
  token: "",
  makeActive: true,
});
const promptForm = reactive({
  name: "",
  content: "",
  makeActive: true,
});

const selectedPromptFeature = computed(
  () =>
    promptFeatures.value.find(
      (feature) => feature.key === selectedPromptFeatureKey.value,
    ) ?? promptFeatures.value[0] ?? null,
);
const allAITasks = computed(() =>
  aiManagement.value?.groups.flatMap((group) => group.tasks) ?? [],
);
const selectedAITask = computed(() =>
  allAITasks.value.find((task) => task.key === selectedAITaskKey.value) ??
  allAITasks.value[0] ??
  null,
);
const selectedTaskProvider = computed(() =>
  providers.value.find(
    (provider) => provider.id === selectedAITask.value?.providerConfigId,
  ) ?? null,
);
const selectedOpenCodeModels = computed(() =>
  aiManagement.value?.runner.providers.find(
    (provider) => provider.id === selectedAITask.value?.opencodeProviderId,
  )?.models ?? [],
);
const taxonomyRefreshRepo = computed<"vllm" | "vllm-ascend" | null>(() => {
  if (selectedPromptFeatureKey.value === "vllm_taxonomy_refresh") return "vllm";
  if (selectedPromptFeatureKey.value === "vllm_ascend_taxonomy_refresh") return "vllm-ascend";
  return null;
});
const selectedClassificationTaxonomy = computed(() =>
  classificationTaxonomies.value.find(
    (taxonomy) => taxonomy.repoId === taxonomyRefreshRepo.value,
  ) ?? null,
);
const selectedRefreshTasks = computed(() =>
  refreshTasks.value
    .filter((task) => task.repoId === selectedRefreshRepo.value)
    .sort(
      (left, right) =>
        ["facts", "summary", "classification", "deep_analysis"].indexOf(left.taskType) -
        ["facts", "summary", "classification", "deep_analysis"].indexOf(right.taskType),
    ),
);

function report(cause: unknown, fallback: string) {
  error.value = cause instanceof ApiError ? cause.message : fallback;
}

function resetProviderForm() {
  editingProviderId.value = "";
  providerForm.name = "";
  providerForm.baseUrl = "https://api.openai.com/v1";
  providerForm.apiMode = "responses";
  providerForm.model = "gpt-5-mini";
  providerForm.token = "";
  providerForm.makeActive = true;
}

function editProvider(provider: AIProviderConfig) {
  editingProviderId.value = provider.id;
  providerForm.name = provider.name;
  providerForm.baseUrl = provider.baseUrl;
  providerForm.apiMode = provider.apiMode;
  providerForm.model = provider.model;
  providerForm.token = "";
  providerForm.makeActive = provider.active;
}

async function loadSettings() {
  loading.value = true;
  error.value = "";
  try {
    const [profileResult, accountResult, providerResult, promptResult, refreshResult, githubResult, localResult, taxonomyResult, aiManagementResult] = await Promise.all([
      api.profile(),
      api.accounts(),
      api.aiProviders(),
      api.aiPrompts(),
      api.refreshSettings(),
      api.githubSettings(),
      api.localAnalysisSettings(),
      api.classificationTaxonomies(),
      api.aiManagement(),
    ]);
    currentProfile.value = profileResult.profile;
    Object.assign(profileForm, {
      displayName: profileResult.profile.displayName,
      role: profileResult.profile.role,
      organization: profileResult.profile.organization,
      bio: profileResult.profile.bio,
    });
    accounts.value = accountResult.accounts;
    canAddAccounts.value = accountResult.canAdd;
    providers.value = providerResult.providers;
    promptFeatures.value = promptResult.features;
    refreshTasks.value = refreshResult.tasks;
    githubSettings.value = githubResult.github;
    localRunnerState.value = localResult;
    aiManagement.value = aiManagementResult;
    classificationTaxonomies.value = taxonomyResult.taxonomies;
    if (
      !promptFeatures.value.some(
        (feature) => feature.key === selectedPromptFeatureKey.value,
      )
    ) {
      selectedPromptFeatureKey.value = promptFeatures.value[0]?.key ?? "pr_triage";
    }
    selectInitialAITask();
  } catch (cause) {
    report(cause, "设置加载失败");
  } finally {
    loading.value = false;
  }
}

function selectInitialAITask() {
  const feature = props.initialPromptFeature;
  const repo = props.initialRepo;
  const candidates = allAITasks.value.filter((task) =>
    !feature || task.featureKey === feature,
  );
  const selected = candidates.find((task) => task.repoScope === repo) ?? candidates[0];
  if (selected) selectAITask(selected);
}

function selectAITask(task: AITaskSetting) {
  selectedAITaskKey.value = task.key;
  selectedPromptFeatureKey.value = task.featureKey;
  pendingPromptDeleteId.value = "";
  resetPromptForm();
}

async function reloadAIManagement() {
  aiManagement.value = await api.aiManagement();
}

async function saveSelectedAITask() {
  const task = selectedAITask.value;
  if (!task) return;
  saving.value = true;
  error.value = "";
  try {
    await api.updateAITask(task.key, {
      executionMode: task.executionMode,
      providerConfigId: task.providerConfigId,
      opencodeProviderId: task.opencodeProviderId,
      opencodeModelId: task.opencodeModelId,
      promptTemplateId: task.promptTemplateId,
    });
    await Promise.all([reloadAIManagement(), reloadProviders()]);
    message.value = `${task.groupName} / ${task.name} 配置已保存`;
  } catch (cause) {
    report(cause, "AI 任务配置保存失败");
  } finally {
    saving.value = false;
  }
}

async function testSelectedAITask() {
  const task = selectedAITask.value;
  if (!task) return;
  saving.value = true;
  error.value = "";
  try {
    await saveSelectedAITask();
    const result = await api.testAITask(task.key);
    await reloadAIManagement();
    message.value = result.message;
  } catch (cause) {
    report(cause, "当前 AI 组合测试失败");
  } finally {
    saving.value = false;
  }
}

function setTaskExecutionMode(mode: AIExecutionMode) {
  if (!selectedAITask.value) return;
  selectedAITask.value.executionMode = mode;
  if (mode === "environment") selectedAITask.value.providerConfigId = "environment";
  if (mode === "account_api" && selectedAITask.value.providerConfigId === "environment") {
    selectedAITask.value.providerConfigId = providers.value.find((provider) => !provider.builtIn)?.id ?? "";
  }
}

function isTaskPromptActive(template: AIPromptTemplate) {
  return selectedAITask.value?.promptTemplateId === template.id;
}

async function saveGithubToken() {
  if (!githubToken.value.trim()) {
    error.value = "请输入 GitHub Token";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    githubSettings.value = (await api.saveGithubToken(githubToken.value)).github;
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
    githubSettings.value = (await api.testGithubToken()).github;
    message.value = "GitHub Token 验证成功";
  } catch (cause) {
    report(cause, "GitHub Token 验证失败");
    githubSettings.value = (await api.githubSettings()).github;
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
    githubSettings.value = (await api.deleteGithubToken()).github;
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

function githubRateLimitLabel() {
  const state = githubSettings.value;
  if (state?.rateLimitRemaining == null || state.rateLimitLimit == null) {
    return "尚未测试";
  }
  return `${state.rateLimitRemaining} / ${state.rateLimitLimit}`;
}

async function saveLocalAnalysisSettings() {
  if (!localRunnerState.value) return;
  saving.value = true;
  error.value = "";
  try {
    localRunnerState.value = await api.updateLocalAnalysisSettings(localRunnerState.value.settings);
    message.value = "本地分析设置已保存";
  } catch (cause) {
    report(cause, "本地分析设置保存失败");
  } finally {
    saving.value = false;
  }
}

async function pollLocalAction(jobId: string) {
  if (localActionTimer !== null) window.clearTimeout(localActionTimer);
  try {
    const after = localActionEvents.value.at(-1)?.sequence ?? 0;
    const result = await api.localAnalysisJob(jobId, after);
    localActionJob.value = result.job;
    localActionEvents.value.push(...result.events);
    if (!["completed", "failed", "cancelled"].includes(result.job.status)) {
      localActionTimer = window.setTimeout(() => pollLocalAction(jobId), 1_000);
      return;
    }
    localRunnerState.value = await api.localAnalysisSettings();
    if (result.job.subjectKind === "taxonomy") {
      classificationTaxonomies.value = (await api.classificationTaxonomies()).taxonomies;
      refreshingTaxonomy.value = "";
    }
    message.value = result.job.status === "completed" ? "本地 Runner 操作完成" : (result.job.error || "本地 Runner 操作失败");
  } catch (cause) {
    report(cause, "本地 Runner 操作状态读取失败");
  }
}

async function runLocalAction(action: string, repository = "") {
  error.value = "";
  localActionEvents.value = [];
  try {
    const result = await api.runLocalAnalysisAction(action, repository);
    localActionJob.value = result.job;
    await pollLocalAction(result.job.id);
  } catch (cause) {
    report(cause, "本地 Runner 操作失败");
  }
}

function localRepoLabel(repository: string) {
  const status = localRunnerState.value?.runner.repositories?.[repository];
  if (!status?.exists) return "尚未初始化";
  if (!status.git) return "目录不是 Git 仓库";
  return `就绪 · ${status.head || '未知 Head'}`;
}

async function reloadPromptFeatures() {
  promptFeatures.value = (await api.aiPrompts()).features;
}

async function reloadProviders() {
  providers.value = (await api.aiProviders()).providers;
}

async function refreshClassificationStandard() {
  const repoId = taxonomyRefreshRepo.value;
  if (!repoId) return;
  refreshingTaxonomy.value = repoId;
  error.value = "";
  try {
    const result = await api.refreshClassificationTaxonomy(repoId);
    if (result.job) {
      localActionJob.value = result.job;
      localActionEvents.value = [];
      message.value = "分类标准更新已交给 OpenCode Runner";
      await pollLocalAction(result.job.id);
    } else if (result.taxonomy) {
      classificationTaxonomies.value = classificationTaxonomies.value.map((item) =>
        item.repoId === repoId ? result.taxonomy! : item,
      );
      message.value = `${result.taxonomy.repositoryName} 分类标准已刷新；仅经过校验的现有类别增量规则已生效`;
    }
  } catch (cause) {
    try {
      classificationTaxonomies.value = (await api.classificationTaxonomies()).taxonomies;
    } catch {
      // 保留当前可见状态，原始错误由下方统一呈现。
    }
    report(cause, "分类标准刷新失败");
  } finally {
    if (!localActionJob.value || ["completed", "failed", "cancelled"].includes(localActionJob.value.status)) {
      refreshingTaxonomy.value = "";
    }
  }
}

async function reloadRefreshTasks() {
  refreshTasks.value = (await api.refreshSettings()).tasks;
}

function refreshTaskTitle(taskType: RefreshTaskType) {
  return {
    facts: "社区事实",
    summary: "摘要分析",
    classification: "分类标签",
    deep_analysis: "深度分析",
  }[taskType];
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
    await api.updateRefreshSettings(task.repoId, task.taskType, {
      autoEnabled: task.autoEnabled,
      intervalMinutes: task.intervalMinutes,
      activeRangeHours: task.activeRangeHours,
      refreshRule: task.refreshRule,
      maxItems: task.maxItems,
      includeCiChanges: task.includeCiChanges,
      includeCommentChanges: task.includeCommentChanges,
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
    const result = await api.refreshRepositoryTask(task.repoId, task.taskType);
    await reloadRefreshTasks();
    message.value = `${refreshTaskTitle(task.taskType)}刷新完成，处理 ${Number(result.run.itemCount ?? 0)} 条`;
  } catch (cause) {
    await reloadRefreshTasks();
    report(cause, `${refreshTaskTitle(task.taskType)}刷新失败`);
  } finally {
    refreshingTask.value = "";
  }
}

function resetPromptForm() {
  editingPromptId.value = "";
  showPromptForm.value = false;
  Object.assign(promptForm, { name: "", content: "", makeActive: true });
}

function selectPromptFeature(feature: AIPromptFeature) {
  selectedPromptFeatureKey.value = feature.key;
  pendingPromptDeleteId.value = "";
  resetPromptForm();
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
  if (template.builtIn) return;
  editingPromptId.value = template.id;
  showPromptForm.value = true;
  Object.assign(promptForm, {
    name: template.name,
    content: template.content,
    makeActive: template.active,
  });
}

async function savePrompt() {
  const feature = selectedPromptFeature.value;
  if (!feature) return;
  saving.value = true;
  error.value = "";
  try {
    await api.saveAIPrompt(
      {
        featureKey: feature.key,
        name: promptForm.name,
        content: promptForm.content,
        makeActive: editingPromptId.value ? undefined : promptForm.makeActive,
      },
      editingPromptId.value || undefined,
    );
    await reloadPromptFeatures();
    if (!editingPromptId.value && promptForm.makeActive && selectedAITask.value) {
      const created = selectedPromptFeature.value?.templates.find(
        (template) => template.name === promptForm.name && !template.builtIn,
      );
      if (created) {
        selectedAITask.value.promptTemplateId = created.id;
        await saveSelectedAITask();
      }
    }
    message.value = editingPromptId.value
      ? "提示词模板已更新"
      : "提示词模板已添加";
    resetPromptForm();
  } catch (cause) {
    report(cause, "提示词保存失败");
  } finally {
    saving.value = false;
  }
}

async function activatePrompt(template: AIPromptTemplate) {
  if (isTaskPromptActive(template)) return;
  saving.value = true;
  error.value = "";
  try {
    if (!selectedAITask.value) return;
    selectedAITask.value.promptTemplateId = template.id;
    await saveSelectedAITask();
    message.value = `已切换到 ${template.name}`;
  } catch (cause) {
    report(cause, "提示词切换失败");
  } finally {
    saving.value = false;
  }
}

async function removePrompt(template: AIPromptTemplate) {
  if (template.builtIn) return;
  if (pendingPromptDeleteId.value !== template.id) {
    pendingPromptDeleteId.value = template.id;
    message.value = template.active
      ? `再次点击确认删除 ${template.name}；该功能将回到系统默认`
      : `再次点击确认删除 ${template.name}`;
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    await api.deleteAIPrompt(template.id);
    await Promise.all([reloadPromptFeatures(), reloadAIManagement()]);
    if (editingPromptId.value === template.id) resetPromptForm();
    pendingPromptDeleteId.value = "";
    message.value = "提示词模板已删除";
  } catch (cause) {
    report(cause, "提示词删除失败");
  } finally {
    saving.value = false;
  }
}

async function saveProfile() {
  saving.value = true;
  error.value = "";
  try {
    const { profile } = await api.updateProfile(profileForm);
    currentProfile.value = profile;
    accounts.value = accounts.value.map((item) =>
      item.id === profile.id ? profile : item,
    );
    emit("update:user", profile);
    message.value = "账户资料已保存";
  } catch (cause) {
    report(cause, "账户资料保存失败");
  } finally {
    saving.value = false;
  }
}

async function createAccount() {
  saving.value = true;
  error.value = "";
  try {
    const { account } = await api.createAccount(accountForm);
    accounts.value.push(account);
    Object.assign(accountForm, {
      email: "",
      displayName: "",
      role: "",
      organization: "",
    });
    showAccountForm.value = false;
    message.value = "新账户已创建，可随时切换登录";
  } catch (cause) {
    report(cause, "账户创建失败");
  } finally {
    saving.value = false;
  }
}

async function switchAccount(account: UserAccount) {
  if (account.current) return;
  saving.value = true;
  error.value = "";
  try {
    await api.switchAccount(account.id);
    window.location.reload();
  } catch (cause) {
    report(cause, "账户切换失败");
    saving.value = false;
  }
}

async function saveProvider() {
  saving.value = true;
  error.value = "";
  try {
    await api.saveAIProvider(providerForm, editingProviderId.value || undefined);
    await reloadProviders();
    message.value = editingProviderId.value
      ? "AI 配置已更新"
      : "AI 配置已添加";
    resetProviderForm();
  } catch (cause) {
    report(cause, "AI 配置保存失败");
  } finally {
    saving.value = false;
  }
}

async function activateProvider(provider: AIProviderConfig) {
  saving.value = true;
  error.value = "";
  try {
    await api.activateAIProvider(provider.id);
    providers.value = providers.value.map((item) => ({
      ...item,
      active: item.id === provider.id,
    }));
    message.value = `已切换到 ${provider.name}`;
  } catch (cause) {
    report(cause, "AI 配置切换失败");
  } finally {
    saving.value = false;
  }
}

async function removeProvider(provider: AIProviderConfig) {
  if (pendingProviderDeleteId.value !== provider.id) {
    pendingProviderDeleteId.value = provider.id;
    message.value = `再次点击确认删除 ${provider.name}`;
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    await api.deleteAIProvider(provider.id);
    await reloadProviders();
    if (editingProviderId.value === provider.id) resetProviderForm();
    pendingProviderDeleteId.value = "";
    message.value = "AI 配置已删除";
  } catch (cause) {
    report(cause, "AI 配置删除失败");
  } finally {
    saving.value = false;
  }
}

onMounted(loadSettings);

watch(
  () => props.initialPromptFeature,
  (feature) => {
    if (!feature) return;
    activeTab.value = "management";
    aiManagerSection.value = "tasks";
    selectedPromptFeatureKey.value = feature;
    selectInitialAITask();
    resetPromptForm();
  },
);
</script>

<template>
  <section class="workspace-view settings-view">
    <header class="workspace-view__heading">
      <div>
        <span class="eyebrow">ACCOUNT & AI CONFIGURATION</span>
        <h2>设置</h2>
        <p>集中管理账户、AI 配置、任务级执行方式与提示词；社区数据刷新保持独立。</p>
      </div>
      <div class="settings-tabs">
        <button
          :class="{ 'settings-tabs__active': activeTab === 'account' }"
          @click="activeTab = 'account'"
        >
          <Octicon name="person" :size="14" />账户与登录
        </button>
        <button
          :class="{ 'settings-tabs__active': activeTab === 'management' }"
          @click="activeTab = 'management'"
        >
          <Octicon name="copilot" :size="14" />AI 管理
        </button>
        <button
          :class="{ 'settings-tabs__active': activeTab === 'refresh' }"
          @click="activeTab = 'refresh'"
        >
          <Octicon name="sync" :size="14" />社区数据刷新
        </button>
      </div>
    </header>

    <div v-if="loading" class="settings-loading">正在加载设置…</div>
    <p v-else-if="error" class="inline-error settings-inline-message">{{ error }}</p>
    <p v-if="message" class="settings-success">
      <Octicon name="check-circle-fill" :size="14" />{{ message }}
    </p>

    <div v-if="!loading && activeTab === 'account'" class="settings-layout">
      <section class="settings-card">
        <header>
          <div><strong>当前账户资料</strong><small>该账户的关注、对话和 AI 配置相互隔离</small></div>
          <span class="settings-status-dot">已登录</span>
        </header>
        <form class="settings-form" @submit.prevent="saveProfile">
          <label>邮箱<input :value="currentProfile?.email" disabled /></label>
          <label>显示名称<input v-model="profileForm.displayName" required /></label>
          <div class="settings-form__row">
            <label>角色<input v-model="profileForm.role" placeholder="例如：社区维护者" /></label>
            <label>组织<input v-model="profileForm.organization" placeholder="团队或公司" /></label>
          </div>
          <label>个人说明<textarea v-model="profileForm.bio" rows="4" placeholder="维护领域、关注方向等" /></label>
          <div class="settings-form__actions">
            <button class="button button--primary" :disabled="saving">
              <Octicon name="check" :size="14" />保存资料
            </button>
          </div>
        </form>
      </section>

      <section class="settings-card">
        <header>
          <div><strong>登录账户</strong><small>本地调试账户拥有独立数据空间</small></div>
          <button
            v-if="canAddAccounts"
            class="button button--secondary"
            @click="showAccountForm = !showAccountForm"
          >
            <Octicon name="person-add" :size="14" />新增账户
          </button>
        </header>

        <form v-if="showAccountForm" class="settings-inline-form" @submit.prevent="createAccount">
          <input v-model="accountForm.email" type="email" placeholder="邮箱" required />
          <input v-model="accountForm.displayName" placeholder="显示名称" required />
          <input v-model="accountForm.role" placeholder="角色（可选）" />
          <input v-model="accountForm.organization" placeholder="组织（可选）" />
          <button class="button button--primary" :disabled="saving">创建</button>
        </form>

        <div class="account-list">
          <article v-for="account in accounts" :key="account.id" class="account-item">
            <span class="account-item__avatar">{{ account.displayName.slice(0, 1).toUpperCase() }}</span>
            <div>
              <strong>{{ account.displayName }}</strong>
              <small>{{ account.email }}</small>
              <span>{{ [account.role, account.organization].filter(Boolean).join(" · ") || "未填写账户资料" }}</span>
            </div>
            <span v-if="account.current" class="settings-status-dot">当前</span>
            <button
              v-else
              class="button button--secondary"
              :disabled="saving || !canAddAccounts"
              @click="switchAccount(account)"
            >
              切换登录
            </button>
          </article>
        </div>
        <p v-if="!canAddAccounts" class="settings-note">
          生产环境账户由 ChatGPT 登录管理；如需切换，请先退出再使用另一账户登录。
        </p>
      </section>
    </div>

    <div v-if="!loading && activeTab === 'management'" class="ai-management-switcher">
      <button :class="{ active: aiManagerSection === 'tasks' }" @click="aiManagerSection = 'tasks'">
        <Octicon name="workflow" :size="14" />AI 任务
      </button>
      <button :class="{ active: aiManagerSection === 'configs' }" @click="aiManagerSection = 'configs'">
        <Octicon name="cpu" :size="14" />AI 配置
      </button>
      <button :class="{ active: aiManagerSection === 'opencode' }" @click="aiManagerSection = 'opencode'">
        <Octicon name="terminal" :size="14" />OpenCode
      </button>
    </div>

    <div v-if="!loading && activeTab === 'management' && aiManagerSection === 'configs'" class="settings-layout settings-layout--ai">
      <section class="settings-card">
        <header>
          <div><strong>可用 AI 配置</strong><small>统一管理 Compatible 调试配置与多个账户 API</small></div>
        </header>
        <div class="provider-list">
          <article
            v-for="provider in providers"
            :key="provider.id"
            class="provider-item"
            :class="{ 'provider-item--active': provider.active }"
          >
            <span class="provider-item__icon"><Octicon name="cpu" :size="17" /></span>
            <div>
              <strong>{{ provider.name }}</strong>
              <small>{{ provider.model }} · {{ provider.apiMode === "responses" ? "Responses API" : "Chat Completions" }}</small>
              <span>
                {{ provider.tokenConfigured ? `Token ••••${provider.tokenHint}` : provider.builtIn ? "尚未配置环境 Token" : "无 Token" }}
              </span>
            </div>
            <span v-if="provider.usageCount" class="settings-status-dot">{{ provider.usageCount }} 个任务</span>
            <span v-else-if="provider.active" class="settings-status-dot">兼容默认</span>
            <button
              v-else
              class="button button--secondary"
              :disabled="saving"
              @click="activateProvider(provider)"
            >
              设为兼容默认
            </button>
            <button
              v-if="!provider.builtIn"
              class="icon-button"
              aria-label="编辑 AI 配置"
              @click="editProvider(provider)"
            >
              <Octicon name="pencil" :size="13" />
            </button>
            <button
              v-if="!provider.builtIn"
              class="icon-button provider-item__delete"
              :class="{
                'provider-item__delete--confirm':
                  pendingProviderDeleteId === provider.id,
              }"
              :aria-label="
                pendingProviderDeleteId === provider.id
                  ? '确认删除 AI 配置'
                  : '删除 AI 配置'
              "
              @click="removeProvider(provider)"
            >
              <Octicon
                :name="
                  pendingProviderDeleteId === provider.id ? 'check' : 'trash'
                "
                :size="13"
              />
            </button>
          </article>
        </div>
      </section>

      <section class="settings-card">
        <header>
          <div>
            <strong>{{ editingProviderId ? "编辑 AI 配置" : "添加 AI API" }}</strong>
            <small>保留 OpenAI-compatible，可添加多个端点和模型</small>
          </div>
          <button v-if="editingProviderId" class="button button--secondary" @click="resetProviderForm">
            取消编辑
          </button>
        </header>
        <form class="settings-form" @submit.prevent="saveProvider">
          <label>配置名称<input v-model="providerForm.name" placeholder="例如：OpenAI 调试" required /></label>
          <label>API Base URL<input v-model="providerForm.baseUrl" type="url" required /></label>
          <div class="settings-form__row">
            <label>
              接口模式
              <select v-model="providerForm.apiMode">
                <option value="responses">Responses API</option>
                <option value="chat_completions">Chat Completions</option>
              </select>
            </label>
            <label>模型名称<input v-model="providerForm.model" placeholder="模型 ID" required /></label>
          </div>
          <label>
            API Token
            <input
              v-model="providerForm.token"
              type="password"
              autocomplete="new-password"
              :placeholder="editingProviderId ? '留空则保留已有 Token' : '输入 API Token'"
            />
          </label>
          <label class="settings-checkbox">
            <input v-model="providerForm.makeActive" type="checkbox" />
              保存后设为尚未单独配置任务的兼容默认
          </label>
          <p class="settings-note">
            Token 使用服务端 AES-GCM 加密后保存，接口和页面不会返回明文。
          </p>
          <div class="settings-form__actions">
            <button class="button button--primary" :disabled="saving">
              <Octicon name="key" :size="14" />{{ editingProviderId ? "保存修改" : "添加配置" }}
            </button>
          </div>
        </form>
      </section>
    </div>

    <div v-if="!loading && activeTab === 'refresh'" class="refresh-settings-workspace">
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
            <article><span>REST Core 额度</span><strong>{{ githubRateLimitLabel() }}</strong></article>
            <article><span>上次验证</span><strong>{{ githubSettings.lastVerifiedAt ? formatRefreshTime(githubSettings.lastVerifiedAt) : '尚未测试' }}</strong></article>
          </div>
          <form class="github-token-form" @submit.prevent="saveGithubToken">
            <label>
              <span>GitHub Personal Access Token</span>
              <input
                v-model="githubToken"
                type="password"
                autocomplete="new-password"
                placeholder="粘贴新 Token；已保存值不会回显"
              />
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
          <p v-if="githubSettings.rateLimitResetAt" class="settings-note">当前额度预计于 {{ new Date(githubSettings.rateLimitResetAt).toLocaleString('zh-CN') }} 重置。</p>
          <p v-if="githubSettings.lastError" class="inline-error">最近验证错误：{{ githubSettings.lastError }}</p>
          <p class="settings-note">Token 使用服务端 AES-GCM 加密后按账户保存；页面、日志和 API 均不会返回明文。公开仓库只需要最小只读权限。</p>
        </div>
      </section>

      <section class="settings-card refresh-settings-repos">
        <header>
          <div>
            <strong>仓库配置</strong>
            <small>两个仓库独立保存刷新策略与运行状态</small>
          </div>
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
                {{
                  task.taskType === 'facts'
                    ? 'GitHub 与本地规则事实，不调用 AI'
                    : task.taskType === 'summary'
                      ? '仅处理缺失或已过期的摘要'
                      : task.taskType === 'classification'
                        ? '默认仅首次分类，人工结果不会被覆盖'
                        : '始终由详情页明确启动'
                }}
              </small>
            </div>
            <span class="refresh-status" :data-status="task.status">
              {{ task.status === 'running' ? '运行中' : task.status === 'failed' ? '失败' : task.stale ? '数据过期' : '正常' }}
            </span>
          </header>

          <div class="refresh-task-metrics">
            <span><small>上次成功</small><strong>{{ formatRefreshTime(task.lastSuccessfulAt) }}</strong></span>
            <span><small>下次计划</small><strong>{{ formatRefreshTime(task.nextScheduledAt) }}</strong></span>
            <span><small>待处理</small><strong>{{ task.pendingCount }} 条</strong></span>
          </div>

          <p v-if="task.lastError" class="inline-error refresh-task-error">
            最近错误：{{ task.lastError }}
          </p>

          <div v-if="task.taskType !== 'deep_analysis'" class="settings-form refresh-task-form">
            <label class="settings-checkbox">
              <input v-model="task.autoEnabled" type="checkbox" />启用自动刷新
            </label>

            <div v-if="task.taskType === 'facts'" class="settings-form__row">
              <label>
                刷新周期
                <select v-model.number="task.intervalMinutes">
                  <option :value="60">1 小时</option>
                  <option :value="180">3 小时</option>
                  <option :value="360">6 小时</option>
                  <option :value="720">12 小时</option>
                </select>
              </label>
              <label>
                首次活跃范围
                <select v-model.number="task.activeRangeHours">
                  <option :value="24">最近 24 小时</option>
                  <option :value="168">最近 7 天</option>
                  <option :value="720">最近 30 天</option>
                </select>
              </label>
            </div>

            <template v-if="task.taskType === 'summary'">
              <div class="settings-form__row">
                <label>
                  刷新周期
                  <select v-model.number="task.intervalMinutes">
                    <option :value="60">1 小时</option>
                    <option :value="360">6 小时</option>
                    <option :value="720">12 小时</option>
                    <option :value="1440">24 小时</option>
                  </select>
                </label>
                <label>
                  活跃时间范围
                  <select v-model.number="task.activeRangeHours">
                    <option :value="24">最近 24 小时</option>
                    <option :value="168">最近 7 天</option>
                    <option :value="720">最近 30 天</option>
                  </select>
                </label>
              </div>
              <div class="settings-form__row">
                <label>
                  刷新判定
                  <select v-model="task.refreshRule">
                    <option value="code_only">仅代码变化</option>
                    <option value="code_or_body">代码或正文变化</option>
                    <option value="any_update">updated_at 任意变化</option>
                    <option value="manual">仅手动</option>
                  </select>
                </label>
                <label>
                  单次最大处理数量
                  <input v-model.number="task.maxItems" type="number" min="1" max="500" />
                </label>
              </div>
              <div class="refresh-trigger-checks">
                <label class="settings-checkbox"><input v-model="task.includeCiChanges" type="checkbox" />CI 变化使摘要过期</label>
                <label class="settings-checkbox"><input v-model="task.includeCommentChanges" type="checkbox" />评论变化使摘要过期</label>
              </div>
            </template>

            <label v-if="task.taskType === 'classification'">
              刷新策略
              <select v-model="task.refreshRule">
                <option value="first_only">仅首次分类（默认）</option>
                <option value="code_only">代码变化时重新分类</option>
                <option value="any_update">updated_at 任意变化时重新分类</option>
                <option value="manual">仅手动分类</option>
              </select>
            </label>

            <p class="settings-note">
              <template v-if="task.taskType === 'facts'">
                增量水位：{{ task.watermarkUpdatedAt || '首次刷新尚未建立' }}；边界时间会重复读取并按仓库、类型、编号幂等更新。
              </template>
              <template v-else-if="task.taskType === 'summary'">
                摘要不会重新抓取 CI 或 Review；单条手动更新使用高优先级任务。
              </template>
              <template v-else>
                分类对应的 Head SHA 和生成时间会保留；事实变化只标记可能过期。
              </template>
            </p>
            <div class="settings-form__actions refresh-task-actions">
              <button class="button button--secondary" :disabled="saving" @click="saveRefreshTask(task)">
                <Octicon name="check" :size="14" />保存配置
              </button>
              <button
                class="button button--primary"
                :disabled="refreshingTask === task.taskType"
                @click="runRefreshTask(task)"
              >
                <Octicon name="sync" :size="14" :class="{ spinning: refreshingTask === task.taskType }" />
                {{ task.taskType === 'classification' ? '手动重新分类' : '手动刷新' }}
              </button>
            </div>
          </div>

          <div v-else class="refresh-deep-manual">
            <span><Octicon name="shield-lock" :size="20" /></span>
            <div>
              <strong>仅手动，不提供自动定时分析</strong>
              <p>Runner：API（预留本地 Agent Runner）</p>
              <p>Provider / Model：{{ providers.find((provider) => provider.active)?.name || '未配置' }} · {{ providers.find((provider) => provider.active)?.model || '未配置' }}</p>
            </div>
          </div>
        </section>
      </div>
    </div>

    <div v-if="!loading && activeTab === 'management' && aiManagerSection === 'opencode' && localRunnerState" class="local-runner-settings">
      <section class="settings-card local-runner-overview">
        <header>
          <div>
            <strong>Local Analysis Runner</strong>
            <small>Cloudflare / D1 ↔ 本地 Runner ↔ OpenCode Server + 只读 Worktree</small>
          </div>
          <span class="refresh-status" :data-status="localRunnerState.runner.online ? 'ready' : 'failed'">
            {{ localRunnerState.runner.online ? 'Runner 在线' : 'Runner 离线' }}
          </span>
        </header>
        <div class="local-runner-metrics">
          <article><span>OpenCode</span><strong>{{ localRunnerState.runner.opencodeVersion || '未连接' }}</strong><small>地址与认证仅保存在本地</small></article>
          <article><span>只读权限</span><strong>{{ localRunnerState.runner.readonlyVerified ? '已验证' : '未验证' }}</strong><small>Read / Search / LSP / 固定 Git 查询</small></article>
          <article><span>认证</span><strong>{{ localRunnerState.runner.authConfigured ? '已配置' : '未配置' }}</strong><small>浏览器不会获得密码或模型密钥</small></article>
          <article><span>活动任务</span><strong>{{ localRunnerState.runner.activeJobs }}</strong><small>{{ localRunnerState.runner.lastSeenAt ? new Date(localRunnerState.runner.lastSeenAt).toLocaleString('zh-CN') : '无心跳' }}</small></article>
        </div>
        <p v-if="localRunnerState.runner.lastError" class="inline-error">{{ localRunnerState.runner.lastError }}</p>
      </section>

      <section class="settings-card">
        <header><div><strong>运行策略</strong><small>配置持久化在 D1；敏感连接信息由本地 Runner 配置文件管理</small></div></header>
        <div class="settings-form">
          <label class="settings-checkbox"><input v-model="localRunnerState.settings.enabled" type="checkbox" />启用本地分析 Runner</label>
          <div class="settings-form__row">
            <label>默认 Provider
              <select v-model="localRunnerState.settings.defaultProvider">
                <option value="">OpenCode 默认</option>
                <option v-for="provider in localRunnerState.runner.providers" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
              </select>
            </label>
            <label>默认 Model
              <select v-model="localRunnerState.settings.defaultModel">
                <option value="">OpenCode 默认</option>
                <option
                  v-for="model in (localRunnerState.runner.providers.find((provider) => provider.id === localRunnerState?.settings.defaultProvider)?.models || [])"
                  :key="model.id"
                  :value="model.id"
                >{{ model.name }}</option>
              </select>
            </label>
          </div>
          <div class="settings-form__row">
            <label>最大并发任务<input v-model.number="localRunnerState.settings.maxConcurrency" type="number" min="1" max="8" /></label>
            <label>Worktree 保留时间（小时）<input v-model.number="localRunnerState.settings.worktreeRetentionHours" type="number" min="1" max="720" /></label>
          </div>
          <div class="settings-form__row">
            <label>任务超时（秒）<input v-model.number="localRunnerState.settings.timeoutSeconds" type="number" min="60" max="7200" /></label>
            <label class="settings-checkbox"><input v-model="localRunnerState.settings.autoFetch" type="checkbox" />分析前安全执行 git fetch</label>
          </div>
          <p class="settings-note">OpenCode Server 地址、密码与两个仓库的绝对路径在 <code>.loongboard/runner.json</code> 中覆盖；页面只显示状态，不回显本地路径或敏感值。</p>
          <div class="settings-form__actions"><button class="button button--primary" :disabled="saving" @click="saveLocalAnalysisSettings"><Octicon name="check" :size="14" />保存设置</button></div>
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
          <button class="button button--secondary" @click="runLocalAction('test_connection')">测试 OpenCode 连接</button>
          <button class="button button--secondary" @click="runLocalAction('check_repositories')">检查仓库</button>
          <button class="button button--secondary" @click="runLocalAction('refresh_models')">刷新 Provider / Model</button>
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

    <div
      v-if="!loading && activeTab === 'management' && aiManagerSection === 'tasks'"
      class="prompt-center-layout"
    >
      <section class="settings-card prompt-feature-card ai-task-navigation">
        <header>
          <div>
            <strong>业务任务</strong>
            <small>按页面与仓库分组</small>
          </div>
          <span class="settings-status-dot">{{ allAITasks.length }} 项</span>
        </header>
        <div class="ai-task-group-list">
          <section v-for="group in aiManagement?.groups" :key="group.key" class="ai-task-group">
            <header>
              <span>{{ group.name }}</span>
              <small>{{ group.tasks.length }}</small>
            </header>
            <button
              v-for="task in group.tasks"
              :key="task.key"
              class="prompt-feature-item"
              :class="{ 'prompt-feature-item--active': task.key === selectedAITask?.key }"
              @click="selectAITask(task)"
            >
              <span class="prompt-feature-item__icon">
                <Octicon
                  :name="task.name.includes('对话') ? 'comment-discussion' : task.name.includes('分类') ? 'stack' : task.name.includes('分析') || task.name.includes('洞察') ? 'file' : 'git-pull-request'"
                  :size="15"
                />
              </span>
              <span>
                <strong>{{ task.name }}</strong>
                <small>
                  {{ task.executionMode === 'opencode' ? 'OpenCode' : task.executionMode === 'account_api' ? '账户 API' : 'Compatible' }}
                  · {{ task.promptTemplateName }}
                </small>
              </span>
              <span class="ai-task-state-dot" :data-status="task.lastStatus" />
            </button>
          </section>
        </div>
      </section>

      <div v-if="selectedPromptFeature && selectedAITask" class="prompt-template-workspace">
        <section class="settings-card">
          <header>
            <div>
              <strong>{{ selectedAITask.groupName }} / {{ selectedAITask.name }}</strong>
              <small>{{ selectedAITask.description }}</small>
            </div>
            <div class="prompt-header-actions">
              <button
                v-if="taxonomyRefreshRepo"
                class="button button--secondary"
                :disabled="Boolean(refreshingTaxonomy)"
                @click="refreshClassificationStandard"
              >
                <Octicon name="sync" :size="14" />
                {{ refreshingTaxonomy ? "正在刷新…" : "更新分类标准" }}
              </button>
              <button class="button button--primary" @click="createPromptFrom()">
                <Octicon name="plus" :size="14" />新增模板
              </button>
            </div>
          </header>

          <div class="ai-task-binding-panel">
            <div class="ai-task-binding-panel__heading">
              <div><span>执行配置</span><strong>选择执行方式与具体配置</strong></div>
              <span class="refresh-status" :data-status="selectedAITask.lastStatus === 'failed' ? 'failed' : selectedAITask.lastStatus === 'never' ? 'stale' : 'ready'">
                {{ selectedAITask.lastStatus === 'never' ? '尚未运行' : selectedAITask.lastStatus === 'failed' ? '最近失败' : selectedAITask.lastStatus }}
              </span>
            </div>
            <div class="ai-execution-mode-grid">
              <button :class="{ active: selectedAITask.executionMode === 'environment' }" @click="setTaskExecutionMode('environment')">
                <Octicon name="server" :size="16" /><strong>Compatible</strong><small>环境变量调试配置</small>
              </button>
              <button :class="{ active: selectedAITask.executionMode === 'account_api' }" @click="setTaskExecutionMode('account_api')">
                <Octicon name="key" :size="16" /><strong>AI API</strong><small>账户保存的 API 配置</small>
              </button>
              <button :class="{ active: selectedAITask.executionMode === 'opencode' }" @click="setTaskExecutionMode('opencode')">
                <Octicon name="terminal" :size="16" /><strong>OpenCode</strong><small>本地只读代码分析</small>
              </button>
            </div>

            <div v-if="selectedAITask.executionMode === 'environment'" class="ai-task-effective-config">
              <span><Octicon name="server" :size="14" />环境变量 OpenAI-compatible</span>
              <strong>{{ providers.find((provider) => provider.id === 'environment')?.model || '未配置模型' }}</strong>
              <small>{{ providers.find((provider) => provider.id === 'environment')?.tokenConfigured ? 'Token 已配置' : 'Token 尚未配置' }}</small>
            </div>
            <div v-else-if="selectedAITask.executionMode === 'account_api'" class="settings-form__row ai-task-config-fields">
              <label>AI 配置
                <select v-model="selectedAITask.providerConfigId">
                  <option value="" disabled>请选择账户 API</option>
                  <option v-for="provider in providers.filter((item) => !item.builtIn)" :key="provider.id" :value="provider.id">{{ provider.name }} · {{ provider.model }}</option>
                </select>
              </label>
              <label>当前模型<input :value="selectedTaskProvider?.model || '请先选择配置'" disabled /></label>
            </div>
            <div v-else class="settings-form__row ai-task-config-fields">
              <label>OpenCode Provider
                <select v-model="selectedAITask.opencodeProviderId">
                  <option value="">Runner 默认</option>
                  <option v-for="provider in aiManagement?.runner.providers" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                </select>
              </label>
              <label>OpenCode Model
                <select v-model="selectedAITask.opencodeModelId">
                  <option value="">Provider 默认</option>
                  <option v-for="model in selectedOpenCodeModels" :key="model.id" :value="model.id">{{ model.name }}</option>
                </select>
              </label>
            </div>
            <p class="settings-note">{{ selectedAITask.executionNote }}</p>
            <p v-if="selectedAITask.lastError" class="inline-error">最近错误：{{ selectedAITask.lastError }}</p>
            <div class="settings-form__actions">
              <button class="button button--secondary" :disabled="saving" @click="testSelectedAITask"><Octicon name="beaker" :size="14" />测试当前组合</button>
              <button class="button button--primary" :disabled="saving" @click="saveSelectedAITask"><Octicon name="check" :size="14" />保存任务配置</button>
            </div>
          </div>

          <div class="prompt-context-strip">
            <code>{{ selectedPromptFeature.promptVersion }}</code>
            <span>自动附带</span>
            <code
              v-for="source in selectedPromptFeature.contextSources"
              :key="source"
            >{{ source }}</code>
            <small>上下文由服务端安全注入，无需写入模板。</small>
          </div>

          <div
            v-if="selectedClassificationTaxonomy"
            class="taxonomy-refresh-summary"
          >
            <div>
              <span>当前标准</span>
              <strong>{{ selectedClassificationTaxonomy.effectiveVersion }}</strong>
              <small>
                {{ selectedClassificationTaxonomy.categories.length }} 个主要类别 ·
                最近刷新 {{ formatRefreshTime(selectedClassificationTaxonomy.lastRefreshedAt) }}
              </small>
            </div>
            <span
              class="settings-status-dot"
              :class="{ 'settings-status-dot--error': selectedClassificationTaxonomy.status === 'failed' }"
            >{{ selectedClassificationTaxonomy.status === "failed" ? "刷新失败" : "规则已就绪" }}</span>
            <p v-if="selectedClassificationTaxonomy.lastError" class="inline-error">
              {{ selectedClassificationTaxonomy.lastError }}
            </p>
            <details v-if="selectedClassificationTaxonomy.analysisMd">
              <summary>查看最近分类标准分析</summary>
              <pre>{{ selectedClassificationTaxonomy.analysisMd }}</pre>
            </details>
            <small>更新只会合并已注册类别的安全增量；AI 提出的新类别保留为建议，不会自动加入 domain。</small>
          </div>

          <div v-if="localActionJob" class="local-analysis-terminal" :data-status="localActionJob.status">
            <header>
              <div><span class="local-analysis-terminal__lamp" /><strong>OpenCode AI 任务</strong></div>
              <small>{{ localActionJob.status }}</small>
            </header>
            <div class="local-analysis-terminal__events" aria-live="polite">
              <p v-if="!localActionEvents.length"><code>[Queue]</code> 等待 Runner…</p>
              <p v-for="event in localActionEvents" :key="event.sequence" :data-level="event.level">
                <time>{{ new Date(event.createdAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</time>
                <code>[{{ event.source }}]</code><span>{{ event.message }}</span>
              </p>
            </div>
          </div>

          <div class="prompt-template-list">
            <article
              v-for="template in selectedPromptFeature.templates"
              :key="template.id"
              class="prompt-template-item"
              :class="{ 'prompt-template-item--active': isTaskPromptActive(template) }"
            >
              <div class="prompt-template-item__heading">
                <span class="prompt-template-item__icon">
                  <Octicon :name="template.builtIn ? 'shield-check' : 'file'" :size="15" />
                </span>
                <div>
                  <strong>{{ template.name }}</strong>
                  <small>
                    {{ template.builtIn ? "系统默认 · 只读" : `自定义 · r${template.revision}` }}
                  </small>
                </div>
                <span v-if="isTaskPromptActive(template)" class="settings-status-dot">该任务使用中</span>
              </div>
              <p>{{ template.content }}</p>
              <div class="prompt-template-item__actions">
                <button
                  v-if="!isTaskPromptActive(template)"
                  class="button button--secondary"
                  :disabled="saving"
                  @click="activatePrompt(template)"
                >
                  使用
                </button>
                <button
                  class="button button--secondary"
                  @click="createPromptFrom(template)"
                >
                  <Octicon name="copy" :size="13" />复制
                </button>
                <button
                  v-if="!template.builtIn"
                  class="icon-button"
                  aria-label="编辑提示词"
                  @click="editPrompt(template)"
                >
                  <Octicon name="pencil" :size="13" />
                </button>
                <button
                  v-if="!template.builtIn"
                  class="icon-button provider-item__delete"
                  :class="{
                    'provider-item__delete--confirm':
                      pendingPromptDeleteId === template.id,
                  }"
                  :aria-label="
                    pendingPromptDeleteId === template.id
                      ? '确认删除提示词'
                      : '删除提示词'
                  "
                  @click="removePrompt(template)"
                >
                  <Octicon
                    :name="pendingPromptDeleteId === template.id ? 'check' : 'trash'"
                    :size="13"
                  />
                </button>
              </div>
            </article>
          </div>
        </section>

        <section v-if="showPromptForm" class="settings-card prompt-editor-card">
          <header>
            <div>
              <strong>{{ editingPromptId ? "编辑提示词" : "新增提示词" }}</strong>
              <small>只控制分析侧重点；输出协议和安全约束由系统维护</small>
            </div>
            <button class="button button--secondary" @click="resetPromptForm">
              取消
            </button>
          </header>
          <form class="settings-form" @submit.prevent="savePrompt">
            <label>
              模板名称
              <input
                v-model="promptForm.name"
                maxlength="80"
                placeholder="例如：Ascend 兼容性优先"
                required
              />
            </label>
            <label>
              提示词内容
              <textarea
                v-model="promptForm.content"
                rows="8"
                maxlength="8000"
                placeholder="描述希望模型关注的分析角度、优先级和输出偏好"
                required
              />
              <small>{{ promptForm.content.length }} / 8000 字</small>
            </label>
            <label v-if="!editingPromptId" class="settings-checkbox">
              <input v-model="promptForm.makeActive" type="checkbox" />
              保存后立即用于当前任务
            </label>
            <p class="settings-note">
              修改只影响后续生成的内容；历史分析仍保留原模板名称、修订号和内容快照。
            </p>
            <div class="settings-form__actions">
              <button class="button button--primary" :disabled="saving">
                <Octicon name="check" :size="14" />
                {{ editingPromptId ? "保存修改" : "添加模板" }}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  </section>
</template>
