<script setup lang="ts">
import DOMPurify from "dompurify";
import { marked } from "marked";
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    content?: string;
    compact?: boolean;
  }>(),
  {
    content: "",
    compact: false,
  },
);

const html = computed(() => {
  const rendered = marked.parse(props.content || "", {
    gfm: true,
    breaks: false,
  });
  return DOMPurify.sanitize(String(rendered), {
    USE_PROFILES: { html: true },
  });
});
</script>

<template>
  <div
    class="markdown-renderer"
    :class="{ 'markdown-renderer--compact': compact }"
    v-html="html"
  />
</template>
