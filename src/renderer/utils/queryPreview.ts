/** Single-line SQL preview for the result identity bar (multiple cells / history). */

const QUERY_PREVIEW_MAX_CHARS = 52;

export function buildQueryPreview(sql: string | undefined, fallbackLabel: string): string {
  if (!sql?.trim()) {
    return fallbackLabel;
  }
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= QUERY_PREVIEW_MAX_CHARS) {
    return oneLine;
  }
  return `${oneLine.slice(0, QUERY_PREVIEW_MAX_CHARS - 1)}…`;
}
