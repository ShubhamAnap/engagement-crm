/**
 * Append-only audit trail (Phase 5).
 */
import { createServiceSupabase } from "@/lib/supabase";

export type AuditAction =
  | "org.disable"
  | "org.export"
  | "org.delete"
  | "account.delete"
  | "team.invite"
  | "team.invite_revoke"
  | "team.update"
  | "team.create"
  | "billing.openai_key_save"
  | "billing.openai_key_remove"
  | "billing.checkout"
  | "platform.suspend"
  | "platform.reactivate"
  | "platform.plan_override"
  | "platform.refund"
  | "platform.notes"
  | "platform.member_update"
  | "platform.admin_add"
  | "platform.admin_remove"
  | "platform.support_access";

export type AuditInput = {
  orgId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  action: AuditAction | string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
};

/** Best-effort — never throw to callers. */
export async function recordAuditEvent(input: AuditInput): Promise<void> {
  try {
    const supabase = createServiceSupabase();
    const { error } = await supabase.from("audit_events").insert({
      org_id: input.orgId || null,
      actor_id: input.actorId || null,
      actor_email: input.actorEmail?.trim() || null,
      action: input.action,
      resource_type: input.resourceType || null,
      resource_id: input.resourceId || null,
      metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
    });
    if (error) console.error("audit log failed", error.message);
  } catch (err) {
    console.error("audit log failed", err);
  }
}
