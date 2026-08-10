import {
  rowJsonStringArray,
  rowText,
  type DatabaseRow,
} from "./database-row";

export function mapTechnicalDocument(row: DatabaseRow) {
  return {
    id: rowText(row, "id"),
    category: rowText(row, "category"),
    slug: rowText(row, "slug"),
    title: rowText(row, "title"),
    summary: rowText(row, "summary"),
    contentMd: rowText(row, "content_md"),
    tags: rowJsonStringArray(row, "tags_json"),
    sourceRefs: rowJsonStringArray(row, "source_refs_json"),
    createdAt: rowText(row, "created_at"),
    updatedAt: rowText(row, "updated_at"),
  };
}
