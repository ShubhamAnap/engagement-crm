import { getBrowserSupabase } from "@/lib/supabase";
import type { ChannelStatus, ChannelType, DbChannel } from "@/lib/db-types";

export type ChannelWithStats = DbChannel & {
  conversationCount: number;
  openCount: number;
};

export async function listChannels(orgId: string): Promise<DbChannel[]> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("channels")
    .select("*")
    .eq("org_id", orgId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DbChannel[];
}

export async function listChannelsWithStats(orgId: string): Promise<ChannelWithStats[]> {
  const supabase = getBrowserSupabase();
  const [channelsRes, convRes] = await Promise.all([
    supabase.from("channels").select("*").eq("org_id", orgId).order("name", { ascending: true }),
    supabase
      .from("conversations")
      .select("id, channel, status")
      .eq("org_id", orgId)
      .limit(1000),
  ]);
  if (channelsRes.error) throw channelsRes.error;
  if (convRes.error) throw convRes.error;

  const channels = (channelsRes.data ?? []) as DbChannel[];
  const conversations = convRes.data ?? [];

  return channels.map((ch) => {
    const related = conversations.filter((c) => c.channel === ch.type);
    const openCount = related.filter((c) => c.status === "ai" || c.status === "human" || c.status === "escalated").length;
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
    type === "indiamart"
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
                    : enabled
                      ? "Enabled — connect credentials to go live"
                      : null,
    })
    .eq("id", channelId)
    .select("*")
    .single();

  if (error) throw error;
  return data as DbChannel;
}

export async function updateChannel(options: {
  channelId: string;
  name?: string;
  detail?: string | null;
  status?: ChannelStatus;
  health?: number;
  is_enabled?: boolean;
}): Promise<DbChannel> {
  const supabase = getBrowserSupabase();
  const patch: Record<string, unknown> = {};
  if (options.name !== undefined) patch.name = options.name.trim();
  if (options.detail !== undefined) patch.detail = options.detail?.trim() || null;
  if (options.status !== undefined) patch.status = options.status;
  if (options.health !== undefined) patch.health = Math.max(0, Math.min(100, options.health));
  if (options.is_enabled !== undefined) patch.is_enabled = options.is_enabled;

  const { data, error } = await supabase
    .from("channels")
    .update(patch)
    .eq("id", options.channelId)
    .select("*")
    .single();
  if (error) throw error;
  return data as DbChannel;
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
    type === "indiamart"
  );
}
