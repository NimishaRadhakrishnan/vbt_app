"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";

// District names configured by the admin (Admin > Districts).
export function useDistricts(defaults: string[]): string[] {
  const [names, setNames] = useState<string[]>(defaults);
  useEffect(() => {
    let alive = true;
    apiFetch<any[]>("/districts")
      .then((rows) => {
        if (alive && Array.isArray(rows) && rows.length) setNames(rows.map((r) => r.name));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return names;
}
