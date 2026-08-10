<script setup lang="ts">
import { computed } from "vue";
import { octicons } from "../generated/octicons";

const props = withDefaults(
  defineProps<{
    name: string;
    size?: number;
    label?: string;
  }>(),
  {
    size: 16,
    label: "",
  },
);

const svg = computed(() => {
  const icon = octicons[props.name as keyof typeof octicons] ?? octicons.question;
  const heights = Object.keys(icon.heights).map(Number).sort((left, right) => left - right);
  const naturalHeight = heights.reduce(
    (selected, height) => height <= props.size ? height : selected,
    heights[0],
  );
  const source = icon.heights[String(naturalHeight) as keyof typeof icon.heights];
  const safeLabel = props.label
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const accessibility = safeLabel
    ? `aria-label="${safeLabel}" role="img"`
    : 'aria-hidden="true"';
  return `<svg version="1.1" width="${props.size}" height="${props.size}" viewBox="0 0 ${source.width} ${naturalHeight}" class="octicon octicon-${props.name}" ${accessibility} data-component="Octicon">${source.path}</svg>`;
});
</script>

<template>
  <span class="octicon-wrap" :class="`octicon-${name}`" v-html="svg" />
</template>

<style scoped>
.octicon-wrap {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  line-height: 0;
}

.octicon-wrap :deep(svg) {
  display: block;
  fill: currentColor;
}
</style>
