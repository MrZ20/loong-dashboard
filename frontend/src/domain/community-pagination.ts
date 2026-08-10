export const COMMUNITY_PAGE_SIZE = 100;

export interface CommunityPagination {
  currentPage: number;
  totalPages: number;
  start: number;
  end: number;
}

export function communityPageMeta(
  totalItems: number,
  requestedPage: number,
  pageItemCount: number,
  pageSize = COMMUNITY_PAGE_SIZE,
): CommunityPagination {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const safeTotal = Math.max(0, Math.floor(totalItems) || 0);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const currentPage = Math.min(
    totalPages,
    Math.max(1, Math.floor(requestedPage) || 1),
  );
  const startIndex = (currentPage - 1) * safePageSize;
  const safePageItemCount = Math.min(
    safePageSize,
    Math.max(0, safeTotal - startIndex),
    Math.max(0, Math.floor(pageItemCount) || 0),
  );

  return {
    currentPage,
    totalPages,
    start: safePageItemCount ? startIndex + 1 : 0,
    end: safePageItemCount ? startIndex + safePageItemCount : 0,
  };
}
