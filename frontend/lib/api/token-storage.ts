/**
 * Token storage.
 *
 * The refresh token is kept in localStorage, not sessionStorage - closing
 * a Chrome tab (or the whole browser) must not log the user out, only an
 * explicit "Logout" should. sessionStorage was the original Phase 1
 * choice here, but Chrome clears it the moment a tab closes, which meant
 * admins got silently logged out just from closing the tab, with no way
 * to "stay signed in". localStorage persists across tab closures and
 * browser restarts, and auth-context.tsx already re-authenticates from
 * whatever refresh token it finds on load, so this is a one-line change
 * in where the token lives, not a new code path.
 *
 * SECURITY NOTE (tracked for a later phase): the refresh token is still
 * readable by any script on the page (XSS risk) either way - localStorage
 * isn't meaningfully worse than sessionStorage on that front, just longer-
 * lived. The hardened version of this, once the backend supports it, is to
 * have POST /auth/login set the refresh token as an httpOnly, Secure,
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
    return window.localStorage.getItem(REFRESH_TOKEN_KEY);
  },
  setRefreshToken(token: string | null): void {
    if (typeof window === "undefined") return;
    if (token) {
      window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  },
  clear(): void {
    inMemoryAccessToken = null;
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  },
};
