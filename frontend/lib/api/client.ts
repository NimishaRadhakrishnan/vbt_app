import type { ApiErrorResponse } from "@/lib/types/auth";
import { tokenStorage } from "@/lib/api/token-storage";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions extends RequestInit {
  /** Skip attaching the Authorization header (e.g. for /auth/login itself). */
  skipAuth?: boolean;
  /** Skip the automatic refresh-and-retry-once behavior on a 401. */
  skipRefreshRetry?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshAccessToken(): Promise<boolean> {
  const refreshToken = tokenStorage.getRefreshToken();
  if (!refreshToken) return false;

  // Only one refresh call in flight at a time, even if several requests
  // 401 concurrently.
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
      .then(async (res) => {
        if (!res.ok) return false;
        const data = await res.json();
        tokenStorage.setAccessToken(data.access_token);
        tokenStorage.setRefreshToken(data.refresh_token);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { skipAuth, skipRefreshRetry, headers, ...rest } = options;

  const buildHeaders = (): HeadersInit => {
    const base: Record<string, string> = { 
      "Content-Type": "application/json",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    };
    if (!skipAuth) {
      const accessToken = tokenStorage.getAccessToken();
      if (accessToken) base.Authorization = `Bearer ${accessToken}`;
    }
    return { ...base, ...(headers as Record<string, string>) };
  };

  const method = rest.method || "GET";
  let url = `${API_BASE_URL}${path}`;
  if (method.toUpperCase() === "GET") {
    const buster = `_cb=${Date.now()}`;
    url = url.includes("?") ? `${url}&${buster}` : `${url}?${buster}`;
  }

  let response = await fetch(url, {
    cache: "no-store",
    ...rest,
    headers: buildHeaders(),
  });

  if (response.status === 401 && !skipAuth && !skipRefreshRetry) {
    const refreshed = await tryRefreshAccessToken();
    if (refreshed) {
      let retryUrl = `${API_BASE_URL}${path}`;
      if (method.toUpperCase() === "GET") {
        const buster = `_cb=${Date.now()}`;
        retryUrl = retryUrl.includes("?") ? `${retryUrl}&${buster}` : `${retryUrl}?${buster}`;
      }
      response = await fetch(retryUrl, {
        cache: "no-store",
        ...rest,
        headers: buildHeaders(),
      });
    }
  }

  if (!response.ok) {
    let errorBody: any = null;
    try {
      errorBody = await response.json();
    } catch {
      // Response body wasn't JSON; fall through to the generic error below.
    }
    let message = errorBody?.message ?? errorBody?.detail ?? `Request failed with status ${response.status}`;
    if (Array.isArray(message)) {
      message = message.map((e: any) => {
        const fieldStr = (e.loc && e.loc.length > 1) ? e.loc[e.loc.length - 1] + ': ' : '';
        return fieldStr + (e.msg || JSON.stringify(e));
      }).join(", ");
    }
    throw new ApiError(
      response.status,
      errorBody?.code ?? "unknown_error",
      message,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
