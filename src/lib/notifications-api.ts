import { getBrowserSupabase } from "@/lib/supabase";
import { formatRelativeTime } from "@/lib/chat-api";

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  time: string;
  createdAt: string;
  unread: boolean;
  to: string;
  search?: Record<string, string>;
};

const CHANNEL_LABELS: Record<string, string> = {
  website: "Website",
  whatsapp: "WhatsApp",
  email: "Email",
  instagram: "Instagram",
  facebook: "Facebook",
  indiamart: "IndiaMART",
  tradeindia: "TradeIndia",
  brainmine: "Brainmine",
  api: "API",
  webhook: "Webhook",
};

function readStorageKey(userId: string) {
  return `enertech.notifications.read.${userId}`;
}

export function loadReadNotificationIds(userId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(readStorageKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function saveReadNotificationIds(userId: string, ids: Set<string>) {
  if (typeof window === "undefined") return;
  const trimmed = [...ids].slice(-200);
  localStorage.setItem(readStorageKey(userId), JSON.stringify(trimmed));
}

export function markNotificationsRead(userId: string, ids: string[]) {
  const set = loadReadNotificationIds(userId);
  for (const id of ids) set.add(id);
  saveReadNotificationIds(userId, set);
  return set;
}

export function markAllNotificationsRead(userId: string, notifications: AppNotification[]) {
  return markNotificationsRead(
    userId,
    notifications.map((n) => n.id),
  );
}

function visitorLabel(row: {
  visitor_name?: string | null;
  visitor_company?: string | null;
  external_ref?: string | null;
  preview?: string | null;
}): string {
  return (
    row.visitor_name?.trim() ||
    row.visitor_company?.trim() ||
    row.external_ref?.trim() ||
    "Visitor"
  );
}

/**
 * Builds the TopBar notification feed from live org activity
 * (escalations, human queue, unread threads, new leads, failed automations, WA templates).
 */
export async function listNotifications(
  orgId: string,
  userId: string,
): Promise<AppNotification[]> {
  const supabase = getBrowserSupabase();
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const sinceIso = since.toISOString();
  const readIds = loadReadNotificationIds(userId);

  const [
    dbNotifRes,
    escalatedRes,
    humanRes,
    unreadRes,
    leadsRes,
    autoRunsRes,
    templatesRes,
    broadcastsRes,
  ] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, title, body, href, lead_id, conversation_id, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("conversations")
      .select(
        "id, external_ref, channel, status, preview, confidence, visitor_name, visitor_company, assignee_label, last_message_at, updated_at, created_at",
      )
      .eq("org_id", orgId)
      .eq("status", "escalated")
      .order("updated_at", { ascending: false })
      .limit(12),
    supabase
      .from("conversations")
      .select(
        "id, external_ref, channel, status, preview, visitor_name, visitor_company, assignee_label, last_message_at, updated_at, created_at",
      )
      .eq("org_id", orgId)
      .eq("status", "human")
      .order("updated_at", { ascending: false })
      .limit(8),
    supabase
      .from("conversations")
      .select(
        "id, external_ref, channel, preview, unread_count, visitor_name, visitor_company, last_message_at, updated_at",
      )
      .eq("org_id", orgId)
      .gt("unread_count", 0)
      .not("status", "in", "(resolved,closed)")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(10),
    supabase
      .from("leads")
      .select("id, name, company, source, status, priority, requirement, created_at")
      .eq("org_id", orgId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("automation_runs")
      .select("id, status, error, created_at, automation:automations(name)")
      .eq("org_id", orgId)
      .eq("status", "failed")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("wa_message_templates")
      .select("id, name, status, language, rejection_reason, updated_at, created_at")
      .eq("org_id", orgId)
      .in("status", ["PENDING", "REJECTED"])
      .order("updated_at", { ascending: false })
      .limit(8),
    supabase
      .from("broadcasts")
      .select("id, name, status, updated_at, created_at")
      .eq("org_id", orgId)
      .eq("status", "Failed")
      .gte("updated_at", sinceIso)
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);

  // Soft-fail optional tables / columns (migrations not run yet)
  const items: Omit<AppNotification, "unread">[] = [];

  if (!dbNotifRes.error) {
    for (const row of dbNotifRes.data ?? []) {
      const when = row.created_at as string;
      const href = typeof row.href === "string" ? row.href : "/";
      const path = href.split("?")[0] || "/";
      const search: Record<string, string> = {};
      if (row.conversation_id && path === "/inbox") {
        search.c = row.conversation_id as string;
      } else {
        try {
          const u = new URL(href, "http://local");
          u.searchParams.forEach((v, k) => {
            search[k] = v;
          });
        } catch {
          /* ignore */
        }
      }
      items.push({
        id: `db:${row.id}`,
        title: row.title as string,
        body: (row.body as string) || "",
        time: formatRelativeTime(when),
        createdAt: when,
        to: path,
        search: Object.keys(search).length ? search : undefined,
      });
    }
  }

  if (escalatedRes.error) {
    console.warn("[notifications] escalated:", escalatedRes.error.message);
  }
  if (humanRes.error) {
    console.warn("[notifications] human:", humanRes.error.message);
  }
  if (unreadRes.error) {
    console.warn("[notifications] unread:", unreadRes.error.message);
  }
  if (leadsRes.error) {
    console.warn("[notifications] leads:", leadsRes.error.message);
  }

  for (const row of escalatedRes.data ?? []) {
    const when = (row.updated_at || row.last_message_at || row.created_at) as string;
    const conf =
      typeof row.confidence === "number" && Number.isFinite(row.confidence)
        ? ` · confidence ${row.confidence.toFixed(2)}`
        : "";
    const ch = CHANNEL_LABELS[row.channel as string] ?? String(row.channel ?? "Chat");
    items.push({
      id: `esc:${row.id}`,
      title: `Escalation · ${row.assignee_label || "AI"}`,
      body: `${visitorLabel(row)} · ${ch}${conf}`,
      time: formatRelativeTime(when),
      createdAt: when,
      to: "/inbox",
      search: { c: row.id as string },
    });
  }

  for (const row of humanRes.data ?? []) {
    const when = (row.updated_at || row.last_message_at || row.created_at) as string;
    const ch = CHANNEL_LABELS[row.channel as string] ?? String(row.channel ?? "Chat");
    items.push({
      id: `human:${row.id}`,
      title: "Human support needed",
      body: `${visitorLabel(row)} · ${ch}${row.preview ? ` — ${row.preview}` : ""}`,
      time: formatRelativeTime(when),
      createdAt: when,
      to: "/human-support",
    });
  }

  for (const row of unreadRes.data ?? []) {
    // Skip if already covered by escalation/human cards for same thread
    if ((escalatedRes.data ?? []).some((e) => e.id === row.id)) continue;
    if ((humanRes.data ?? []).some((h) => h.id === row.id)) continue;
    const when = (row.last_message_at || row.updated_at) as string;
    const ch = CHANNEL_LABELS[row.channel as string] ?? String(row.channel ?? "Chat");
    const count = Number(row.unread_count) || 1;
    items.push({
      id: `unread:${row.id}`,
      title: `${count} unread message${count === 1 ? "" : "s"}`,
      body: `${visitorLabel(row)} · ${ch}${row.preview ? ` — ${row.preview}` : ""}`,
      time: formatRelativeTime(when),
      createdAt: when,
      to: "/inbox",
      search: { c: row.id as string },
    });
  }

  for (const row of leadsRes.data ?? []) {
    const when = row.created_at as string;
    const who = [row.name, row.company].filter(Boolean).join(" · ") || "New lead";
    const req = typeof row.requirement === "string" && row.requirement.trim()
      ? row.requirement.trim()
      : null;
    items.push({
      id: `lead:${row.id}`,
      title: `New lead · ${row.source || "manual"}`,
      body: `${who}${row.priority === "High" ? " · High priority" : ""}${req ? ` — ${req}` : ""}`,
      time: formatRelativeTime(when),
      createdAt: when,
      to: "/leads",
    });
  }

  if (!autoRunsRes.error) {
    for (const row of autoRunsRes.data ?? []) {
      const when = row.created_at as string;
      const autoRaw = row.automation as unknown;
      const auto = (Array.isArray(autoRaw) ? autoRaw[0] : autoRaw) as { name?: string } | null;
      items.push({
        id: `autorun:${row.id}`,
        title: "Automation failed",
        body: `${auto?.name || "Workflow"}${row.error ? ` — ${row.error}` : ""}`,
        time: formatRelativeTime(when),
        createdAt: when,
        to: "/automation",
      });
    }
  }

  if (!templatesRes.error) {
    for (const row of templatesRes.data ?? []) {
      const when = (row.updated_at || row.created_at) as string;
      const rejected = row.status === "REJECTED";
      items.push({
        id: `tpl:${row.id}`,
        title: rejected ? "WhatsApp template rejected" : "WhatsApp template pending",
        body: `${row.name} · ${String(row.language || "en").toUpperCase()}${
          rejected && row.rejection_reason ? ` — ${row.rejection_reason}` : ""
        }`,
        time: formatRelativeTime(when),
        createdAt: when,
        to: "/broadcasting",
      });
    }
  }

  if (!broadcastsRes.error) {
    for (const row of broadcastsRes.data ?? []) {
      const when = (row.updated_at || row.created_at) as string;
      items.push({
        id: `bcast:${row.id}`,
        title: "Broadcast failed",
        body: (row.name as string) || "WhatsApp campaign",
        time: formatRelativeTime(when),
        createdAt: when,
        to: "/broadcasting",
      });
    }
  }

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return items.slice(0, 25).map((n) => ({
    ...n,
    unread: !readIds.has(n.id),
  }));
}
