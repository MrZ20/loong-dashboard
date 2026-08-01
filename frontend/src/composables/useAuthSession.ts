import { ref } from "vue";
import { api, ApiError } from "../api/client";
import type { AuthUser, UserAccount } from "../types";

type AuthSessionOptions = {
  onAuthenticated: () => Promise<void>;
  onLoggedOut: () => void;
};

export function useAuthSession(options: AuthSessionOptions) {
  const authUser = ref<AuthUser | null>(null);
  const authMode = ref<"development" | "chatgpt">("chatgpt");
  const signInPath = ref("/signin-with-chatgpt?return_to=/");
  const signOutPath = ref("/signout-with-chatgpt?return_to=/login");
  const authLoading = ref(true);
  const loginLoading = ref(false);
  const authError = ref("");

  async function initializeAuth() {
    authLoading.value = true;
    authError.value = "";
    try {
      const providers = await api.authProviders();
      authMode.value = providers.mode;
      signInPath.value = providers.signInPath;
      signOutPath.value = providers.signOutPath;
      const { user } = await api.me();
      authUser.value = user;
      await options.onAuthenticated();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        authUser.value = null;
      } else {
        authError.value =
          cause instanceof ApiError ? cause.message : "后端服务连接失败";
      }
    } finally {
      authLoading.value = false;
    }
  }

  async function login(
    email: string,
    displayName: string,
    password: string,
  ) {
    loginLoading.value = true;
    authError.value = "";
    try {
      await api.devLogin(email, displayName, password);
      await initializeAuth();
    } catch (cause) {
      authError.value =
        cause instanceof ApiError ? cause.message : "登录失败";
    } finally {
      loginLoading.value = false;
    }
  }

  async function logout() {
    if (authMode.value === "chatgpt") {
      window.location.href = signOutPath.value;
      return;
    }
    await api.logout();
    authUser.value = null;
    options.onLoggedOut();
  }

  function updateCurrentUser(profile: UserAccount) {
    if (!authUser.value) return false;
    authUser.value = {
      ...authUser.value,
      displayName: profile.displayName,
    };
    return true;
  }

  return {
    authError,
    authLoading,
    authMode,
    authUser,
    initializeAuth,
    login,
    loginLoading,
    logout,
    signInPath,
    signOutPath,
    updateCurrentUser,
  };
}
