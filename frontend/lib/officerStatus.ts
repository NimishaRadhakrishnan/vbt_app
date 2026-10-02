/**
 * Pure derivation logic for the Live Tracking Map's officer list.
 * Kept separate from page.tsx so it can be unit tested and so the
 * table, the map, and the summary counts all read from one source
 * of truth instead of recomputing (and potentially disagreeing).
 */

export interface RawUser {
  id: string;
  full_name: string;
  role: string;
}

export interface RawActiveLocation {
  officer_id: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null; // meters; null = device never reported one
  speed: number | null;
  battery_level: number | null;
  status: "active" | "stale" | "location_unavailable" | "low_accuracy" | string;
  updated_at: string | null; // null => this officer has never sent a real GPS ping
  login_time?: string | null;
  login_latitude?: number | null;
  login_longitude?: number | null;
}

export type OfficerStatusLabel = "Active" | "Stale" | "Location unavailable" | "Low accuracy";

export interface LiveOfficer {
  id: string;
  name: string;
  role: string;
  district: string;
  status: OfficerStatusLabel;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  speed: number | null;
  battery: number | null;
  lastVisit: string; // human readable "Last seen X min ago" or "Never reported"
  hasTelemetry: boolean;
  everReported: boolean;
  loginTime: string | null;
  loginLat: number | null;
  loginLng: number | null;
}

function statusLabelFrom(status: string | undefined): OfficerStatusLabel {
  if (status === "active") return "Active";
  if (status === "stale") return "Stale";
  if (status === "low_accuracy") return "Low accuracy";
  return "Location unavailable";
}

/**
 * Only ever show a relative "Last seen X min ago" string when a real
 * GPS ping has an updated_at timestamp. Otherwise, say so plainly —
 * never fabricate or imply a recent timestamp that doesn't exist.
 */
export function formatLastSeen(updatedAt: string | null | undefined, now: number = Date.now()): string {
  if (!updatedAt) return "Never reported";
  const diffMs = now - new Date(updatedAt).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "Never reported";
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 1) return "Last seen just now";
  if (diffMins < 60) return `Last seen ${diffMins} min ago`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `Last seen ${diffHours} hr ago`;
  const diffDays = Math.round(diffHours / 24);
  return `Last seen ${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

export function computeLiveOfficers(
  users: RawUser[],
  activeLocations: RawActiveLocation[],
  now: number = Date.now()
): LiveOfficer[] {
  const fieldUsers = users.filter((u) => u.role === "field_officer" || u.role === "sales_officer");

  return fieldUsers.map((u) => {
    const loc = activeLocations.find((l) => l.officer_id === u.id);
    const hasLocation = !!loc && loc.latitude !== null && loc.longitude !== null;
    const everReported = !!loc && !!loc.updated_at;

    return {
      id: u.id,
      name: u.full_name,
      role: u.role === "field_officer" ? "Field Officer" : "Sales Officer",
      status: statusLabelFrom(loc?.status),
      district: "-",
      lat: hasLocation ? (loc as RawActiveLocation).latitude : null,
      lng: hasLocation ? (loc as RawActiveLocation).longitude : null,
      accuracy: loc && loc.accuracy !== null && loc.accuracy !== undefined ? loc.accuracy : null,
      speed: loc && loc.speed !== null && loc.speed !== undefined ? loc.speed : null,
      battery: loc && loc.battery_level !== null && loc.battery_level !== undefined ? loc.battery_level : null,
      lastVisit: formatLastSeen(loc?.updated_at, now),
      hasTelemetry: hasLocation,
      everReported,
      loginTime: loc?.login_time ?? null,
      loginLat: loc?.login_latitude ?? null,
      loginLng: loc?.login_longitude ?? null,
    };
  });
}

export function countActive(officers: LiveOfficer[]): number {
  return officers.filter((o) => o.status === "Active").length;
}
