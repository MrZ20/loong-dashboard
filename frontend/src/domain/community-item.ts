import type { CommunityItem } from "../types";

export function communityItemKey(
  item: Pick<CommunityItem, "repo" | "kind" | "id">,
) {
  return `${item.repo}:${item.kind}:${item.id}`;
}
