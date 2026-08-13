/**
 * App section + action privileges (tick-marks in Settings → Team).
 * Section keys match sidebar routes. Action keys gate buttons (e.g. Leads Add/Delete).
 * Admins always get every section and action.
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

/** Button-level actions (not sidebar routes). */
export const APP_ACTION_KEYS = ["leads_create", "leads_delete"] as const;

export type AppActionKey = (typeof APP_ACTION_KEYS)[number];

export type PermissionKey = AppSectionKey | AppActionKey;

export const DEFAULT_NEW_USER_PERMISSIONS: PermissionKey[] = ["dashboard", "inbox"];

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
    label: "Commerce",
    sections: [
      { key: "products", label: "Products", path: "/products" },
      { key: "customers", label: "Customers", path: "/customers" },
      { key: "leads", label: "Leads", path: "/leads" },
      { key: "pipeline", label: "Pipeline", path: "/pipeline" },
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

const ALL_PERMISSION_KEYS: PermissionKey[] = [...APP_SECTION_KEYS, ...APP_ACTION_KEYS];

export function normalizePermissions(raw: unknown): PermissionKey[] {
  const allowed = new Set<string>(ALL_PERMISSION_KEYS);
  const list = Array.isArray(raw) ? raw : [];
  const out: PermissionKey[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const key = String(item || "").trim();
    if (!allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key as PermissionKey);
  }
  // Drop lead actions if section access was removed
  if (!out.includes("leads")) {
    return out.filter((k) => k !== "leads_create" && k !== "leads_delete");
  }
  return out;
}

export function allSectionKeys(): AppSectionKey[] {
  return [...APP_SECTION_KEYS];
}

export function allPermissionKeys(): PermissionKey[] {
  return [...ALL_PERMISSION_KEYS];
}

/** Admins always have every section + action. */
export function effectivePermissions(options: {
  role: string | null | undefined;
  permissions?: unknown;
}): PermissionKey[] {
  if (options.role === "Admin") return allPermissionKeys();
  const normalized = normalizePermissions(options.permissions);
  return normalized.length ? normalized : [...DEFAULT_NEW_USER_PERMISSIONS];
}

export function hasPermission(
  role: string | null | undefined,
  permissions: unknown,
  key: PermissionKey,
): boolean {
  return effectivePermissions({ role, permissions }).includes(key);
}

export function hasSectionAccess(
  role: string | null | undefined,
  permissions: unknown,
  section: AppSectionKey,
): boolean {
  return hasPermission(role, permissions, section);
}

export function canLeadsCreate(
  role: string | null | undefined,
  permissions: unknown,
): boolean {
  if (role === "Admin") return true;
  const keys = effectivePermissions({ role, permissions });
  return keys.includes("leads") && keys.includes("leads_create");
}

export function canLeadsDelete(
  role: string | null | undefined,
  permissions: unknown,
): boolean {
  if (role === "Admin") return true;
  const keys = effectivePermissions({ role, permissions });
  return keys.includes("leads") && keys.includes("leads_delete");
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

export function permissionSummary(permissions: PermissionKey[]): string {
  const sections = permissions.filter((k): k is AppSectionKey =>
    (APP_SECTION_KEYS as readonly string[]).includes(k),
  );
  if (sections.length >= APP_SECTION_KEYS.length) return "Full access";
  if (sections.length === 0) return "No sections";
  const labels = new Map<string, string>();
  for (const g of APP_SECTION_GROUPS) {
    for (const s of g.sections) labels.set(s.key, s.label);
  }
  let text = sections
    .slice(0, 4)
    .map((k) => labels.get(k) || k)
    .join(", ")
    .concat(sections.length > 4 ? ` +${sections.length - 4}` : "");
  const extras: string[] = [];
  if (permissions.includes("leads_create")) extras.push("Add/Edit leads");
  if (permissions.includes("leads_delete")) extras.push("Delete leads");
  if (extras.length) text += ` · ${extras.join(", ")}`;
  return text;
}
