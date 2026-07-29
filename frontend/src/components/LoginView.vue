<script setup lang="ts">
import { ref } from "vue";
import Octicon from "./Octicon.vue";

const props = defineProps<{
  mode: "development" | "chatgpt";
  signInPath: string;
  loading: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  login: [email: string, displayName: string];
}>();

const email = ref("maintainer@example.com");
const displayName = ref("Community Maintainer");
</script>

<template>
  <main class="login-page">
    <section class="login-card">
      <div class="login-card__brand">
        <span><Octicon name="telescope" :size="23" /></span>
        <div><strong>LoongBoard</strong><small>Community intelligence</small></div>
      </div>

      <div class="login-card__intro">
        <span class="eyebrow">VLLM COMMUNITY WORKSPACE</span>
        <h1>登录社区工作台</h1>
        <p>同步仓库变化，保存技术文档，并使用 AI 分析 PR、Issue 与跨仓库影响。</p>
      </div>

      <div class="login-card__features">
        <span><Octicon name="shield-check" :size="15" />服务端身份与数据隔离</span>
        <span><Octicon name="repo-push" :size="15" />GitHub 数据同步</span>
        <span><Octicon name="sparkle-fill" :size="15" />可配置 AI API</span>
      </div>

      <p v-if="error" class="login-error">{{ error }}</p>

      <form
        v-if="mode === 'development'"
        class="login-form"
        @submit.prevent="emit('login', email, displayName)"
      >
        <label>
          <span>显示名称</span>
          <input v-model="displayName" autocomplete="name" required />
        </label>
        <label>
          <span>邮箱</span>
          <input v-model="email" type="email" autocomplete="email" required />
        </label>
        <button class="button button--primary button--full" :disabled="loading">
          <Octicon :name="loading ? 'sync' : 'sign-in'" :size="15" :class="{ spinning: loading }" />
          {{ loading ? "正在登录…" : "进入本地工作台" }}
        </button>
        <small>本地开发登录仅在 ALLOW_DEV_AUTH=true 时启用。</small>
      </form>

      <a
        v-else
        class="button button--primary button--full login-chatgpt"
        :href="props.signInPath"
      >
        <Octicon name="mark-github" :size="16" />
        使用 ChatGPT 身份登录
      </a>

      <footer>登录后才能读取社区数据、保存文档和使用 AI 对话。</footer>
    </section>
  </main>
</template>
