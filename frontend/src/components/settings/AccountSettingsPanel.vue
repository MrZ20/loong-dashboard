<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ApiError } from "../../api/core";
import { settingsApi } from "../../api/settings";
import type { UserAccount } from "../../types/account";
import Octicon from "../Octicon.vue";

const emit = defineEmits<{
  "update:user": [value: UserAccount];
}>();

const loading = ref(true);
const saving = ref(false);
const error = ref("");
const message = ref("");
const accounts = ref<UserAccount[]>([]);
const canAddAccounts = ref(false);
const currentProfile = ref<UserAccount | null>(null);
const showAccountForm = ref(false);

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

function report(cause: unknown, fallback: string) {
  error.value = cause instanceof ApiError ? cause.message : fallback;
}

async function loadAccountSettings() {
  loading.value = true;
  error.value = "";
  try {
    const [profileResult, accountResult] = await Promise.all([
      settingsApi.profile(),
      settingsApi.accounts(),
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
  } catch (cause) {
    report(cause, "账户设置加载失败");
  } finally {
    loading.value = false;
  }
}

async function saveProfile() {
  saving.value = true;
  error.value = "";
  try {
    const { profile } = await settingsApi.updateProfile(profileForm);
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
    const { account } = await settingsApi.createAccount(accountForm);
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
    await settingsApi.switchAccount(account.id);
    window.location.reload();
  } catch (cause) {
    report(cause, "账户切换失败");
    saving.value = false;
  }
}

onMounted(loadAccountSettings);
</script>

<template>
  <div>
    <div v-if="loading" class="settings-loading">正在加载账户设置…</div>
    <p v-else-if="error" class="inline-error settings-inline-message">{{ error }}</p>
    <p v-if="message" class="settings-success">
      <Octicon name="check-circle-fill" :size="14" />{{ message }}
    </p>

    <div v-if="!loading" class="settings-layout">
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
  </div>
</template>
