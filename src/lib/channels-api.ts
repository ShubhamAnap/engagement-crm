import { getBrowserSupabase } from "@/lib/supabase";
import type { ChannelStatus, ChannelType, DbChannel } from "@/lib/db-types";

export type ChannelWithStats = DbChannel & {
  conversationCount: number;
  openCount: number;
};

/** Non-secret channel columns (migration 030 hides `config` from PostgREST for Agents). */
const CHANNEL_SAFE_COLUMNS =
  "id, org_id, type, name, status, health, detail, is_enabled, created_at, updated_at";

function asChannel(row: Record<string, unknown>, config: Record<string, unknown> = {}): DbChannel {
  return {
    ...(row as Omit<DbChannel, "config">),
    config,
  };
}

/** Admin/Manager only — loads plaintext channel credentials via SECURITY DEFINER RPC. */
export async function getChannelConfig(channelId: string): Promise<Record<string, unknown>> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.rpc("get_channel_config", {
    p_channel_id: channelId,
  });
  if (error) throw error;
  return (data && typeof data === "object" && !Array.isArray(data)
    ? data
    : {}) as Record<string, unknown>;
}

export async function listChannels(orgId: string): Promise<DbChannel[]> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("channels")
    .select(CHANNEL_SAFE_COLUMNS)
    .eq("org_id", orgId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => asChannel(row as Record<string, unknown>));
}

export async function listChannelsWithStats(orgId: string): Promise<ChannelWithStats[]> {
  const supabase = getBrowserSupabase();
  const [channelsRes, convRes] = await Promise.all([
    supabase
      .from("channels")
      .select(CHANNEL_SAFE_COLUMNS)
      .eq("org_id", orgId)
      .order("name", { ascending: true }),
    supabase
      .from("conversations")
      .select("id, channel, status")
      .eq("org_id", orgId)
      .limit(1000),
  ]);
  if (channelsRes.error) throw channelsRes.error;
  if (convRes.error) throw convRes.error;

  const channels = (channelsRes.data ?? []).map((row) =>
    asChannel(row as Record<string, unknown>),
  );
  const conversations = convRes.data ?? [];

  return channels.map((ch) => {
    const related = conversations.filter((c) => c.channel === ch.type);
    const openCount = related.filter(
      (c) => c.status === "ai" || c.status === "human" || c.status === "escalated",
    ).length;
    return {
      ...ch,
      conversationCount: related.length,
      openCount,
    };
  });
}

export async function setChannelEnabled(options: {
  channelId: string;
  enabled: boolean;
  type: ChannelType;
}): Promise<DbChannel> {
  const supabase = getBrowserSupabase();
  const { channelId, enabled, type } = options;

  // Website + configured WhatsApp map enable → Connected.
  // Other channels can be marked enabled as intent, but stay Action Required until APIs are wired.
  let status: ChannelStatus;
  let health: number;
  if (
    type === "website" ||
    type === "whatsapp" ||
    type === "email" ||
    type === "facebook" ||
    type === "instagram" ||
    type === "indiamart" ||
    type === "tradeindia"
  ) {
    status = enabled ? "Connected" : "Disconnected";
    health = enabled ? 100 : 0;
  } else if (enabled) {
    status = "Action Required";
    health = 40;
  } else {
    status = "Disconnected";
    health = 0;
  }

  const { data, error } = await supabase
    .from("channels")
    .update({
      is_enabled: enabled,
      status,
      health,
      detail:
        type === "website"
          ? enabled
            ? "embed widget"
            : "disabled"
          : type === "whatsapp"
            ? enabled
              ? "Meta Cloud API"
              : "disabled"
            : type === "email"
              ? enabled
                ? "SMTP + inbound webhook"
                : "disabled"
              : type === "facebook"
                ? enabled
                  ? "Facebook Messenger"
                  : "disabled"
                : type === "instagram"
                  ? enabled
                    ? "Instagram Messaging"
                    : "disabled"
                  : type === "indiamart"
                    ? enabled
                      ? "Lead Manager API"
                      : "disabled"
                    : type === "tradeindia"
                      ? enabled
                        ? "Inquiry API"
                        : "disabled"
                      : type === "brainmine"
                        ? enabled
                          ? "CRM+ lead sync (read-only)"
                          : "disabled"
                        : enabled
                          ? "Enabled — connect credentials to go live"
                          : null,
    })
    .eq("id", channelId)
    .select(CHANNEL_SAFE_COLUMNS)
    .single();

  if (error) throw error;
  return asChannel(data as Record<string, unknown>);
}

export async function updateChannel(options: {
  channelId: string;
  name?: string;
  detail?: string | null;
  status?: ChannelStatus;
  health?: number;
  is_enabled?: boolean;
  config?: Record<string, unknown>;
}): Promise<DbChannel> {
  const supabase = getBrowserSupabase();
  const patch: Record<string, unknown> = {};
  if (options.name !== undefined) patch.name = options.name.trim();
  if (options.detail !== undefined) patch.detail = options.detail?.trim() || null;
  if (options.status !== undefined) patch.status = options.status;
  if (options.health !== undefined) patch.health = Math.max(0, Math.min(100, options.health));
  if (options.is_enabled !== undefined) patch.is_enabled = options.is_enabled;

  let config: Record<string, unknown> = {};
  if (options.config !== undefined) {
    const { data: cfg, error: cfgErr } = await supabase.rpc("set_channel_config", {
      p_channel_id: options.channelId,
      p_config: options.config,
    });
    if (cfgErr) throw cfgErr;
    config = (cfg && typeof cfg === "object" && !Array.isArray(cfg)
      ? cfg
      : options.config) as Record<string, unknown>;
  }

  if (Object.keys(patch).length === 0) {
    const { data: row, error } = await supabase
      .from("channels")
      .select(CHANNEL_SAFE_COLUMNS)
      .eq("id", options.channelId)
      .single();
    if (error) throw error;
    return asChannel(row as Record<string, unknown>, config);
  }

  const { data, error } = await supabase
    .from("channels")
    .update(patch)
    .eq("id", options.channelId)
    .select(CHANNEL_SAFE_COLUMNS)
    .single();
  if (error) throw error;
  return asChannel(data as Record<string, unknown>, config);
}

/** Merge allowed_origins into the Website channel config. */
export async function updateWebsiteAllowedOrigins(options: {
  channelId: string;
  allowedOrigins: string[];
}): Promise<DbChannel> {
  const supabase = getBrowserSupabase();
  const { data: current, error: curErr } = await supabase
    .from("channels")
    .select("type")
    .eq("id", options.channelId)
    .maybeSingle();
  if (curErr) throw curErr;
  if (!current || current.type !== "website") {
    throw new Error("Website channel not found");
  }

  const prev = await getChannelConfig(options.channelId);
  prev.allowed_origins = options.allowedOrigins;

  const detail =
    options.allowedOrigins.length > 0
      ? `Allowed: ${options.allowedOrigins.join(", ")}`
      : "No origins set — widget blocked off-app";

  return updateChannel({
    channelId: options.channelId,
    config: prev,
    detail,
  });
}

export function channelStatusTone(
  status: ChannelStatus,
): "success" | "warning" | "danger" | "neutral" | "info" {
  if (status === "Connected") return "success";
  if (status === "Degraded") return "warning";
  if (status === "Action Required") return "warning";
  if (status === "Disconnected") return "danger";
  return "neutral";
}

export function isLiveChannel(type: ChannelType): boolean {
  return (
    type === "website" ||
    type === "whatsapp" ||
    type === "email" ||
    type === "facebook" ||
    type === "instagram" ||
    type === "indiamart" ||
    type === "tradeindia" ||
    type === "brainmine"
  );
}
