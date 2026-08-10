<script setup lang="ts">
import {
  computed,
  nextTick,
} from "vue";
import { usePopover } from "../composables/usePopover";
import Octicon from "./Octicon.vue";

type FilterTone =
  | "accent"
  | "blue"
  | "green"
  | "neutral"
  | "orange"
  | "purple"
  | "red";

interface FilterOption {
  value: string;
  label: string;
  description?: string;
  tone?: FilterTone;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    icon?: string;
    options: FilterOption[];
    align?: "left" | "right";
  }>(),
  {
    icon: "filter",
    align: "left",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const { root, trigger, open, close: closePopover, toggle: toggleMenu } = usePopover();

const selectedOption = computed(
  () =>
    props.options.find((option) => option.value === props.modelValue) ??
    props.options[0],
);

function optionButtons() {
  return Array.from(
    root.value?.querySelectorAll<HTMLButtonElement>(
      ".filter-dropdown__option",
    ) ?? [],
  );
}

function focusOption(index: number) {
  nextTick(() => {
    const buttons = optionButtons();
    if (!buttons.length) return;
    buttons[Math.max(0, Math.min(index, buttons.length - 1))]?.focus();
  });
}

function showMenu(focusSelected = false) {
  open.value = true;
  if (focusSelected) {
    const selectedIndex = Math.max(
      0,
      props.options.findIndex((option) => option.value === props.modelValue),
    );
    focusOption(selectedIndex);
  }
}

function closeMenu(returnFocus = false) {
  closePopover(returnFocus);
}

function selectOption(value: string) {
  emit("update:modelValue", value);
  closeMenu(true);
}

function handleTriggerKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    showMenu(true);
  } else if (event.key === "Escape" && open.value) {
    event.preventDefault();
    closeMenu(true);
  }
}

function handleOptionKeydown(event: KeyboardEvent, index: number) {
  const buttons = optionButtons();
  if (!buttons.length) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    buttons[(index + 1) % buttons.length]?.focus();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
  } else if (event.key === "Home") {
    event.preventDefault();
    buttons[0]?.focus();
  } else if (event.key === "End") {
    event.preventDefault();
    buttons[buttons.length - 1]?.focus();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeMenu(true);
  } else if (event.key === "Tab") {
    closeMenu();
  }
}

</script>

<template>
  <div
    ref="root"
    class="filter-dropdown"
    :class="{ 'filter-dropdown--open': open }"
  >
    <button
      ref="trigger"
      class="filter-dropdown__trigger"
      type="button"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggleMenu"
      @keydown="handleTriggerKeydown"
    >
      <span
        class="filter-dropdown__trigger-icon"
        :data-tone="selectedOption?.tone ?? 'neutral'"
      >
        <Octicon :name="icon" :size="14" />
      </span>
      <span class="filter-dropdown__trigger-copy">
        <span>{{ label }}</span>
        <strong>{{ selectedOption?.label }}</strong>
      </span>
      <Octicon
        class="filter-dropdown__chevron"
        name="chevron-down"
        :size="13"
      />
    </button>

    <Transition name="filter-menu">
      <div
        v-if="open"
        class="filter-dropdown__menu"
        :class="`filter-dropdown__menu--${align}`"
        role="listbox"
        :aria-label="`${label}筛选`"
      >
        <div class="filter-dropdown__menu-heading">
          <span>{{ label }}</span>
          <small>{{ options.length }} 个选项</small>
        </div>
        <div class="filter-dropdown__options">
          <button
            v-for="(option, index) in options"
            :key="option.value"
            class="filter-dropdown__option"
            :class="{
              'filter-dropdown__option--selected':
                option.value === modelValue,
            }"
            type="button"
            role="option"
            :aria-selected="option.value === modelValue"
            @click="selectOption(option.value)"
            @keydown="handleOptionKeydown($event, index)"
          >
            <span
              class="filter-dropdown__option-dot"
              :data-tone="option.tone ?? 'neutral'"
            />
            <span class="filter-dropdown__option-copy">
              <strong>{{ option.label }}</strong>
              <small v-if="option.description">{{ option.description }}</small>
            </span>
            <span class="filter-dropdown__option-check">
              <Octicon
                v-if="option.value === modelValue"
                name="check"
                :size="14"
              />
            </span>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.filter-dropdown {
  position: relative;
  flex: 0 0 auto;
}

.filter-dropdown--open {
  z-index: 50;
}

.filter-dropdown__trigger {
  display: grid;
  width: 100%;
  height: 42px;
  grid-template-columns: 28px minmax(0, 1fr) 14px;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 7px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--control-bg);
  color: var(--text);
  text-align: left;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--text) 5%, transparent);
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease,
    transform 150ms ease;
}

.filter-dropdown__trigger:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  box-shadow: 0 5px 14px color-mix(in srgb, var(--text) 8%, transparent);
}

.filter-dropdown--open .filter-dropdown__trigger {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);
}

.filter-dropdown__trigger-icon {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--surface-muted);
  color: var(--text-secondary);
}

.filter-dropdown__trigger-icon[data-tone="accent"] {
  background: var(--accent-soft);
  color: var(--accent-dark);
}

.filter-dropdown__trigger-icon[data-tone="blue"] {
  background: color-mix(in srgb, var(--blue) 11%, var(--surface));
  color: var(--blue);
}

.filter-dropdown__trigger-icon[data-tone="green"] {
  background: var(--green-soft);
  color: var(--green);
}

.filter-dropdown__trigger-icon[data-tone="orange"] {
  background: var(--orange-soft);
  color: var(--orange);
}

.filter-dropdown__trigger-icon[data-tone="purple"] {
  background: var(--purple-soft);
  color: var(--purple);
}

.filter-dropdown__trigger-icon[data-tone="red"] {
  background: var(--red-soft);
  color: var(--red);
}

.filter-dropdown__trigger-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.filter-dropdown__trigger-copy > span {
  color: var(--text-tertiary);
  font-size: 9px;
  font-weight: 600;
  line-height: 1.1;
}

.filter-dropdown__trigger-copy strong {
  overflow: hidden;
  color: var(--text);
  font-size: 11.5px;
  font-weight: 650;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter-dropdown__chevron {
  color: var(--text-tertiary);
  transition: transform 160ms ease;
}

.filter-dropdown--open .filter-dropdown__chevron {
  transform: rotate(180deg);
}

.filter-dropdown__menu {
  position: absolute;
  top: calc(100% + 7px);
  width: max(100%, 286px);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 86%, var(--text));
  border-radius: 12px;
  background: var(--surface);
  box-shadow:
    0 18px 44px color-mix(in srgb, var(--text) 16%, transparent),
    0 3px 10px color-mix(in srgb, var(--text) 8%, transparent);
}

.filter-dropdown__menu--left {
  left: 0;
}

.filter-dropdown__menu--right {
  right: 0;
}

.filter-dropdown__menu-heading {
  display: flex;
  height: 38px;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--surface-muted);
}

.filter-dropdown__menu-heading span {
  color: var(--text);
  font-size: 11px;
  font-weight: 680;
}

.filter-dropdown__menu-heading small {
  color: var(--text-tertiary);
  font-size: 9.5px;
}

.filter-dropdown__options {
  max-height: min(390px, calc(100vh - 220px));
  overflow-y: auto;
  padding: 6px;
  overscroll-behavior: contain;
  scrollbar-color: var(--border) transparent;
  scrollbar-width: thin;
}

.filter-dropdown__option {
  display: grid;
  width: 100%;
  min-height: 42px;
  grid-template-columns: 10px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 9px;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  text-align: left;
}

.filter-dropdown__option:hover,
.filter-dropdown__option:focus-visible {
  background: var(--surface-hover);
}

.filter-dropdown__option--selected {
  background: var(--accent-soft);
}

.filter-dropdown__option-dot {
  width: 8px;
  height: 8px;
  border: 2px solid var(--text-tertiary);
  border-radius: 50%;
}

.filter-dropdown__option-dot[data-tone="accent"] {
  border-color: var(--accent-dark);
  background: var(--accent);
}

.filter-dropdown__option-dot[data-tone="blue"] {
  border-color: var(--blue);
  background: var(--blue);
}

.filter-dropdown__option-dot[data-tone="green"] {
  border-color: var(--green);
  background: var(--green);
}

.filter-dropdown__option-dot[data-tone="orange"] {
  border-color: var(--orange);
  background: var(--orange);
}

.filter-dropdown__option-dot[data-tone="purple"] {
  border-color: var(--purple);
  background: var(--purple);
}

.filter-dropdown__option-dot[data-tone="red"] {
  border-color: var(--red);
  background: var(--red);
}

.filter-dropdown__option-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.filter-dropdown__option-copy strong {
  overflow: hidden;
  font-size: 11px;
  font-weight: 620;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter-dropdown__option-copy small {
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 9.5px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter-dropdown__option-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-dark);
}

.filter-menu-enter-active,
.filter-menu-leave-active {
  transition:
    opacity 130ms ease,
    transform 130ms ease;
  transform-origin: top;
}

.filter-menu-enter-from,
.filter-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.985);
}
</style>
