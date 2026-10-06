/** Some endpoints return a bare array, others `{ items, total }`. Both give a list. */
export function asList<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const items = (res as { items?: unknown } | null | undefined)?.items;
  return Array.isArray(items) ? (items as T[]) : [];
}
