/**
 * REST API Client for Mobile FFM App.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { dbService, SyncPayload } from './db';
import { getDeviceId } from './deviceId';

// Persisted session so a returning officer with a valid session lands on
// Dashboard on cold open instead of Login. Previously nothing survived an
// app restart - isLoggedIn() only reflected the current in-memory token,
// so "route straight to Dashboard while a valid session exists" never
// actually worked past the first cold start.
const SESSION_STORAGE_KEY = 'ffm_session_v1';

interface PersistedSession {
  token: string;
  refreshToken?: string;
  userId: string;
  userFullName: string;
  userRole: string;
  userEmployeeId: string;
  deviceId: string;
}

// Previously hardcoded to 'http://localhost:8000/api/v1' unconditionally -
// meant every build (dev, preview, store) pointed at the same address,
// and on a physical device 'localhost' means the device itself, not a
// dev machine, so real-device testing failed silently (LocationService.ts
// swallows ping errors with a console.warn, so nothing visible on screen
// told you why).
//
// EXPO_PUBLIC_-prefixed env vars are inlined into the JS bundle
// automatically by Metro as of SDK 49 - no app.config.js/Constants
// plumbing needed for this to work; eas.json's per-profile `env` block
// is what actually sets the value per build. Falls back to localhost
// for plain `expo start` local dev, where that address is genuinely
// correct (web/simulator) or made correct via `adb reverse` (physical
// device over USB - see mobile/eas.json's development profile comment).
const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

class FFMAPIClient {
  private isOnline: boolean = true;
  private token: string | null = null;
  // The access token only lives 15 minutes. Without the refresh token the
  // phone silently stopped sending GPS pings (every ping got a 401) a few
  // minutes after login. The refresh token (7 days) gets a new one.
  private refreshToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  private userId: string | null = null;
  private userFullName: string | null = null;
  private userRole: string | null = null;
  private userEmployeeId: string | null = null;
  private deviceId: string | null = null;

  public setOnlineStatus(online: boolean) {
    this.isOnline = online;
    console.log(`[Network Status] App toggled to ${online ? 'ONLINE' : 'OFFLINE'}`);
    if (online) {
      this.triggerBackgroundSync();
    }
  }

  public getOnlineStatus(): boolean {
    return this.isOnline;
  }

  public setAuthToken(token: string) {
    this.token = token;
  }

  public getUserId(): string | null {
    return this.userId;
  }

  // Real per-install device identifier, resolved once at login and reused
  // for later requests (e.g. attendance check-in) so every call in a
  // session reports the same value rather than re-deriving it separately.
  public getDeviceIdValue(): string | null {
    return this.deviceId;
  }

  public getCurrentUser(): { id: string; fullName: string; role: string; employeeId: string } | null {
    if (!this.userId || !this.userFullName || !this.userRole) return null;
    return {
      id: this.userId,
      fullName: this.userFullName,
      role: this.userRole,
      employeeId: this.userEmployeeId ?? '',
    };
  }

  public isLoggedIn(): boolean {
    return !!this.token;
  }

  public logout() {
    this.token = null;
    this.refreshToken = null;
    this.userId = null;
    this.userFullName = null;
    this.userRole = null;
    this.userEmployeeId = null;
    this.deviceId = null;
    AsyncStorage.removeItem(SESSION_STORAGE_KEY).catch(() => {
      // Best-effort: an officer signing out on a phone about to be wiped
      // anyway shouldn't be blocked by a storage error.
    });
  }

  private async persistSession() {
    if (!this.token || !this.userId || !this.userFullName || !this.userRole || !this.deviceId) return;
    const session: PersistedSession = {
      token: this.token,
      refreshToken: this.refreshToken ?? undefined,
      userId: this.userId,
      userFullName: this.userFullName,
      userRole: this.userRole,
      userEmployeeId: this.userEmployeeId ?? '',
      deviceId: this.deviceId,
    };
    await AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  // Called once at app start (SplashScreen). Restores an existing session
  // from disk into memory so isLoggedIn()/getCurrentUser() reflect it
  // without requiring the officer to sign in again. Does NOT verify the
  // token against the backend - a truly expired/revoked token still gets
  // rejected the first time a real request is made, which surfaces as a
  // normal auth error in whichever screen makes that call.
  public async restoreSession(): Promise<boolean> {
    try {
      const raw = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return false;
      const session: PersistedSession = JSON.parse(raw);
      if (!session.token || !session.userId) return false;
      this.token = session.token;
      this.refreshToken = session.refreshToken ?? null;
      this.userId = session.userId;
      this.userFullName = session.userFullName;
      this.userRole = session.userRole;
      this.userEmployeeId = session.userEmployeeId;
      this.deviceId = session.deviceId;
      return true;
    } catch {
      return false;
    }
  }

  // Real login: authenticates against the backend and stores the real
  // access token + user id. Previously LoginScreen accepted any non-empty
  // employee ID/password and set a hardcoded 'mock-jwt-token', so no
  // request ever succeeded once real network calls were made.
  //
  // device_id is now a real OS-persisted identifier (see deviceId.ts),
  // not omitted. The backend's LoginUserUseCase binds it to the account
  // on first login and rejects mismatches on later logins - previously
  // the mobile app never sent this field at all, so that check was never
  // actually engaged for mobile logins.
  public async login(employeeId: string, password: string): Promise<{ id: string; fullName: string; role: string }> {
    this.deviceId = await getDeviceId();
    const loginRes = await this.sendRequest('/auth/login', 'POST', {
      employee_id: employeeId,
      password,
      device_id: this.deviceId,
    });
    this.token = loginRes.access_token;
    this.refreshToken = loginRes.refresh_token ?? null;

    const me = await this.sendRequest('/auth/me', 'GET');
    this.userId = me.id;
    this.userFullName = me.full_name;
    this.userRole = me.role;
    this.userEmployeeId = me.employee_id ?? employeeId;
    await this.persistSession();
    return { id: me.id, fullName: me.full_name, role: me.role };
  }

  // Uploads a captured photo as multipart/form-data and returns the real
  // URL the backend stored it at. Deliberately bypasses request()'s JSON
  // path and offline queue - a local file URI (especially one from the
  // camera's cache) isn't safely replayable later the way a JSON payload
  // is, so this only succeeds while actually online.
  public async uploadFile(endpoint: string, fileUri: string, fileName: string, mimeType: string): Promise<string> {
    const formData = new FormData();
    // React Native's FormData expects this {uri, name, type} shape for a
    // file field, not a browser File object - fetch/RN sets the
    // multipart boundary itself, so Content-Type is intentionally not
    // set manually here (matches the JSON path avoiding that mistake too).
    formData.append('file', {
      uri: fileUri,
      name: fileName,
      type: mimeType,
    } as any);

    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${BACKEND_URL}${endpoint}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      throw await this.toReadableError(response);
    }
    const data = await response.json();
    return data.url;
  }

  // Turns a failed response into an Error with a plain-language message
  // and the HTTP status attached, instead of the raw
  // "Request failed (422): {\"detail\":[{...}]}" every screen used to
  // show verbatim in an Alert - that was the literal response body,
  // FastAPI validation errors included, shown to an officer in the field
  // as if it were meant to be read. Extracts FastAPI's `detail` field
  // (a plain string, or the first validation message when it's the
  // structured list form) when present, and falls back to a generic
  // message keyed off the status range otherwise - never the raw body.
  private async toReadableError(response: Response): Promise<Error & { status?: number }> {
    let message = `Something went wrong (${response.status}). Please try again.`;
    try {
      const body = await response.json();
      if (typeof body?.detail === 'string') {
        message = body.detail;
      } else if (Array.isArray(body?.detail) && body.detail[0]?.msg) {
        message = body.detail[0].msg;
      } else if (response.status === 401 || response.status === 403) {
        message = 'You are not allowed to do that. Please sign in again.';
      } else if (response.status >= 500) {
        message = 'The server had a problem. Please try again in a moment.';
      }
    } catch {
      // Body wasn't JSON (or was empty) - keep the generic message above
      // rather than showing raw/partial response text.
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = response.status;
    return err;
  }

  // Trigger re-syncing database queue
  private async triggerBackgroundSync() {
    await dbService.syncQueueWithBackend(async (item: SyncPayload) => {
      try {
        await this.sendRequest(item.endpoint, item.method, item.data);
        return true;
      } catch (err) {
        console.warn(`[Sync] Failed to upload queued item [${item.type}]`, err);
        return false;
      }
    });
  }

  // Does the actual HTTP call. Throws on any network or server error.
  // Swaps the refresh token for a fresh access token. One call at a time:
  // the server rotates refresh tokens, so two parallel refreshes (screen +
  // background GPS task) would invalidate each other.
  private refreshAccessToken(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    const usedToken = this.token;
    this.refreshing = (async () => {
      try {
        // The saved login on disk is the shared truth: the screens and the
        // background GPS task can run in separate JS contexts, and the
        // refresh token is single-use. If the other side already refreshed,
        // take its new token instead of spending the (now dead) old one.
        const raw = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
        if (!raw) return false; // signed out
        const saved: PersistedSession = JSON.parse(raw);
        if (saved.token && saved.token !== usedToken) {
          this.token = saved.token;
          this.refreshToken = saved.refreshToken ?? this.refreshToken;
          return true;
        }
        const refreshToken = saved.refreshToken ?? this.refreshToken;
        if (!refreshToken) return false;
        const res = await fetch(`${BACKEND_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok) return false;
        const body = await res.json();
        if (!body?.access_token) return false;
        this.token = body.access_token;
        this.refreshToken = body.refresh_token ?? refreshToken;
        await this.persistSession();
        return true;
      } catch {
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  // Makes sure this client has a session in memory (the background GPS
  // task can start in a new JS context after Android restarts the app).
  public async ensureSession(): Promise<string | null> {
    if (!this.userId) await this.restoreSession();
    return this.userId;
  }

  private async sendRequest(endpoint: string, method: string, data?: any, retried = false): Promise<any> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${BACKEND_URL}${endpoint}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(data ?? {}),
    });

    if (response.status === 401 && !retried && !endpoint.startsWith('/auth/')) {
      if (await this.refreshAccessToken()) {
        return this.sendRequest(endpoint, method, data, true);
      }
    }
    if (!response.ok) {
      throw await this.toReadableError(response);
    }
    if (response.status === 204) return { success: true };
    return response.json().catch(() => ({ success: true }));
  }

  // Wrapper that automatically falls back to an offline queue when there is no
  // connection, and re-queues on server errors so nothing is silently lost.
  public async request(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    type: SyncPayload['type'],
    data?: any,
    options: { queue?: boolean } = {}
  ): Promise<any> {
    // queue:false is for calls that must never be replayed later (searches,
    // lookups sent as POST): they just fail and the user can retry.
    const canQueue = options.queue !== false;
    if (!this.isOnline) {
      if (method !== 'GET' && !canQueue) {
        throw new Error('Connection offline. Please try again when you are back online.');
      }
      if (method !== 'GET') {
        await dbService.queueItem(type, data, endpoint, method);
        return { offline: true, message: 'Saved to sync queue.' };
      }
      throw new Error('Connection offline. Cannot load live reports.');
    }

    try {
      return await this.sendRequest(endpoint, method, data);
    } catch (err: any) {
      // Only queue for retry when the request genuinely couldn't be
      // delivered (network blip, or the server itself had a problem -
      // no response, or a 5xx). A 4xx means the server received the
      // request and rejected it as invalid (bad data, insufficient
      // stock, expired session, etc.) - resubmitting the exact same
      // payload will fail the exact same way every time, so queuing it
      // used to leave a permanently-broken item silently retrying
      // forever in the background (see syncQueueWithBackend), stuck
      // behind the same honest "Saved on device" indicator that's
      // supposed to mean "this will go through." Surface the real error
      // immediately instead.
      const status = err?.status;
      const isClientRejection = typeof status === 'number' && status >= 400 && status < 500;
      if (method !== 'GET' && canQueue && !isClientRejection) {
        await dbService.queueItem(type, data, endpoint, method);
      }
      throw err;
    }
  }
}

export const apiClient = new FFMAPIClient();
