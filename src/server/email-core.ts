/**
 * Server-only email/SMTP core. Do not import from client routes —
 * use createServerFn wrappers in `email.ts` instead.
 */
import nodemailer from "nodemailer";
import { createServiceSupabase } from "@/lib/supabase";
import { generateOpenAiReply } from "@/server/openai";
import { agentReplyConfig, resolveAgentStack } from "@/server/agents";
import { resolveAgentToolKeys } from "@/server/ai-tools";
import { buildAnswerInspector } from "@/server/answer-inspector";
import { findCatalogueDownloads, retrieveKnowledgeContext } from "@/server/knowledge";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";

export type EmailChannelConfig = {
  from_email?: string;
  from_name?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_user?: string;
  smtp_pass?: string;
  inbound_secret?: string;
};

function envConfig(): EmailChannelConfig {
  const port = Number(process.env.EMAIL_SMTP_PORT || "587");
  return {
    from_email: process.env.EMAIL_FROM || undefined,
    from_name: process.env.EMAIL_FROM_NAME || "EnerTech Engage",
    smtp_host: process.env.EMAIL_SMTP_HOST || undefined,
    smtp_port: Number.isFinite(port) ? port : 587,
    smtp_secure: process.env.EMAIL_SMTP_SECURE === "true" || port === 465,
    smtp_user: process.env.EMAIL_SMTP_USER || undefined,
    smtp_pass: process.env.EMAIL_SMTP_PASS || undefined,
    inbound_secret: process.env.EMAIL_INBOUND_SECRET || undefined,
  };
}

export async function loadEmailConfig(): Promise<EmailChannelConfig> {
  const fromEnv = envConfig();
  try {
    const supabase = createServiceSupabase();
    const { data } = await supabase
      .from("channels")
      .select("config, detail")
      .eq("org_id", ORG_ID)
      .eq("type", "email")
      .maybeSingle();
    const cfg = ((data?.config as EmailChannelConfig) || {}) as EmailChannelConfig;
    return {
      from_email: cfg.from_email || fromEnv.from_email,
      from_name: cfg.from_name || fromEnv.from_name,
      smtp_host: cfg.smtp_host || fromEnv.smtp_host,
      smtp_port: cfg.smtp_port || fromEnv.smtp_port,
      smtp_secure: cfg.smtp_secure ?? fromEnv.smtp_secure,
      smtp_user: cfg.smtp_user || fromEnv.smtp_user,
      smtp_pass: cfg.smtp_pass || fromEnv.smtp_pass,
      inbound_secret: cfg.inbound_secret || fromEnv.inbound_secret,
    };
  } catch {
    return fromEnv;
  }
}

export function emailConfigReady(cfg: EmailChannelConfig): boolean {
  return Boolean(cfg.from_email && cfg.smtp_host && cfg.smtp_user && cfg.smtp_pass);
}

export async function sendEmailMessage(options: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string | null;
  references?: string | null;
  cfg?: EmailChannelConfig;
}) {
  // Prefer connected Gmail OAuth (n8n-style) when available
  try {
    const { loadGmailConnection, sendGmailMessage } = await import("@/server/gmail");
    const gmail = await loadGmailConnection();
    if (gmail?.email) {
      return sendGmailMessage({
        to: options.to,
        subject: options.subject,
        body: options.html || options.text,
        format: options.html ? "html" : "text",
      });
    }
  } catch (err) {
    // Fall through to SMTP if Gmail not connected / misconfigured
    console.warn("Gmail send unavailable, trying SMTP", err);
  }

  const config = options.cfg || (await loadEmailConfig());
  if (!emailConfigReady(config)) {
    throw new Error(
      "Email is not configured. Connect Gmail under Channels (OAuth) or save SMTP credentials.",
    );
  }

  const transporter = nodemailer.createTransport({
    host: config.smtp_host,
    port: config.smtp_port || 587,
    secure: Boolean(config.smtp_secure),
    auth: {
      user: config.smtp_user,
      pass: config.smtp_pass,
    },
  });

  return transporter.sendMail({
    from: config.from_name
      ? `"${config.from_name}" <${config.from_email}>`
      : config.from_email,
    to: options.to,
    subject: options.subject,
    text: options.text,
    ...(options.html ? { html: options.html } : {}),
    headers: {
      ...(options.inReplyTo ? { "In-Reply-To": options.inReplyTo } : {}),
      ...(options.references ? { References: options.references } : {}),
    },
  });
}

export async function verifySmtp(config: EmailChannelConfig): Promise<{ ok: boolean; error: string | null }> {
  try {
    const transporter = nodemailer.createTransport({
      host: config.smtp_host,
      port: config.smtp_port || 587,
      secure: Boolean(config.smtp_secure),
      auth: { user: config.smtp_user, pass: config.smtp_pass },
    });
    await transporter.verify();
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "SMTP verify failed" };
  }
}

async function getEmailChannelId(supabase: ReturnType<typeof createServiceSupabase>) {
  const { data } = await supabase
    .from("channels")
    .select("id")
    .eq("org_id", ORG_ID)
    .eq("type", "email")
    .maybeSingle();
  return data?.id as string | undefined;
}

function normalizeEmail(addr: string): string {
  const match = addr.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return (match?.[0] || addr).trim().toLowerCase();
}

function extractName(addr: string): string | null {
  const m = addr.match(/^"?([^"<]+)"?\s*</);
  const name = m?.[1]?.trim();
  return name || null;
}

async function findOrCreateEmailConversation(
  supabase: ReturnType<typeof createServiceSupabase>,
  fromEmail: string,
  fromName: string | null,
  subject: string,
) {
  const email = normalizeEmail(fromEmail);
  const sessionKey = `email:${email}`;

  const { data: existing } = await supabase
    .from("conversations")
    .select("*")
    .eq("org_id", ORG_ID)
    .eq("channel", "email")
    .eq("widget_session_id", sessionKey)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const patch: Record<string, unknown> = {
      subject: subject || existing.subject,
    };
    if (fromName && !existing.visitor_name) patch.visitor_name = fromName;
    if (!existing.visitor_email) patch.visitor_email = email;
    await supabase.from("conversations").update(patch).eq("id", existing.id);
    return existing;
  }

  const channelId = await getEmailChannelId(supabase);
  const externalRef = `EM-${Date.now().toString().slice(-6)}`;

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({
      org_id: ORG_ID,
      channel_id: channelId || null,
      channel: "email",
      external_ref: externalRef,
      subject: subject || "(no subject)",
      status: "ai",
      assignee_label: "AI · Support Agent",
      visitor_name: fromName || email.split("@")[0],
      visitor_email: email,
      widget_session_id: sessionKey,
      tags: ["Email"],
      unread_count: 0,
      metadata: { email_from: email },
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return created;
}

export type InboundEmailPayload = {
  from: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
};

export async function handleInboundEmail(payload: InboundEmailPayload) {
  const supabase = createServiceSupabase();
  const from = payload.from?.trim();
  const text = (payload.text || payload.html?.replace(/<[^>]+>/g, " ") || "").trim();
  if (!from || !text) {
    throw new Error("Inbound email requires from and text/html body");
  }

  const fromEmail = normalizeEmail(from);
  const fromName = extractName(from);
  const subject = (payload.subject || "").trim() || "(no subject)";

  if (payload.messageId) {
    const { data: dup } = await supabase
      .from("messages")
      .select("id")
      .eq("org_id", ORG_ID)
      .filter("metadata->>email_message_id", "eq", payload.messageId)
      .limit(1)
      .maybeSingle();
    if (dup) return { skipped: true as const, reason: "duplicate" };
  }

  const convo = await findOrCreateEmailConversation(supabase, fromEmail, fromName, subject);

  const { data: customerMsg, error: msgError } = await supabase
    .from("messages")
    .insert({
      org_id: ORG_ID,
      conversation_id: convo.id,
      sender: "customer",
      body: text.slice(0, 8000),
      metadata: {
        email_message_id: payload.messageId || null,
        email_from: fromEmail,
        email_subject: subject,
      },
    })
    .select("*")
    .single();
  if (msgError) throw new Error(msgError.message);

  const status = convo.status as string;
  const escalate = /human|agent|support executive/i.test(text);
    if (escalate) {
      await supabase
        .from("conversations")
        .update({ status: "escalated", assignee_label: "Human queue" })
        .eq("id", convo.id);
      try {
        const { fireAutomations } = await import("@/server/automation-engine");
        fireAutomations("conversation_escalated", {
          conversationId: convo.id as string,
          leadId: undefined,
        });
      } catch (err) {
        console.error("escalation automation", err);
      }
      return { conversationId: convo.id, messageId: customerMsg.id, escalated: true };
    }

  if (status === "human" || status === "escalated" || status === "resolved" || status === "closed") {
    return { conversationId: convo.id, messageId: customerMsg.id, aiPaused: true };
  }

  let reply = "Thanks for emailing EnerTech. How can we help with your UPS needs?";
  let inspector = buildAnswerInspector({
    chunks: [],
    replySource: "fallback",
    model: "gpt-4o-mini",
    agentName: "EnerBot",
    channel: "email",
  });
  try {
    const { data: history } = await supabase
      .from("messages")
      .select("sender, body, created_at")
      .eq("conversation_id", convo.id)
      .order("created_at", { ascending: true })
      .limit(20);
    const [chunks, downloads] = await Promise.all([
      retrieveKnowledgeContext(text, 6),
      findCatalogueDownloads(text),
    ]);
    const stack = await resolveAgentStack({
      channel: "email",
      message: text,
    });
    const agentCfg = agentReplyConfig(stack);
    const { sanitizeAssistantFileLinks, shortenDownloadLinks } = await import("@/server/shorten-urls");
    const downloadLinks = await shortenDownloadLinks(downloads);
    const generated = await generateOpenAiReply({
      visitorName: (convo.visitor_name as string) || fromName || fromEmail,
      latestUserMessage: text,
      history: (history || []).map((m) => ({
        sender: m.sender as string,
        body: m.body as string,
        created_at: m.created_at as string,
      })),
      knowledgeContext: chunks
        .map((c) => c.content)
        .join("\n\n")
        .replace(/https?:\/\/[^\s)\]>"']+\/storage\/v1\/object\/public\/knowledge\/[^\s)\]>"']+/gi, "[file]"),
      downloadLinks,
      systemPrompt: agentCfg.systemPrompt,
      model: agentCfg.model,
      agentName: agentCfg.agentName,
      memoryEnabled: agentCfg.memoryEnabled,
      toolKeys: await resolveAgentToolKeys({ allowedOnAgent: agentCfg.allowedTools }),
    });
    reply = await sanitizeAssistantFileLinks(generated.reply, downloadLinks, { channel: "website" });
    inspector = buildAnswerInspector({
      chunks,
      replySource: generated.source,
      model: generated.model,
      agentName: agentCfg.agentName,
      specialistKey: agentCfg.specialistKey,
      channel: "email",
      visitorName: (convo.visitor_name as string) || fromName || fromEmail,
      downloadCount: downloadLinks.length,
      memoryEnabled: agentCfg.memoryEnabled,
    });
    if (agentCfg.agentId) {
      const prevMeta =
        convo.metadata && typeof convo.metadata === "object"
          ? (convo.metadata as Record<string, unknown>)
          : {};
      await supabase
        .from("conversations")
        .update({
          agent_id: agentCfg.agentId,
          assignee_label: agentCfg.assigneeLabel,
          metadata: {
            ...prevMeta,
            specialist_key: agentCfg.specialistKey,
            specialist_id: agentCfg.specialistId,
          },
        })
        .eq("id", convo.id);
    }
  } catch (err) {
    console.error("Email AI reply failed", err);
  }

  await supabase.from("messages").insert({
    org_id: ORG_ID,
    conversation_id: convo.id,
    sender: "ai",
    body: reply,
    confidence: inspector.confidence,
    sources: inspector.sources,
    metadata: inspector.metadata,
  });

  try {
    const cfg = await loadEmailConfig();
    await sendEmailMessage({
      to: fromEmail,
      subject: subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`,
      text: reply,
      inReplyTo: payload.messageId || null,
      cfg,
    });
  } catch (err) {
    console.error("Email outbound AI send failed", err);
  }

  return { conversationId: convo.id, messageId: customerMsg.id, replied: true };
}

export async function persistEmailChannelConfig(data: {
  fromEmail: string;
  fromName?: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure?: boolean;
  smtpUser: string;
  smtpPass: string;
  inboundSecret?: string;
  enable?: boolean;
}) {
  const supabase = createServiceSupabase();
  const config: EmailChannelConfig = {
    from_email: data.fromEmail.trim().toLowerCase(),
    from_name: data.fromName?.trim() || "EnerTech Engage",
    smtp_host: data.smtpHost.trim(),
    smtp_port: data.smtpPort,
    smtp_secure: data.smtpSecure ?? data.smtpPort === 465,
    smtp_user: data.smtpUser.trim(),
    smtp_pass: data.smtpPass.trim(),
    inbound_secret: data.inboundSecret?.trim() || undefined,
  };

  const enable = data.enable ?? true;
  const { data: updated, error } = await supabase
    .from("channels")
    .update({
      config,
      detail: config.from_email,
      is_enabled: enable,
      status: enable ? "Connected" : "Disconnected",
      health: enable ? 100 : 0,
    })
    .eq("org_id", ORG_ID)
    .eq("type", "email")
    .select("id, type, name, status, is_enabled, detail, health, updated_at")
    .single();

  if (error) throw new Error(error.message);

  const verify = await verifySmtp(config);
  return {
    ok: true,
    channel: updated,
    smtpOk: verify.ok,
    smtpError: verify.error,
    webhookPath: "/api/webhooks/email",
  };
}

export async function sendAgentEmailReply(conversationId: string, body: string) {
  const supabase = createServiceSupabase();
  const { data: convo, error } = await supabase
    .from("conversations")
    .select("id, channel, visitor_email, subject, metadata, widget_session_id")
    .eq("id", conversationId)
    .eq("org_id", ORG_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!convo) throw new Error("Conversation not found");
  if (convo.channel !== "email") throw new Error("Not an email conversation");

  const meta = (convo.metadata || {}) as { email_from?: string };
  const to =
    meta.email_from ||
    (convo.visitor_email as string) ||
    String(convo.widget_session_id || "").replace(/^email:/, "");
  if (!to) throw new Error("Recipient email missing on conversation");

  const subjectRaw = (convo.subject as string) || "EnerTech support";
  const subject = subjectRaw.toLowerCase().startsWith("re:") ? subjectRaw : `Re: ${subjectRaw}`;

  await sendEmailMessage({ to, subject, text: body });
  return { ok: true };
}

export async function getEmailSetup() {
  const cfg = await loadEmailConfig();
  const appUrl = process.env.VITE_APP_URL || process.env.APP_URL || "";
  let gmailConnected = false;
  let gmailEmail: string | null = null;
  try {
    const { loadGmailConnection } = await import("@/server/gmail");
    const g = await loadGmailConnection();
    gmailConnected = Boolean(g?.email);
    gmailEmail = g?.email || null;
  } catch {
    /* ignore */
  }
  return {
    configured: emailConfigReady(cfg) || gmailConnected,
    fromEmail: gmailEmail || cfg.from_email || null,
    smtpHost: cfg.smtp_host || null,
    hasSmtpPass: Boolean(cfg.smtp_pass),
    inboundSecretSet: Boolean(cfg.inbound_secret),
    gmailConnected,
    gmailEmail,
    webhookUrl: appUrl ? `${appUrl.replace(/\/$/, "")}/api/webhooks/email` : "/api/webhooks/email",
  };
}
