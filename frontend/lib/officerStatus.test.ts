import { describe, it, expect } from "vitest";
import { computeLiveOfficers, countActive, formatLastSeen, RawUser, RawActiveLocation } from "./officerStatus";

const NOW = new Date("2026-07-29T12:00:00Z").getTime();

const users: RawUser[] = [
  { id: "u1", full_name: "Dinesh Prabhu", role: "field_officer" },
  { id: "u2", full_name: "Karthik Raja", role: "sales_officer" },
  { id: "u3", full_name: "Suresh Kumar", role: "field_officer" },
  { id: "u4", full_name: "Nimisha R", role: "admin" }, // must be excluded
];

const locations: RawActiveLocation[] = [
  {
    officer_id: "u1",
    latitude: 11.66,
    longitude: 78.14,
    speed: 12,
    battery_level: 80,
    status: "active",
    accuracy: 10,
    updated_at: new Date(NOW - 2 * 60000).toISOString(), // 2 min ago
  },
  {
    officer_id: "u2",
    latitude: 11.2,
    longitude: 78.16,
    speed: 0,
    battery_level: 40,
    status: "stale",
    accuracy: 10,
    updated_at: new Date(NOW - 20 * 60000).toISOString(), // 20 min ago
  },
  // u3 has no row at all => never reported
];

describe("computeLiveOfficers", () => {
  it("excludes non field/sales roles", () => {
    const officers = computeLiveOfficers(users, locations, NOW);
    expect(officers.find((o) => o.id === "u4")).toBeUndefined();
    expect(officers.length).toBe(3);
  });

  it("marks an officer with no ping row as Never reported, not a fake recent time", () => {
    const officers = computeLiveOfficers(users, locations, NOW);
    const u3 = officers.find((o) => o.id === "u3")!;
    expect(u3.everReported).toBe(false);
    expect(u3.lastVisit).toBe("Never reported");
    expect(u3.status).toBe("Location unavailable");
  });

  it("formats a real recent ping as 'Last seen N min ago'", () => {
    const officers = computeLiveOfficers(users, locations, NOW);
    const u1 = officers.find((o) => o.id === "u1")!;
    expect(u1.everReported).toBe(true);
    expect(u1.lastVisit).toBe("Last seen 2 min ago");
    expect(u1.status).toBe("Active");
  });

  it("active count always equals number of rows whose status is exactly 'Active'", () => {
    const officers = computeLiveOfficers(users, locations, NOW);
    const manualCount = officers.filter((o) => o.status === "Active").length;
    expect(countActive(officers)).toBe(manualCount);
    expect(countActive(officers)).toBe(1); // only u1 is active; u2 is stale, u3 never reported
  });
});

describe("formatLastSeen", () => {
  it("returns 'Never reported' for null/undefined timestamps", () => {
    expect(formatLastSeen(null, NOW)).toBe("Never reported");
    expect(formatLastSeen(undefined, NOW)).toBe("Never reported");
  });

  it("never fabricates a recent time for missing data", () => {
    // Guards against the historical bug where the backend defaulted
    // updated_at to "now" for officers who had never actually pinged.
    expect(formatLastSeen(null, NOW)).not.toMatch(/just now/);
  });
});

// --- Regression: "Active Officers" showed 0/N on the Overview tab ---
//
// The count itself was never wrong. activeLocations was simply never
// fetched outside the map tab, so the numerator had nothing to count.
// These lock in the two halves separately, so a future regression is
// attributable to the right cause.

describe("Active Officers count (Overview regression)", () => {
  const users = [
    { id: "u1", full_name: "A", role: "field_officer" },
    { id: "u2", full_name: "B", role: "sales_officer" },
    { id: "u3", full_name: "C", role: "field_officer" },
    { id: "u4", full_name: "Boss", role: "admin" },
  ] as any[];

  it("counts 0 active when locations have not loaded - the buggy state", () => {
    const officers = computeLiveOfficers(users, []);
    expect(officers).toHaveLength(3);      // admin excluded from the roster
    expect(countActive(officers)).toBe(0); // what Overview always showed
  });

  it("counts active officers once locations are present", () => {
    const locations = [
      { officer_id: "u1", latitude: 11.0, longitude: 78.0, status: "active", updated_at: new Date().toISOString() },
      { officer_id: "u2", latitude: 11.1, longitude: 78.1, status: "stale", updated_at: new Date().toISOString() },
      { officer_id: "u3", latitude: 11.2, longitude: 78.2, status: "active", updated_at: new Date().toISOString() },
    ] as any[];
    const officers = computeLiveOfficers(users, locations);
    expect(countActive(officers)).toBe(2); // 2 active, 1 stale
    expect(officers).toHaveLength(3);
  });

  it("excludes admins and managers from the denominator", () => {
    const withManager = [...users, { id: "u5", full_name: "Mgr", role: "manager" }] as any[];
    expect(computeLiveOfficers(withManager, [])).toHaveLength(3);
  });

  it("does not count stale or unavailable officers as active", () => {
    const locations = [
      { officer_id: "u1", latitude: 11.0, longitude: 78.0, status: "stale", updated_at: new Date().toISOString() },
      { officer_id: "u2", latitude: 11.1, longitude: 78.1, status: "low_accuracy", updated_at: new Date().toISOString() },
    ] as any[];
    expect(countActive(computeLiveOfficers(users, locations))).toBe(0);
  });
});
