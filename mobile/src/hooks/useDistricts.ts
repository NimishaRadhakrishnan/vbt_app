import { useEffect, useState } from 'react';
import { apiClient } from '../services/api';

// District names configured by the admin. Falls back to the last list seen
// (or the supplied defaults) when offline, so forms always have choices.
let cached: string[] | null = null;

export function useDistricts(defaults: string[]): string[] {
  const [names, setNames] = useState<string[]>(cached ?? defaults);
  useEffect(() => {
    let alive = true;
    apiClient
      .request('/districts', 'GET', 'task_action')
      .then((rows: any) => {
        if (!alive || !Array.isArray(rows) || rows.length === 0) return;
        cached = rows.map((r: any) => r.name);
        setNames(cached as string[]);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return names;
}
