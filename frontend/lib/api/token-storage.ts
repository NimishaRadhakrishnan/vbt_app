/**
 * Token storage.
 *
 * SECURITY NOTE (tracked for a later phase): storing the refresh token in
 * sessionStorage is a pragmatic Phase 1 choice — it survives a page reload
 * within the tab without persisting across browser restarts, unlike
 * localStorage. It is still readable by any script on the page (XSS risk).
 * The hardened version of this, once the backend supports it, is to have
 * POST /auth/login set the refresh token as an httpOnly, Secure,
 * SameSite=Strict cookie so client-side JS never touches it at all. The
 * access token is deliberately kept in memory only (never persisted) since
 * it is short-lived and resending it via a refresh call on load is cheap.
 */

const REFRESH_TOKEN_KEY = "vbt_refresh_token";

let inMemoryAccessToken: string | null = null;

export const tokenStorage = {
  getAccessToken(): string | null {
    return inMemoryAccessToken;
  },
  setAccessToken(token: string | null): void {
    inMemoryAccessToken = token;
  },
  getRefreshToken(): string | null {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(REFRESH_TOKEN_KEY);
  },
  setRefreshToken(token: string | null): void {
    if (typeof window === "undefined") return;
    if (token) {
      window.sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
    } else {
      window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  },
  clear(): void {
    inMemoryAccessToken = null;
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  },
};
