import { tokenStorage } from "@/lib/api/token-storage";

/**
 * Download a file from an authenticated API endpoint.
 *
 * Why this exists: several places used `<a href={API_URL}>` or
 * `window.open(API_URL)` for exports. A browser navigation carries NO
 * Authorization header, so every one of those returned
 * `{"detail":"Not authenticated"}` instead of a file. The bug is easy to
 * reintroduce because the markup looks obviously correct, so the fetch
 * lives here once rather than being re-typed per page.
 *
 * Fetches with the bearer token, then saves the response as a blob.
 */
export async function downloadAuthenticatedFile(
  url: string,
  filename: string
): Promise<void> {
  const token = tokenStorage.getAccessToken();

  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    // 401/403 here almost always means the session expired while the
    // page stayed open - worth saying plainly, because "Not
    // authenticated" on a download button reads as a broken feature.
    if (res.status === 401 || res.status === 403) {
      throw new Error("Your session has expired. Please sign in again and retry the export.");
    }
    throw new Error(`Export failed (${res.status}). Please try again.`);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Released even if the click throws - otherwise the blob is held
    // for the life of the page, and admins export repeatedly.
    URL.revokeObjectURL(objectUrl);
  }
}

/** Convenience: dated filename like `daily-visits-2026-09-09.xlsx`. */
export function datedFilename(prefix: string, ext: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}
