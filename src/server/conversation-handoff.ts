import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { requireStaffUser } from "@/server/staff-auth";
import { processWidgetCustomerTurn } from "@/server/widget-chat";

function findPendingCustomerMessage(
  messages: { sender: string; body: string; created_at: string }[],
): { body: string } | null {
  let lastCustomerIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sender === "customer") {
      lastCustomerIdx = i;
      break;
    }
  }
  if (lastCustomerIdx < 0) return null;
  const hasReplyAfter = messages
    .slice(lastCustomerIdx + 1)
    .some((m) => m.sender === "ai" || m.sender === "agent");
  if (hasReplyAfter) return null;
  return { body: messages[lastCustomerIdx].body };
}

/** Return thread to AI and immediately answer any customer message left waiting during human mode. */
export const returnConversationToAiServer = createServerFn({ method: "POST" })
  .validator(z.object({ conversationId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { profile } = await requireStaffUser();
    const supabase = createServiceSupabase();

    const { data: row, error: readErr } = await supabase
      .from("conversations")
      .select("id, org_id, channel, metadata")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row || row.org_id !== profile.org_id) throw new Error("Conversation not found");

    const meta = { ...(((row.metadata || {}) as Record<string, unknown>) || {}) };
    delete meta.handoff;
    delete meta.ai_paused_from;
    meta.returned_to_ai_at = new Date().toISOString();

    const { error: updErr } = await supabase
      .from("conversations")
      .update({
        status: "ai",
        assignee_id: null,
        assignee_label: "AI · Support Agent",
        metadata: meta,
      })
      .eq("id", data.conversationId);
    if (updErr) throw new Error(updErr.message);

    const channel = String(row.channel || "");
    if (channel !== "website") {
      return { resumed: false as const, channel };
    }

    const { data: messages, error: msgErr } = await supabase
      .from("messages")
      .select("sender, body, created_at")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true });
    if (msgErr) throw new Error(msgErr.message);

    const pending = findPendingCustomerMessage(messages ?? []);
    if (!pending?.body?.trim()) {
      return { resumed: false as const, channel };
    }

    await processWidgetCustomerTurn(
      supabase,
      { conversationId: data.conversationId, body: pending.body },
      { insertCustomerMessage: false },
    );
    return { resumed: true as const, channel };
  });
