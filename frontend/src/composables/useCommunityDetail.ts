import { ref } from "vue";
import { api, ApiError } from "../api/client";
import { communityItemKey } from "../domain/community-item";
import type {
  AnalysisDocument,
  CommunityItem,
  LocalAnalysisEvent,
  LocalAnalysisJob,
  RefreshTaskType,
} from "../types";

export function useCommunityDetail(notify: (message: string) => void) {
  const selectedItem = ref<CommunityItem | null>(null);
  const detailAnalysis = ref<AnalysisDocument | null>(null);
  const detailAnalyzing = ref(false);
  const detailDiffLoading = ref(false);
  const detailTaskLoading = ref<RefreshTaskType | "">("");
  const detailLocalJob = ref<LocalAnalysisJob | null>(null);
  const detailLocalEvents = ref<LocalAnalysisEvent[]>([]);
  let detailRequestId = 0;
  let detailDiffRequestId = 0;
  let detailJobTimer: number | null = null;

  function stopJobPolling() {
    if (detailJobTimer !== null) window.clearTimeout(detailJobTimer);
    detailJobTimer = null;
  }

  async function reloadSelectedAfterJob(itemKey: string) {
    const current = selectedItem.value;
    if (!current || communityItemKey(current) !== itemKey) return;
    const result = await api.communityItem(current.repo, current.kind, current.id);
    if (!selectedItem.value || communityItemKey(selectedItem.value) !== itemKey) return;
    selectedItem.value = result.item;
    detailAnalysis.value = result.analyses[0] ?? detailAnalysis.value;
  }

  async function pollDetailJob(jobId: string, itemKey: string) {
    stopJobPolling();
    try {
      const after = detailLocalEvents.value.at(-1)?.sequence ?? 0;
      const result = await api.localAnalysisJob(jobId, after);
      if (!selectedItem.value || communityItemKey(selectedItem.value) !== itemKey) return;
      detailLocalJob.value = result.job;
      if (result.events.length) detailLocalEvents.value.push(...result.events);
      const terminal = ["completed", "failed", "cancelled"].includes(result.job.status);
      detailAnalyzing.value = !terminal;
      if (!terminal) {
        detailJobTimer = window.setTimeout(() => pollDetailJob(jobId, itemKey), 1_000);
        return;
      }
      await reloadSelectedAfterJob(itemKey);
      if (result.job.status === "completed") notify("OpenCode 深度分析已生成");
      else if (result.job.status === "cancelled") notify("深度分析已取消");
      else notify(result.job.error || "深度分析失败");
    } catch (cause) {
      detailAnalyzing.value = false;
      notify(cause instanceof ApiError ? cause.message : "深度分析状态读取失败");
    }
  }

  async function resumeDetailJob(item: CommunityItem) {
    try {
      const { jobs } = await api.localAnalysisJobs();
      const subjectKey = `${item.repo}:${item.kind}:${item.id}`;
      const job = jobs.find((candidate) =>
        candidate.jobType === "deep_analysis" &&
        candidate.subjectKey === subjectKey &&
        !["completed", "failed", "cancelled"].includes(candidate.status),
      );
      if (!job) return;
      detailLocalJob.value = job;
      detailLocalEvents.value = [];
      detailAnalyzing.value = true;
      await pollDetailJob(job.id, communityItemKey(item));
    } catch {
      // Detail content remains usable when the Runner status endpoint is unavailable.
    }
  }

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
      await resumeDetailJob(result.item);
    } catch (cause) {
      if (requestId === detailRequestId) {
        notify(cause instanceof ApiError ? cause.message : "详情加载失败");
      }
    }
  }

  async function analyzeSelectedItem(item: CommunityItem, requirement = "") {
    detailAnalyzing.value = true;
    try {
      const result = await api.analyzeCommunityItem(
        item.repo,
        item.kind,
        item.id,
        requirement,
      );
      if (result.job) {
        detailLocalJob.value = result.job;
        detailLocalEvents.value = [];
        if (selectedItem.value) selectedItem.value.deepAnalysisStatus = "running";
        await pollDetailJob(result.job.id, communityItemKey(item));
      } else if (result.analysis) {
        detailAnalysis.value = result.analysis;
        if (selectedItem.value) selectedItem.value.deepAnalysisStatus = "ready";
        notify("深度分析已生成");
      }
    } catch (cause) {
      if (selectedItem.value && !detailLocalJob.value) {
        selectedItem.value = {
          ...selectedItem.value,
          deepAnalysisStatus: "failed",
        };
      }
      notify(cause instanceof ApiError ? cause.message : "深度分析失败");
    } finally {
      if (!detailLocalJob.value || ["completed", "failed", "cancelled"].includes(detailLocalJob.value.status)) {
        detailAnalyzing.value = false;
      }
    }
  }

  async function cancelDetailAnalysis() {
    if (!detailLocalJob.value) return;
    try {
      await api.cancelLocalAnalysisJob(detailLocalJob.value.id);
      detailLocalJob.value = { ...detailLocalJob.value, status: "cancel_requested" };
      notify("已请求取消本地分析");
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.message : "取消分析失败");
    }
  }

  async function refreshSelectedItem(
    item: CommunityItem,
    taskType: Exclude<RefreshTaskType, "deep_analysis">,
  ) {
    detailTaskLoading.value = taskType;
    try {
      await api.refreshRepositoryTask(
        item.repo,
        taskType,
        `${item.repo}:${item.kind}:${item.id}`,
      );
      const result = await api.communityItem(item.repo, item.kind, item.id);
      selectedItem.value = result.item;
      detailAnalysis.value = result.analyses[0] ?? detailAnalysis.value;
      notify({
        facts: "社区事实已刷新；未触发摘要、分类或深度分析",
        summary: "摘要已更新；未刷新 GitHub 事实",
        classification: "分类标签已重新生成",
      }[taskType]);
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.message : "任务执行失败");
    } finally {
      detailTaskLoading.value = "";
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
    stopJobPolling();
    detailRequestId += 1;
    detailDiffRequestId += 1;
    detailDiffLoading.value = false;
    detailTaskLoading.value = "";
    selectedItem.value = null;
    detailAnalysis.value = null;
    detailLocalJob.value = null;
    detailLocalEvents.value = [];
    detailAnalyzing.value = false;
  }

  return {
    analyzeSelectedItem,
    cancelDetailAnalysis,
    closeDetail,
    detailAnalysis,
    detailAnalyzing,
    detailDiffLoading,
    detailTaskLoading,
    detailLocalJob,
    detailLocalEvents,
    loadSelectedDiff,
    refreshSelectedItem,
    selectedItem,
    selectCommunityItem,
  };
}
