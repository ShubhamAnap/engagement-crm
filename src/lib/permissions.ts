/**
 * App section privileges (tick-marks in Settings → Team).
 * Keys match sidebar routes. Admins always get every section.
 */

export const APP_SECTION_KEYS = [
  "dashboard",
  "command-center",
  "inbox",
  "ai-chat",
  "human-support",
  "agents",
  "tools",
  "formulas",
  "knowledge",
  "automation",
  "broadcasting",
  "products",
  "customers",
  "leads",
  "pipeline",
  "analytics",
  "reports",
  "channels",
  "settings",
] as const;

export type AppSectionKey = (typeof APP_SECTION_KEYS)[number];

export const DEFAULT_NEW_USER_PERMISSIONS: AppSectionKey[] = ["dashboard", "inbox"];

export type AppSectionGroup = {
  label: string;
  sections: Array<{ key: AppSectionKey; label: string; path: string }>;
};

export const APP_SECTION_GROUPS: AppSectionGroup[] = [
  {
    label: "Operate",
    sections: [
      { key: "dashboard", label: "Dashboard", path: "/" },
      { key: "command-center", label: "AI Command Center", path: "/command-center" },
      { key: "inbox", label: "Inbox", path: "/inbox" },
      { key: "ai-chat", label: "AI Chat Support", path: "/ai-chat" },
      { key: "human-support", label: "Human Support", path: "/human-support" },
    ],
  },
  {
    label: "Intelligence",
    sections: [
      { key: "agents", label: "AI Agents", path: "/agents" },
      { key: "tools", label: "Tools", path: "/tools" },
      { key: "formulas", label: "Formulas", path: "/formulas" },
      { key: "knowledge", label: "Knowledge Base", path: "/knowledge" },
      { key: "automation", label: "Automation", path: "/automation" },
      { key: "broadcasting", label: "Broadcasting", path: "/broadcasting" },
    ],
  },
  {
    label: "Commerce",
    sections: [
      { key: "products", label: "Products", path: "/products" },
      { key: "customers", label: "Customers", path: "/customers" },
      { key: "leads", label: "Leads", path: "/leads" },
      { key: "pipeline", label: "Pipeline", path: "/pipeline" },
    ],
  },
  {
    label: "Insight",
    sections: [
      { key: "analytics", label: "Analytics", path: "/analytics" },
      { key: "reports", label: "Reports", path: "/reports" },
      { key: "channels", label: "Channels", path: "/channels" },
      { key: "settings", label: "Settings", path: "/settings" },
    ],
  },
];

const PATH_TO_SECTION: Array<{ prefix: string; key: AppSectionKey }> = [
  { prefix: "/command-center", key: "command-center" },
  { prefix: "/inbox", key: "inbox" },
  { prefix: "/ai-chat", key: "ai-chat" },
  { prefix: "/human-support", key: "human-support" },
  { prefix: "/agents", key: "agents" },
  { prefix: "/tools", key: "tools" },
  { prefix: "/formulas", key: "formulas" },
  { prefix: "/knowledge", key: "knowledge" },
  { prefix: "/automation", key: "automation" },
  { prefix: "/broadcasting", key: "broadcasting" },
  { prefix: "/products", key: "products" },
  { prefix: "/customers", key: "customers" },
  { prefix: "/leads", key: "leads" },
  { prefix: "/pipeline", key: "pipeline" },
  { prefix: "/analytics", key: "analytics" },
  { prefix: "/reports", key: "reports" },
  { prefix: "/channels", key: "channels" },
  { prefix: "/settings", key: "settings" },
  { prefix: "/", key: "dashboard" },
];

export function normalizePermissions(raw: unknown): AppSectionKey[] {
  const allowed = new Set<string>(APP_SECTION_KEYS);
  const list = Array.isArray(raw) ? raw : [];
  const out: AppSectionKey[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const key = String(item || "").trim();
    if (!allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key as AppSectionKey);
  }
  return out;
}

export function allSectionKeys(): AppSectionKey[] {
  return [...APP_SECTION_KEYS];
}

/** Admins always have every section. */
export function effectivePermissions(options: {
  role: string | null | undefined;
  permissions?: unknown;
}): AppSectionKey[] {
  if (options.role === "Admin") return allSectionKeys();
  const normalized = normalizePermissions(options.permissions);
  return normalized.length ? normalized : [...DEFAULT_NEW_USER_PERMISSIONS];
}

export function hasSectionAccess(
  role: string | null | undefined,
  permissions: unknown,
  section: AppSectionKey,
): boolean {
  return effectivePermissions({ role, permissions }).includes(section);
}

export function sectionKeyForPath(pathname: string): AppSectionKey | null {
  const path = pathname.split("?")[0] || "/";
  if (path === "/" || path === "") return "dashboard";
  for (const row of PATH_TO_SECTION) {
    if (row.prefix === "/") continue;
    if (path === row.prefix || path.startsWith(`${row.prefix}/`)) return row.key;
  }
  return null;
}

export function canAccessPath(
  role: string | null | undefined,
  permissions: unknown,
  pathname: string,
): boolean {
  if (role === "Admin") return true;
  const key = sectionKeyForPath(pathname);
  if (!key) return true; // unknown internal routes stay open for staff
  return hasSectionAccess(role, permissions, key);
}

export function permissionSummary(permissions: AppSectionKey[]): string {
  if (permissions.length >= APP_SECTION_KEYS.length) return "Full access";
  if (permissions.length === 0) return "No sections";
  const labels = new Map<string, string>();
  for (const g of APP_SECTION_GROUPS) {
    for (const s of g.sections) labels.set(s.key, s.label);
  }
  return permissions
    .slice(0, 4)
    .map((k) => labels.get(k) || k)
    .join(", ")
    .concat(permissions.length > 4 ? ` +${permissions.length - 4}` : "");
}
