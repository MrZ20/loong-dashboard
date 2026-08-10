import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

export function usePopover() {
  const root = ref<HTMLElement | null>(null);
  const trigger = ref<HTMLButtonElement | null>(null);
  const open = ref(false);

  function close(returnFocus = false) {
    open.value = false;
    if (returnFocus) nextTick(() => trigger.value?.focus());
  }

  function toggle() {
    if (open.value) close();
    else open.value = true;
  }

  function handleOutsidePointer(event: PointerEvent) {
    if (root.value && !root.value.contains(event.target as Node)) close();
  }

  function handleDocumentKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && open.value) close(true);
  }

  onMounted(() => {
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    document.addEventListener("keydown", handleDocumentKeydown);
  });
  onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", handleOutsidePointer, true);
    document.removeEventListener("keydown", handleDocumentKeydown);
  });

  return { root, trigger, open, close, toggle };
}
