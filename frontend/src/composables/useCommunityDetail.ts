import { ref } from "vue";
import { api, ApiError } from "../api/client";
import { communityItemKey } from "../data/workspace";
import type { AnalysisDocument, CommunityItem } from "../types";

export function useCommunityDetail(notify: (message: string) => void) {
  const selectedItem = ref<CommunityItem | null>(null);
  const detailAnalysis = ref<AnalysisDocument | null>(null);
  const detailAnalyzing = ref(false);
  const detailDiffLoading = ref(false);
  let detailRequestId = 0;
  let detailDiffRequestId = 0;

  async function selectCommunityItem(item: CommunityItem) {
    const requestId = ++detailRequestId;
    detailDiffRequestId += 1;
    detailDiffLoading.value = false;
    selectedItem.value = item;
    detailAnalysis.value = null;
    try {
      const result = await api.communityItem(item.repo, item.kind, item.id);
      if (
        requestId !== detailRequestId ||
        !selectedItem.value ||
        communityItemKey(selectedItem.value) !== communityItemKey(item)
      ) {
        return;
      }
      selectedItem.value = result.item;
      detailAnalysis.value = result.analyses[0] ?? null;
    } catch (cause) {
      if (requestId === detailRequestId) {
        notify(cause instanceof ApiError ? cause.message : "详情加载失败");
      }
    }
  }

  async function analyzeSelectedItem(item: CommunityItem, prompt = "") {
    detailAnalyzing.value = true;
    try {
      const result = await api.analyzeCommunityItem(
        item.repo,
        item.kind,
        item.id,
        prompt,
      );
      detailAnalysis.value = result.analysis;
      notify(
        result.provider === "api"
          ? "AI 深度分析已生成"
          : "已生成离线分析；配置 AI API 后可获得模型结果",
      );
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.message : "深度分析失败");
    } finally {
      detailAnalyzing.value = false;
    }
  }

  async function loadSelectedDiff(item: CommunityItem) {
    if (item.kind !== "pr" || detailDiffLoading.value) return;
    const requestId = ++detailDiffRequestId;
    const itemKey = communityItemKey(item);
    detailDiffLoading.value = true;
    try {
      const result = await api.communityDiffFiles(item.repo, item.id);
      if (
        requestId === detailDiffRequestId &&
        selectedItem.value &&
        communityItemKey(selectedItem.value) === itemKey
      ) {
        const current = selectedItem.value;
        const loadedEntries = new Map(
          result.entries.map((entry) => [entry.path, entry]),
        );
        const skippedNotice =
          result.skippedLarge > 0
            ? `；${result.skippedLarge} 个超过 1000 行的文件已跳过，请前往 GitHub 查看`
            : "";
        selectedItem.value = {
          ...current,
          diff: current.diff
            ? {
                ...current.diff,
                statsOnly: false,
                entries: current.diff.entries.map((candidate) =>
                  loadedEntries.get(candidate.path) ?? candidate,
                ),
                notice: `已统一获取 ${result.entries.length} 个文件的代码修改${skippedNotice}。`,
              }
            : current.diff,
        };
        notify(`已统一获取 ${result.entries.length} 个文件的代码修改`);
      }
    } catch (cause) {
      if (requestId === detailDiffRequestId) {
        notify(cause instanceof ApiError ? cause.message : "代码修改获取失败");
      }
    } finally {
      if (requestId === detailDiffRequestId) {
        detailDiffLoading.value = false;
      }
    }
  }

  function closeDetail() {
    detailRequestId += 1;
    detailDiffRequestId += 1;
    detailDiffLoading.value = false;
    selectedItem.value = null;
    detailAnalysis.value = null;
  }

  return {
    analyzeSelectedItem,
    closeDetail,
    detailAnalysis,
    detailAnalyzing,
    detailDiffLoading,
    loadSelectedDiff,
    selectedItem,
    selectCommunityItem,
  };
}
