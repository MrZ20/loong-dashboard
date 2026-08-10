<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import type { PromptFeatureKey } from "../types/ai";
import type { RefreshTaskType } from "../types/refresh";
import type { UserAccount } from "../types/account";
import AccountSettingsPanel from "./settings/AccountSettingsPanel.vue";
import AIProviderSettingsPanel from "./settings/AIProviderSettingsPanel.vue";
import AITaskSettingsPanel from "./settings/AITaskSettingsPanel.vue";
import CommunityRefreshSettingsPanel from "./settings/CommunityRefreshSettingsPanel.vue";
import LocalRunnerSettingsPanel from "./settings/LocalRunnerSettingsPanel.vue";
import Octicon from "./Octicon.vue";

type SettingsTab = "account" | "management" | "refresh";
type AIManagerSection = "tasks" | "configs" | "runtime";

const emit = defineEmits<{
  "update:user": [value: UserAccount];
  "refresh-complete": [repoId: string, taskType: RefreshTaskType];
}>();

const props = defineProps<{
  initialTab?: SettingsTab;
  initialPromptFeature?: PromptFeatureKey;
  initialRepo?: string;
}>();

const activeTab = ref<SettingsTab>(props.initialTab || "account");
const aiManagerSection = ref<AIManagerSection>("tasks");
const visitedTabs = reactive<Record<SettingsTab, boolean>>({
  account: activeTab.value === "account",
  management: activeTab.value === "management",
  refresh: activeTab.value === "refresh",
});
const visitedManagerSections = reactive<Record<AIManagerSection, boolean>>({
  tasks: activeTab.value === "management",
  configs: false,
  runtime: false,
});

function openTab(tab: SettingsTab) {
  activeTab.value = tab;
  visitedTabs[tab] = true;
  if (tab === "management") visitedManagerSections[aiManagerSection.value] = true;
}

function openManagerSection(section: AIManagerSection) {
  aiManagerSection.value = section;
  visitedManagerSections[section] = true;
}

watch(
  () => props.initialPromptFeature,
  (feature) => {
    if (!feature) return;
    openTab("management");
    openManagerSection("tasks");
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
        <button :class="{ 'settings-tabs__active': activeTab === 'account' }" @click="openTab('account')">
          <Octicon name="person" :size="14" />账户与登录
        </button>
        <button :class="{ 'settings-tabs__active': activeTab === 'management' }" @click="openTab('management')">
          <Octicon name="copilot" :size="14" />AI 管理
        </button>
        <button :class="{ 'settings-tabs__active': activeTab === 'refresh' }" @click="openTab('refresh')">
          <Octicon name="sync" :size="14" />社区数据刷新
        </button>
      </div>
    </header>

    <AccountSettingsPanel
      v-if="visitedTabs.account"
      v-show="activeTab === 'account'"
      @update:user="emit('update:user', $event)"
    />

    <template v-if="visitedTabs.management">
      <div v-show="activeTab === 'management'" class="ai-management-switcher">
        <button :class="{ active: aiManagerSection === 'tasks' }" @click="openManagerSection('tasks')">
          <Octicon name="workflow" :size="14" />AI 任务
        </button>
        <button :class="{ active: aiManagerSection === 'configs' }" @click="openManagerSection('configs')">
          <Octicon name="cpu" :size="14" />AI 配置
        </button>
        <button :class="{ active: aiManagerSection === 'runtime' }" @click="openManagerSection('runtime')">
          <Octicon name="terminal" :size="14" />本地运行环境
        </button>
      </div>

      <AITaskSettingsPanel
        v-if="visitedManagerSections.tasks"
        v-show="activeTab === 'management' && aiManagerSection === 'tasks'"
        :initial-prompt-feature="initialPromptFeature"
        :initial-repo="initialRepo"
      />
      <AIProviderSettingsPanel
        v-if="visitedManagerSections.configs"
        v-show="activeTab === 'management' && aiManagerSection === 'configs'"
      />
      <LocalRunnerSettingsPanel
        v-if="visitedManagerSections.runtime"
        v-show="activeTab === 'management' && aiManagerSection === 'runtime'"
        @open-ai-tasks="openManagerSection('tasks')"
      />
    </template>

    <CommunityRefreshSettingsPanel
      v-if="visitedTabs.refresh"
      v-show="activeTab === 'refresh'"
      @refresh-complete="(repoId, taskType) => emit('refresh-complete', repoId, taskType)"
    />
  </section>
</template>
