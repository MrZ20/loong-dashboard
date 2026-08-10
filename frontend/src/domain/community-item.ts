import type { CommunityItem } from "../types/community";

export function communityItemKey(
  item: Pick<CommunityItem, "repo" | "kind" | "id">,
) {
  return `${item.repo}:${item.kind}:${item.id}`;
}
