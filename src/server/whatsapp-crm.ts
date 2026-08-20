import type { createServiceSupabase } from "@/lib/supabase";

type Sb = ReturnType<typeof createServiceSupabase>;

/** Create/link Customer + Lead for WhatsApp phone (mirrors website chat CRM). */
export async function ensureWhatsAppLeadCustomer(
  supabase: Sb,
  convo: {
    id: string;
    customer_id?: string | null;
    lead_id?: string | null;
    visitor_name?: string | null;
    visitor_phone?: string | null;
    tags?: string[] | null;
  },
  phone: string,
  profileName: string | null | undefined,
  orgId: string,
) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return;

  let customerId = convo.customer_id || null;
  let leadId = convo.lead_id || null;
  const name = (profileName || convo.visitor_name || `WhatsApp ${digits.slice(-4)}`).trim();

  if (!customerId) {
    const { data: byPhone } = await supabase
      .from("customers")
      .select("id, name, phone")
      .eq("org_id", orgId)
      .eq("phone", digits)
      .maybeSingle();
    if (byPhone?.id) {
      customerId = byPhone.id as string;
    } else {
      const { data: created } = await supabase
        .from("customers")
        .insert({
          org_id: orgId,
          name,
          phone: digits,
          metadata: { source: "whatsapp" },
        })
        .select("id")
        .single();
      customerId = (created?.id as string) || null;
    }
  }

  if (!leadId) {
    const { data: openLead } = await supabase
      .from("leads")
      .select("id")
      .eq("org_id", orgId)
      .eq("phone", digits)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (openLead?.id) {
      leadId = openLead.id as string;
    } else {
      const { data: createdLead } = await supabase
        .from("leads")
        .insert({
          org_id: orgId,
          name,
          phone: digits,
          source: "WhatsApp",
          status: "New",
          priority: "Medium",
          score: 60,
          product_label: "WhatsApp enquiry",
          customer_id: customerId,
          metadata: { channel: "whatsapp" },
        })
        .select("id")
        .single();
      leadId = (createdLead?.id as string) || null;
    }
  }

  const tags = Array.isArray(convo.tags) ? [...convo.tags] : [];
  if (!tags.includes("WhatsApp")) tags.push("WhatsApp");

  await supabase
    .from("conversations")
    .update({
      customer_id: customerId,
      lead_id: leadId,
      visitor_name: name,
      visitor_phone: digits,
      tags,
    })
    .eq("id", convo.id);
}
