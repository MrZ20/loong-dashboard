<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ApiError } from "../../api/core";
import { settingsApi } from "../../api/settings";
import type { AIProviderConfig } from "../../types/ai";
import Octicon from "../Octicon.vue";

const loading = ref(true);
const saving = ref(false);
const providers = ref<AIProviderConfig[]>([]);
const notice = ref<{ kind: "success" | "error"; text: string } | null>(null);
const editingProviderId = ref("");
const pendingProviderDeleteId = ref("");
const providerForm = reactive({
  name: "",
  baseUrl: "https://api.openai.com/v1",
  apiMode: "responses" as AIProviderConfig["apiMode"],
  model: "gpt-5-mini",
  token: "",
});

function resetProviderForm() {
  editingProviderId.value = "";
  providerForm.name = "";
  providerForm.baseUrl = "https://api.openai.com/v1";
  providerForm.apiMode = "responses";
  providerForm.model = "gpt-5-mini";
  providerForm.token = "";
}

function editProvider(provider: AIProviderConfig) {
  editingProviderId.value = provider.id;
  providerForm.name = provider.name;
  providerForm.baseUrl = provider.baseUrl;
  providerForm.apiMode = provider.apiMode;
  providerForm.model = provider.model;
  providerForm.token = "";
}

async function reloadProviders() {
  providers.value = (await settingsApi.aiProviders()).providers;
}

async function loadProviders() {
  loading.value = true;
  notice.value = null;
  try {
    await reloadProviders();
  } catch (cause) {
    notice.value = {
      kind: "error",
      text: cause instanceof ApiError ? cause.message : "AI 配置加载失败",
    };
  } finally {
    loading.value = false;
  }
}

async function saveProvider() {
  saving.value = true;
  notice.value = null;
  try {
    await settingsApi.saveAIProvider(providerForm, editingProviderId.value || undefined);
    await reloadProviders();
    notice.value = {
      kind: "success",
      text: editingProviderId.value ? "AI 配置已更新" : "AI 配置已添加",
    };
    resetProviderForm();
  } catch (cause) {
    notice.value = { kind: "error", text: cause instanceof ApiError ? cause.message : "AI 配置保存失败" };
  } finally {
    saving.value = false;
  }
}

async function removeProvider(provider: AIProviderConfig) {
  if (pendingProviderDeleteId.value !== provider.id) {
    pendingProviderDeleteId.value = provider.id;
    notice.value = { kind: "error", text: `再次点击确认删除 ${provider.name}` };
    return;
  }
  saving.value = true;
  notice.value = null;
  try {
    await settingsApi.deleteAIProvider(provider.id);
    await reloadProviders();
    if (editingProviderId.value === provider.id) resetProviderForm();
    pendingProviderDeleteId.value = "";
    notice.value = { kind: "success", text: "AI 配置已删除" };
  } catch (cause) {
    notice.value = { kind: "error", text: cause instanceof ApiError ? cause.message : "AI 配置删除失败" };
  } finally {
    saving.value = false;
  }
}

onMounted(loadProviders);
</script>

<template>
  <div>
    <div v-if="loading" class="settings-loading">正在加载 AI 配置…</div>
    <div v-else class="settings-layout settings-layout--ai">
      <p
        v-if="notice"
        class="settings-context-notice"
        :data-kind="notice.kind"
        aria-live="polite"
      ><Octicon :name="notice.kind === 'success' ? 'check-circle-fill' : 'alert'" :size="14" />{{ notice.text }}</p>
      <section class="settings-card">
        <header>
          <div><strong>可用 API 配置</strong><small>每个 AI 任务显式选择配置；这里不维护账户级默认模型</small></div>
        </header>
        <div class="provider-list">
          <article
            v-for="provider in providers"
            :key="provider.id"
            class="provider-item"
          >
            <span class="provider-item__icon"><Octicon name="cpu" :size="17" /></span>
            <div>
              <strong>{{ provider.name }}</strong>
              <small>{{ provider.model }} · {{ provider.apiMode === "responses" ? "Responses API" : "Chat Completions" }}</small>
              <span>
                {{ provider.tokenConfigured ? `Token ••••${provider.tokenHint}` : provider.builtIn ? "尚未配置环境 Token" : "无 Token" }}
              </span>
            </div>
            <span class="settings-status-dot">{{ provider.usageCount || 0 }} 个任务</span>
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
              :class="{ 'provider-item__delete--confirm': pendingProviderDeleteId === provider.id }"
              :aria-label="pendingProviderDeleteId === provider.id ? '确认删除 AI 配置' : '删除 AI 配置'"
              @click="removeProvider(provider)"
            >
              <Octicon :name="pendingProviderDeleteId === provider.id ? 'check' : 'trash'" :size="13" />
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
          <button v-if="editingProviderId" class="button button--secondary" @click="resetProviderForm">取消编辑</button>
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
          <p class="settings-note">Token 使用服务端 AES-GCM 加密后保存，接口和页面不会返回明文。</p>
          <div class="settings-form__actions">
            <button class="button button--primary" :disabled="saving">
              <Octicon name="key" :size="14" />{{ editingProviderId ? "保存修改" : "添加配置" }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>
