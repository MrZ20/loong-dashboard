<script setup lang="ts">
import { computed, ref } from "vue";
import type { DiffStat } from "../types";
import Octicon from "./Octicon.vue";

const props = withDefaults(
  defineProps<{
    diff: DiffStat;
    loading?: boolean;
    githubUrl?: string;
  }>(),
  {
    loading: false,
    githubUrl: "",
  },
);

const emit = defineEmits<{
  "load-diff": [];
}>();

const MAX_INLINE_CHANGED_LINES = 1_000;
const expanded = ref<Set<string>>(new Set());
const expandableEntries = computed(() =>
  props.diff.entries.filter((entry) => !isLargeFile(entry)),
);
const allExpanded = computed(
  () =>
    expandableEntries.value.length > 0 &&
    expandableEntries.value.every((entry) => expanded.value.has(entry.path)),
);

function isLargeFile(file: DiffStat["entries"][number]) {
  return file.additions + file.deletions > MAX_INLINE_CHANGED_LINES;
}

function blockLargeFile(
  file: DiffStat["entries"][number],
  event: MouseEvent,
) {
  if (isLargeFile(file)) event.preventDefault();
}

function toggleFile(
  file: DiffStat["entries"][number],
  open: boolean,
  details: HTMLDetailsElement,
) {
  if (isLargeFile(file)) {
    details.open = false;
    return;
  }
  const next = new Set(expanded.value);
  if (open) next.add(file.path);
  else next.delete(file.path);
  expanded.value = next;
}

function toggleAll() {
  expanded.value = allExpanded.value
    ? new Set()
    : new Set(expandableEntries.value.map((entry) => entry.path));
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
      <button
        v-if="!diff.statsOnly"
        class="button button--secondary"
        @click="toggleAll"
      >
        <Octicon :name="allExpanded ? 'fold' : 'unfold'" :size="14" />
        {{ allExpanded ? "折叠全部" : "展开全部" }}
      </button>
      <button
        v-else
        class="button button--secondary"
        :disabled="loading"
        @click="emit('load-diff')"
      >
        <Octicon
          :name="loading ? 'sync' : 'download'"
          :size="14"
          :class="{ spinning: loading }"
        />
        {{ loading ? "正在获取…" : "获取代码修改" }}
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
      :class="{ 'diff-file-block--blocked': isLargeFile(file) }"
      :open="expanded.has(file.path)"
      @toggle="
        toggleFile(
          file,
          ($event.currentTarget as HTMLDetailsElement).open,
          $event.currentTarget as HTMLDetailsElement,
        )
      "
    >
      <summary
        :aria-disabled="isLargeFile(file)"
        @click="blockLargeFile(file, $event)"
      >
        <span>
          <Octicon name="file-diff" :size="15" />
          {{ file.path }}
        </span>
        <span>
          <strong class="add">+{{ file.additions }}</strong>
          <strong class="del">-{{ file.deletions }}</strong>
          <a
            v-if="isLargeFile(file) && githubUrl"
            class="diff-file-github"
            :href="`${githubUrl}/files`"
            target="_blank"
            rel="noreferrer"
            @click.stop
          >
            超过 1000 行 · GitHub 查看
            <Octicon name="link-external" :size="12" />
          </a>
          <Octicon :name="isLargeFile(file) ? 'lock' : 'chevron-down'" :size="14" />
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
        <Octicon
          :name="loading ? 'sync' : 'download'"
          :size="14"
          :class="{ spinning: loading }"
        />
        {{
          loading
            ? "正在统一获取代码修改…"
            : diff.statsOnly
              ? "尚未获取代码修改，请点击上方统一获取按钮。"
              : "GitHub 未返回该文件的文本代码修改。"
        }}
      </div>
    </details>
  </div>
</template>
