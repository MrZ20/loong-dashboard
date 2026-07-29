<script setup lang="ts">
import { computed, ref } from "vue";
import type { DiffStat } from "../types";
import Octicon from "./Octicon.vue";

const props = defineProps<{
  diff: DiffStat;
}>();

const expanded = ref<Set<string>>(new Set());
const allExpanded = computed(
  () =>
    props.diff.entries.length > 0 &&
    props.diff.entries.every((entry) => expanded.value.has(entry.path)),
);

function toggleFile(path: string, open: boolean) {
  const next = new Set(expanded.value);
  if (open) next.add(path);
  else next.delete(path);
  expanded.value = next;
}

function toggleAll() {
  expanded.value = allExpanded.value
    ? new Set()
    : new Set(props.diff.entries.map((entry) => entry.path));
}

function lineClass(line: string) {
  if (line.startsWith("diff --git") || line.startsWith("@@")) return "diff-line--header";
  if (line.startsWith("+") && !line.startsWith("+++")) return "diff-line--add";
  if (line.startsWith("-") && !line.startsWith("---")) return "diff-line--delete";
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("index ")
  ) {
    return "diff-line--meta";
  }
  return "";
}
</script>

<template>
  <div class="full-diff">
    <div class="diff-card__summary">
      <span><strong>{{ diff.files }}</strong> files</span>
      <span><strong>{{ diff.additions }}</strong> additions</span>
      <span><strong>{{ diff.deletions }}</strong> deletions</span>
      <span class="diff-bar">
        <span
          class="diff-bar__add"
          :style="{
            width: `${Math.round(
              (diff.additions / Math.max(diff.additions + diff.deletions, 1)) * 100,
            )}%`,
          }"
        />
      </span>
      <button class="button button--secondary" @click="toggleAll">
        <Octicon :name="allExpanded ? 'fold' : 'unfold'" :size="14" />
        {{ allExpanded ? "折叠全部" : "展开全部" }}
      </button>
    </div>

    <p v-if="diff.notice" class="diff-source-notice">
      <Octicon name="info" :size="15" />
      {{ diff.notice }}
    </p>

    <details
      v-for="file in diff.entries"
      :key="file.path"
      class="diff-file-block"
      :open="expanded.has(file.path)"
      @toggle="toggleFile(file.path, ($event.currentTarget as HTMLDetailsElement).open)"
    >
      <summary>
        <span>
          <Octicon name="file-diff" :size="15" />
          {{ file.path }}
        </span>
        <span>
          <strong class="add">+{{ file.additions }}</strong>
          <strong class="del">-{{ file.deletions }}</strong>
          <Octicon name="chevron-down" :size="14" />
        </span>
      </summary>
      <pre v-if="file.patch" class="diff-code"><code><span
        v-for="(line, index) in file.patch.split('\n')"
        :key="`${file.path}-${index}`"
        class="diff-line"
        :class="lineClass(line)"
        :data-line="index + 1"
      >{{ line || " " }}</span></code></pre>
      <div v-else class="diff-unavailable">
        当前 GitHub 响应没有返回该文件的 patch，可点击刷新 diff 后重试。
      </div>
    </details>
  </div>
</template>
