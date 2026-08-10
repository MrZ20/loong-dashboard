import { ref, watch } from "vue";
import type { ThemeMode } from "../types/core";

export function useAppPreferences() {
  const sidebarCollapsed = ref(
    window.localStorage.getItem("loongboard-sidebar-collapsed") === "true",
  );
  const storedTheme = window.localStorage.getItem("loongboard-theme");
  const theme = ref<ThemeMode>(
    storedTheme === "dark" || storedTheme === "light"
      ? storedTheme
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
  );

  watch(
    theme,
    (value) => {
      window.localStorage.setItem("loongboard-theme", value);
      document.documentElement.style.colorScheme = value;
    },
    { immediate: true },
  );

  watch(sidebarCollapsed, (value) => {
    window.localStorage.setItem(
      "loongboard-sidebar-collapsed",
      String(value),
    );
  });

  return {
    sidebarCollapsed,
    theme,
  };
}
