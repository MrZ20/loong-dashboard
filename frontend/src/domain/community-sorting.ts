import type { CommunityItem } from "../types";

export type CommunitySortMode = "updated" | "number";

function updatedTimestamp(item: CommunityItem) {
  const timestamp = new Date(item.updatedAt || 0).valueOf();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function compareCommunityItems(
  left: CommunityItem,
  right: CommunityItem,
  mode: CommunitySortMode,
) {
  if (mode === "number") {
    return right.id - left.id || updatedTimestamp(right) - updatedTimestamp(left);
  }
  return updatedTimestamp(right) - updatedTimestamp(left) || right.id - left.id;
}

export function sortCommunityItems(
  items: CommunityItem[],
  mode: CommunitySortMode,
) {
  return [...items].sort((left, right) => compareCommunityItems(left, right, mode));
}
