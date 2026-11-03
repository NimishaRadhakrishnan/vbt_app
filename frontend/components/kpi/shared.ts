import { API_BASE_URL, apiFetch } from "@/lib/api/client";
import { tokenStorage } from "@/lib/api/token-storage";
import { downloadAuthenticatedFile } from "@/lib/api/download";

export type Officer = {
  id: string; name: string; employee_id: string | null; work_mode: "field" | "sales" | "both";
  manager_id: string | null; regions: string[]; region_ids: string[];
};
export type Item = { code: string; name: string; help: string | null; mode: "field" | "sales"; unit: string; unit_label: string; has_goal: boolean };
export type Goal = { officer_id: string; code: string; year: number; month: number; value: number };
export type Region = { id: string; name: string };

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const api = <T,>(path: string, init?: RequestInit) => apiFetch<T>(`/kpi/admin${path}`, init);
export const send = <T,>(path: string, method: string, body: unknown) =>
  api<T>(path, { method, body: JSON.stringify(body) });

/** First month of the financial year (Settings: kpi.quarter_start_month, default April). */
export function quarterOptions(fyStartMonth = 4): { label: string; months: string[] }[] {
  const now = new Date();
  const monthsSinceFy = (now.getMonth() + 1 - fyStartMonth + 12) % 12;
  const curQStart = now.getFullYear() * 12 + now.getMonth() - (monthsSinceFy % 3);
  const result: { label: string; months: string[] }[] = [];
  for (let k = -2; k <= 2; k++) {          // two quarters back, this one, two ahead
    const ms: string[] = [];
    for (let i = 0; i < 3; i++) {
      const t = curQStart + k * 3 + i;
      ms.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`);
    }
    const [y0, m0] = ymParts(ms[0]!);
    const [y2, m2] = ymParts(ms[2]!);
    result.push({ label: `${MONTH_NAMES[m0 - 1]}–${MONTH_NAMES[m2 - 1]} ${y2}${y0 !== y2 ? ` (from ${y0})` : ""}`, months: ms });
  }
  return result;
}

/** "2026-10" -> [2026, 10] */
export const ymParts = (ym: string): [number, number] => {
  const [y, m] = ym.split("-").map(Number);
  return [y ?? 0, m ?? 1];
};

export const monthLabel = (ym: string) => {
  const [y, m] = ymParts(ym);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

export async function downloadTemplate(path: string, filename: string) {
  await downloadAuthenticatedFile(`${API_BASE_URL}/kpi/admin${path}`, filename);
}

export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API_BASE_URL}/kpi/admin${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenStorage.getAccessToken() ?? ""}` },
    body: fd,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const d = body?.detail ?? body?.message;
    throw new Error(typeof d === "string" ? d : "Upload failed.");
  }
  return body as T;
}

export const rupees = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
