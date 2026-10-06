const COLORS = ["#9f1d1d", "#1d4ed8", "#0f766e", "#7c3aed", "#b45309", "#be185d", "#0369a1", "#4d7c0f"];

export function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0] ?? "";
  const second = parts[1] ?? "";
  return ((first[0] ?? "") + (second[0] ?? "")).toUpperCase() || "?";
}

export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length] ?? "#9f1d1d";
}

export function roleLabel(role: string): string {
  switch (role) {
    case "field_officer":
      return "Field Officer";
    case "sales_officer":
      return "Sales Officer";
    case "manager":
      return "Manager";
    default:
      return role.replace(/_/g, " ");
  }
}
