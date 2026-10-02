/**
 * PHASE 3A ITEM 6 — location consent state.
 *
 * Consent is authoritative on the BACKEND, cached locally only as a
 * fast path so the disclosure screen doesn't flash on every app open.
 *
 * Deliberately NOT routed through apiClient.request()'s offline queue.
 * Queuing an acceptance would mean the app proceeds to request location
 * permissions on the strength of a consent the server has not recorded -
 * and if that queued item later failed, we would be tracking an officer
 * with no consent record at all. Consent is the one action in this app
 * that must be confirmed before its consequences happen, so it requires
 * connectivity and says so plainly to the officer.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from './api';
import { BUNDLED_DISCLOSURE, DisclosureContent } from '../constants/disclosure';

const CACHE_KEY = 'location_consent_v1';

interface CachedConsent {
  userId: string;
  acceptedVersion: number;
  acceptedAt: string;
}

export interface ConsentStatus {
  /** Disclosure the officer must see, from the backend when reachable. */
  disclosure: DisclosureContent;
  /** True when this officer has already accepted the current version. */
  accepted: boolean;
  /** True when the copy shown came from the bundle, not the server. */
  usedFallback: boolean;
}

interface ServerConsentResponse {
  required_version: number;
  accepted_version: number | null;
  accepted_at: string | null;
  retention_months: number;
  title: string;
  points: { label: string; text: string }[];
  footer: string;
}

function toDisclosure(res: ServerConsentResponse): DisclosureContent {
  return {
    version: res.required_version,
    title: res.title,
    points: res.points,
    retentionMonths: res.retention_months,
    footer: res.footer,
  };
}

export const ConsentService = {
  /**
   * Reads cached acceptance without a network call. Used to decide
   * whether to even show the disclosure gate on app open, so an officer
   * who accepted months ago isn't blocked by a slow connection every
   * morning.
   */
  getCachedAcceptedVersion: async (): Promise<number | null> => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const cached: CachedConsent = JSON.parse(raw);
      // Scoped to the user: a shared phone handed to a different officer
      // must not inherit the previous officer's acceptance.
      if (cached.userId !== apiClient.getUserId()) return null;
      return cached.acceptedVersion;
    } catch {
      return null;
    }
  },

  /**
   * Authoritative check. Falls back to bundled copy only when the
   * backend is unreachable, and reports that it did so.
   */
  getStatus: async (): Promise<ConsentStatus> => {
    try {
      const res: ServerConsentResponse = await apiClient.request(
        '/consent/location',
        'GET',
        'consent'
      );
      const disclosure = toDisclosure(res);
      const accepted =
        res.accepted_version !== null && res.accepted_version >= res.required_version;

      if (accepted && res.accepted_at) {
        await AsyncStorage.setItem(
          CACHE_KEY,
          JSON.stringify({
            userId: apiClient.getUserId(),
            acceptedVersion: res.accepted_version,
            acceptedAt: res.accepted_at,
          } satisfies CachedConsent)
        );
      }

      return { disclosure, accepted, usedFallback: false };
    } catch (err) {
      console.warn('[Consent] Could not reach backend, using bundled disclosure', err);
      const cachedVersion = await ConsentService.getCachedAcceptedVersion();
      return {
        disclosure: BUNDLED_DISCLOSURE,
        accepted: cachedVersion !== null && cachedVersion >= BUNDLED_DISCLOSURE.version,
        usedFallback: true,
      };
    }
  },

  /**
   * Records acceptance. Throws when offline - the caller must surface
   * that rather than letting the officer through.
   */
  accept: async (version: number, usedFallback: boolean): Promise<void> => {
    if (!apiClient.getOnlineStatus()) {
      throw new Error(
        'You need an internet connection the first time you agree to this. Please try again when you have signal.'
      );
    }

    const res = await apiClient.request('/consent/location', 'POST', 'consent', {
      version,
      source: usedFallback ? 'bundled_fallback' : 'server',
    });

    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        userId: apiClient.getUserId(),
        acceptedVersion: version,
        acceptedAt: res?.accepted_at ?? new Date().toISOString(),
      } satisfies CachedConsent)
    );
  },

  /** Called on logout so a shared device does not leak the last officer's state. */
  clearCache: async (): Promise<void> => {
    await AsyncStorage.removeItem(CACHE_KEY).catch(() => undefined);
  },
};
