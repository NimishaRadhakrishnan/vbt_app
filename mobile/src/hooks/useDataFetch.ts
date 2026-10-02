import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient } from '../services/api';

// Fix #3 (collapses the audit's loading-state gap and offline-resilience
// gap into one pattern): every screen that fetches on mount previously
// wrote its own ad hoc loading/error handling - 6 screens had none at
// all, and none of them told the officer when data on screen was stale
// because the last fetch failed while offline. One hook standardizes:
//   loading -> success, or
//   loading -> error (with retry), or
//   error/offline but a previous successful result exists -> keep
//   showing that data, flagged as possibly stale, instead of a blank
//   error screen replacing perfectly good (if old) numbers.
//
// Plain-language error copy is standardized here too, per the app-wide
// "no jargon" rule - one string, not a different phrase per screen.
export const CONNECTION_ERROR_MESSAGE = "Couldn't connect. Tap to try again.";

export type FetchState<T> = {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  isStale: boolean; // true when `data` is left over from a previous successful fetch, not this one
  retry: () => void;
  refresh: () => void;
};

/**
 * fetcher: an async function returning the parsed response. Pass a
 * function (not a promise) so it can be re-invoked on retry/refresh/focus.
 * refetchOnFocus: re-run automatically every time the screen regains
 * focus (matches the useFocusEffect pattern most screens already used
 * ad hoc) - defaults to true since that's what most screens want.
 */
export function useDataFetch<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList = [],
  options: { refetchOnFocus?: boolean } = {}
): FetchState<T> {
  const refetchOnFocus = options.refetchOnFocus ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const hasLoadedOnce = useRef(false);

  const run = useCallback(
    (mode: 'initial' | 'retry' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);

      fetcher()
        .then((result) => {
          setData(result);
          setError(null);
          setIsStale(false);
          hasLoadedOnce.current = true;
        })
        .catch((err) => {
          // Keep whatever data is already on screen (flagged stale)
          // rather than blanking it out on a failed refresh/retry - a
          // number that might be a few minutes old beats no number at
          // all, as long as it's honestly labeled.
          if (hasLoadedOnce.current) {
            setIsStale(true);
          } else {
            setError(
              !apiClient.getOnlineStatus()
                ? CONNECTION_ERROR_MESSAGE
                : err?.message || CONNECTION_ERROR_MESSAGE
            );
          }
        })
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps
  );

  useEffect(() => {
    run('initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useFocusEffect(
    useCallback(() => {
      if (refetchOnFocus && hasLoadedOnce.current) {
        run('refresh');
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refetchOnFocus, run])
  );

  return {
    data,
    loading,
    refreshing,
    error,
    isStale,
    retry: () => run('retry'),
    refresh: () => run('refresh'),
  };
}
