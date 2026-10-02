import { apiFetch } from "@/lib/api/client";
import { tokenStorage } from "@/lib/api/token-storage";
import type {
  CurrentUser,
  LoginRequest,
  TokenResponse,
} from "@/lib/types/auth";


export async function login(payload: LoginRequest): Promise<TokenResponse> {
  const tokens = await apiFetch<TokenResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
    skipAuth: true,
  });
  tokenStorage.setAccessToken(tokens.access_token);
  tokenStorage.setRefreshToken(tokens.refresh_token);
  return tokens;
}

export async function fetchCurrentUser(): Promise<CurrentUser> {
  return apiFetch<CurrentUser>("/auth/me", { method: "GET" });
}

export async function logout(): Promise<void> {
  const refreshToken = tokenStorage.getRefreshToken();
  tokenStorage.clear();
  if (!refreshToken) return;
  try {
    await apiFetch<void>("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
      skipAuth: true,
      skipRefreshRetry: true,
    });
  } catch {
    // Best-effort server-side revocation; local tokens are already cleared
    // either way, so the user is logged out client-side regardless.
  }
}
