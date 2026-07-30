<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { api, ApiError } from "../api/client";
import type { AIProviderConfig, UserAccount } from "../types";
import Octicon from "./Octicon.vue";

const emit = defineEmits<{
  "update:user": [value: UserAccount];
}>();

const activeTab = ref<"account" | "ai">("account");
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const message = ref("");
const accounts = ref<UserAccount[]>([]);
const canAddAccounts = ref(false);
const providers = ref<AIProviderConfig[]>([]);
const currentProfile = ref<UserAccount | null>(null);
const showAccountForm = ref(false);
const editingProviderId = ref("");
const pendingProviderDeleteId = ref("");

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
    const [profileResult, accountResult, providerResult] = await Promise.all([
      api.profile(),
      api.accounts(),
      api.aiProviders(),
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
  } catch (cause) {
    report(cause, "设置加载失败");
  } finally {
    loading.value = false;
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
    providers.value = (await api.aiProviders()).providers;
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
    providers.value = (await api.aiProviders()).providers;
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
</script>

<template>
  <section class="workspace-view settings-view">
    <header class="workspace-view__heading">
      <div>
        <span class="eyebrow">ACCOUNT & AI CONFIGURATION</span>
        <h2>设置</h2>
        <p>管理账户资料、调试账户和多个 AI API；Token 仅在后端加密保存。</p>
      </div>
      <div class="settings-tabs">
        <button
          :class="{ 'settings-tabs__active': activeTab === 'account' }"
          @click="activeTab = 'account'"
        >
          <Octicon name="person" :size="14" />账户与登录
        </button>
        <button
          :class="{ 'settings-tabs__active': activeTab === 'ai' }"
          @click="activeTab = 'ai'"
        >
          <Octicon name="copilot" :size="14" />AI 模型
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

    <div v-if="!loading && activeTab === 'ai'" class="settings-layout settings-layout--ai">
      <section class="settings-card">
        <header>
          <div><strong>可用 AI 配置</strong><small>每个账户可保存并切换自己的提供商</small></div>
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
            <span v-if="provider.active" class="settings-status-dot">使用中</span>
            <button
              v-else
              class="button button--secondary"
              :disabled="saving"
              @click="activateProvider(provider)"
            >
              使用
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
            保存后立即切换到此配置
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
  </section>
</template>
