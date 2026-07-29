<script setup lang="ts">
import { computed } from "vue";
import octicons from "@primer/octicons";

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
  const options: Record<string, string | number> = {
    width: props.size,
    height: props.size,
  };

  if (props.label) {
    options["aria-label"] = props.label;
  }

  return icon.toSVG(options);
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
