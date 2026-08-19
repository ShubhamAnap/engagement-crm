/**
 * Gmail OAuth2 (n8n-style) + Gmail API send.
 * Client ID/Secret from env or Email channel config; tokens stored on channel config.
 * Client routes must import createServerFn wrappers from `gmail-api.ts` only.
 */
import { createServiceSupabase } from "@/lib/supabase";
import {
  applyEmailMerge,
  mergeFieldsFromCustomer,
  mergeFieldsFromLead,
  type EmailMergeFields,
} from "@/lib/email-merge";

import { DEFAULT_ORG_ID } from "@/server/org-context";
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";
const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

export type GmailOAuthTokens = {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number; // ms epoch
  token_type?: string;
  scope?: string;
};

export type GmailConnection = {
  email: string;
  name?: string | null;
  connected_at: string;
  tokens: GmailOAuthTokens;
};

export type GmailAppCredentials = {
  client_id?: string;
  client_secret?: string;
};

export type EmailChannelGmailConfig = GmailAppCredentials & {
  gmail?: GmailConnection | null;
  from_email?: string;
  from_name?: string;
};

function appBaseUrl() {
  return String(process.env.VITE_APP_URL || "http://localhost:8080").replace(/\/$/, "");
}

export function gmailRedirectUri() {
  return process.env.GMAIL_REDIRECT_URI || `${appBaseUrl()}/api/oauth/gmail/callback`;
}

async function loadEmailChannelRow() {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("channels")
    .select("id, config, is_enabled, detail")
    .eq("org_id", DEFAULT_ORG_ID)
    .eq("type", "email")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function loadGmailAppCredentials(): Promise<GmailAppCredentials> {
  const fromEnv: GmailAppCredentials = {
    client_id: process.env.GMAIL_CLIENT_ID || undefined,
    client_secret: process.env.GMAIL_CLIENT_SECRET || undefined,
  };
  try {
    const row = await loadEmailChannelRow();
    const cfg = (row?.config || {}) as EmailChannelGmailConfig;
    return {
      client_id: cfg.client_id || fromEnv.client_id,
      client_secret: cfg.client_secret || fromEnv.client_secret,
    };
  } catch {
    return fromEnv;
  }
}

export async function loadGmailConnection(): Promise<GmailConnection | null> {
  const row = await loadEmailChannelRow();
  const cfg = (row?.config || {}) as EmailChannelGmailConfig;
  const g = cfg.gmail;
  if (!g?.email || !g.tokens?.access_token) return null;
  return g;
}

export function gmailCredentialsReady(creds: GmailAppCredentials) {
  return Boolean(creds.client_id && creds.client_secret);
}

export function gmailConnected(conn: GmailConnection | null | undefined) {
  return Boolean(conn?.email && conn.tokens?.access_token);
}

async function saveEmailConfigPatch(patch: Record<string, unknown>, detail?: string) {
  const supabase = createServiceSupabase();
  const row = await loadEmailChannelRow();
  const prev = ((row?.config || {}) as Record<string, unknown>) || {};
  const next = { ...prev, ...patch };
  if (!row?.id) {
    const { error } = await supabase.from("channels").insert({
      org_id: DEFAULT_ORG_ID,
      type: "email",
      name: "Email",
      is_enabled: true,
      detail: detail || "Gmail OAuth",
      config: next,
    });
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase
    .from("channels")
    .update({
      config: next,
      ...(detail ? { detail } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) throw new Error(error.message);
}

function encodeState(payload: Record<string, string>) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeState(state: string): Record<string, string> {
  try {
    return JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function buildGmailAuthUrl(creds: GmailAppCredentials, state: string) {
  if (!creds.client_id) throw new Error("Gmail Client ID is missing");
  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set("client_id", creds.client_id);
  url.searchParams.set("redirect_uri", gmailRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCode(code: string, creds: GmailAppCredentials): Promise<GmailOAuthTokens> {
  if (!creds.client_id || !creds.client_secret) {
    throw new Error("Gmail Client ID/Secret missing");
  }
  const body = new URLSearchParams({
    code,
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    redirect_uri: gmailRedirectUri(),
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `Token exchange failed (${res.status})`);
  }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expiry_date: Date.now() + (json.expires_in || 3600) * 1000,
    token_type: json.token_type,
    scope: json.scope,
  };
}

async function refreshAccessToken(
  refreshToken: string,
  creds: GmailAppCredentials,
): Promise<GmailOAuthTokens> {
  if (!creds.client_id || !creds.client_secret) {
    throw new Error("Gmail Client ID/Secret missing");
  }
  const body = new URLSearchParams({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `Token refresh failed (${res.status})`);
  }
  return {
    access_token: json.access_token,
    refresh_token: refreshToken,
    expiry_date: Date.now() + (json.expires_in || 3600) * 1000,
    token_type: json.token_type,
    scope: json.scope,
  };
}

async function fetchGoogleProfile(accessToken: string) {
  const res = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json()) as { email?: string; name?: string; error?: { message?: string } };
  if (!res.ok || !json.email) {
    throw new Error(json.error?.message || `Could not read Google profile (${res.status})`);
  }
  return { email: json.email, name: json.name || null };
}

/** Ensure a valid access token (refresh if needed). */
export async function getValidGmailAccessToken(): Promise<{
  accessToken: string;
  connection: GmailConnection;
}> {
  const conn = await loadGmailConnection();
  if (!conn) throw new Error("Gmail is not connected. Connect Gmail under Channels → Email.");
  const creds = await loadGmailAppCredentials();
  const expiresSoon =
    !conn.tokens.expiry_date || conn.tokens.expiry_date < Date.now() + 60_000;

  if (!expiresSoon) {
    return { accessToken: conn.tokens.access_token, connection: conn };
  }
  if (!conn.tokens.refresh_token) {
    throw new Error("Gmail session expired. Disconnect and Connect Gmail again.");
  }
  const refreshed = await refreshAccessToken(conn.tokens.refresh_token, creds);
  const next: GmailConnection = {
    ...conn,
    tokens: {
      ...conn.tokens,
      ...refreshed,
      refresh_token: refreshed.refresh_token || conn.tokens.refresh_token,
    },
  };
  await saveEmailConfigPatch({ gmail: next }, `Gmail · ${next.email}`);
  return { accessToken: next.tokens.access_token, connection: next };
}

function toBase64Url(raw: string) {
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildRfc822(options: {
  from: string;
  to: string;
  subject: string;
  body: string;
  format: "text" | "html";
}) {
  const subject = options.subject.replace(/[\r\n]+/g, " ").trim();
  // Always base64-encode body — 7bit breaks on UTF-8 (names, ₹, Hindi, etc.) and Gmail rejects/garbles.
  const bodyB64 = Buffer.from(options.body, "utf8").toString("base64");
  const headers = [
    `From: ${options.from}`,
    `To: ${options.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    options.format === "html"
      ? 'Content-Type: text/html; charset="UTF-8"'
      : 'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    bodyB64,
  ];
  return headers.join("\r\n");
}

export async function sendGmailMessage(options: {
  to: string;
  subject: string;
  body: string;
  format?: "text" | "html";
}) {
  const to = options.to.trim();
  if (!to || !to.includes("@")) throw new Error("Valid recipient email is required");
  const subject = options.subject.trim();
  if (!subject) throw new Error("Subject is required");
  const body = options.body;
  if (!body?.trim()) throw new Error("Message body is required");
  const format = options.format === "html" ? "html" : "text";

  const { accessToken, connection } = await getValidGmailAccessToken();
  const fromName = connection.name?.trim();
  const from = fromName ? `"${fromName.replace(/"/g, "")}" <${connection.email}>` : connection.email;

  const raw = toBase64Url(
    buildRfc822({
      from,
      to,
      subject,
      body,
      format,
    }),
  );

  const res = await fetch(GMAIL_SEND, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message || `Gmail send failed (${res.status})`);
  }
  return { id: json.id || null, from: connection.email };
}

/** Complete OAuth callback (code → tokens → save). */
export async function completeGmailOAuth(code: string, state: string) {
  const decoded = decodeState(state);
  if (decoded.org !== DEFAULT_ORG_ID) {
    throw new Error("Invalid OAuth state");
  }
  const creds = await loadGmailAppCredentials();
  if (!gmailCredentialsReady(creds)) {
    throw new Error("Save Gmail Client ID and Client Secret first");
  }
  const tokens = await exchangeCode(code, creds);
  const profile = await fetchGoogleProfile(tokens.access_token);
  const existing = await loadGmailConnection();
  const connection: GmailConnection = {
    email: profile.email,
    name: profile.name,
    connected_at: new Date().toISOString(),
    tokens: {
      ...tokens,
      refresh_token: tokens.refresh_token || existing?.tokens.refresh_token,
    },
  };
  if (!connection.tokens.refresh_token) {
    // Still usable until access token expires; warn via detail
    console.warn("Gmail OAuth: no refresh_token returned — reconnect with prompt=consent if needed");
  }
  await saveEmailConfigPatch(
    {
      gmail: connection,
      from_email: profile.email,
      from_name: profile.name || undefined,
    },
    `Gmail · ${profile.email}`,
  );
  const supabase = createServiceSupabase();
  await supabase
    .from("channels")
    .update({ is_enabled: true })
    .eq("org_id", DEFAULT_ORG_ID)
    .eq("type", "email");
  return connection;
}

export async function persistGmailOAuthAppConfig(data: {
  clientId: string;
  clientSecret: string;
}) {
  await saveEmailConfigPatch({
    client_id: data.clientId.trim(),
    client_secret: data.clientSecret.trim(),
  });
  return { ok: true as const, redirectUri: gmailRedirectUri() };
}

export async function fetchGmailSetupInfo() {
  const creds = await loadGmailAppCredentials();
  const conn = await loadGmailConnection();
  return {
    credentialsConfigured: gmailCredentialsReady(creds),
    connected: gmailConnected(conn),
    email: conn?.email || null,
    name: conn?.name || null,
    connectedAt: conn?.connected_at || null,
    redirectUri: gmailRedirectUri(),
    hasClientIdInEnv: Boolean(process.env.GMAIL_CLIENT_ID),
  };
}

export async function createGmailConnectUrl() {
  const creds = await loadGmailAppCredentials();
  if (!gmailCredentialsReady(creds)) {
    throw new Error("Save Gmail OAuth Client ID and Client Secret first (like n8n credentials).");
  }
  const state = encodeState({ org: DEFAULT_ORG_ID, t: String(Date.now()) });
  return { url: buildGmailAuthUrl(creds, state) };
}

export async function clearGmailConnection() {
  await saveEmailConfigPatch({ gmail: null }, "Email (Gmail disconnected)");
  return { ok: true as const };
}

export async function runEmailBroadcast(
  broadcastId: string,
  options?: { maxMs?: number },
): Promise<{
  sent: number;
  failed: number;
  pending: number;
  total: number;
  delayMinSec: number;
  delayMaxSec: number;
  status: string;
  done: boolean;
}> {
  const supabase = createServiceSupabase();
  const startedAt = Date.now();
  // Keep under typical reverse-proxy / serverless timeouts (Render ~100s; leave headroom).
  const maxMs = Math.max(5_000, Math.min(options?.maxMs ?? 55_000, 90_000));

  const { data: broadcast, error: bErr } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("id", broadcastId)
    .eq("org_id", DEFAULT_ORG_ID)
    .maybeSingle();
  if (bErr) throw new Error(bErr.message);
  if (!broadcast) throw new Error("Broadcast not found");
  if (broadcast.channel_type !== "email") throw new Error("Not an email broadcast");

  const subject = String(broadcast.subject || "").trim();
  const body = String(broadcast.body_text || "").trim();
  const format = broadcast.body_format === "html" ? "html" : "text";
  if (!subject || !body) throw new Error("Email broadcast needs subject and body");

  await supabase
    .from("broadcasts")
    .update({
      status: "Sending",
      started_at: broadcast.started_at || new Date().toISOString(),
      completed_at: null,
    })
    .eq("id", broadcastId);

  // Atomic claim (pending → sending) so overlapping cron/UI cannot double-send.
  const { data: claimedRows, error: rErr } = await supabase.rpc("claim_broadcast_recipients", {
    p_broadcast_id: broadcastId,
    p_limit: 2000,
  });
  let recipients: Array<{
    id: string;
    email: string | null;
    name: string | null;
    lead_id: string | null;
    customer_id: string | null;
    merge_fields: unknown;
  }>;
  if (rErr) {
    console.warn("claim_broadcast_recipients unavailable; falling back:", rErr.message);
    const { data: pendingRows, error: pendingErr } = await supabase
      .from("broadcast_recipients")
      .select("*")
      .eq("broadcast_id", broadcastId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (pendingErr) throw new Error(pendingErr.message);
    recipients = (pendingRows || []) as typeof recipients;
  } else {
    recipients = (claimedRows || []) as typeof recipients;
  }

  const aud = (broadcast.audience || {}) as Record<string, unknown>;
  let delayMinSec = Math.round(Number(aud.delay_min_sec ?? 4));
  let delayMaxSec = Math.round(Number(aud.delay_max_sec ?? 12));
  if (!Number.isFinite(delayMinSec) || delayMinSec < 0) delayMinSec = 0;
  if (!Number.isFinite(delayMaxSec) || delayMaxSec < delayMinSec) delayMaxSec = delayMinSec;
  if (delayMinSec > 120) delayMinSec = 120;
  if (delayMaxSec > 300) delayMaxSec = 300;

  const mergeByEmailRaw = aud.merge_by_email;
  const mergeByEmail =
    mergeByEmailRaw && typeof mergeByEmailRaw === "object" && !Array.isArray(mergeByEmailRaw)
      ? (mergeByEmailRaw as Record<string, EmailMergeFields>)
      : {};

  const list = recipients || [];
  const leadIds = [
    ...new Set(list.map((r) => r.lead_id as string | null).filter((id): id is string => Boolean(id))),
  ];
  const customerIds = [
    ...new Set(
      list.map((r) => r.customer_id as string | null).filter((id): id is string => Boolean(id)),
    ),
  ];

  const leadMap = new Map<string, EmailMergeFields>();
  if (leadIds.length) {
    const { data: leads } = await supabase
      .from("leads")
      .select(
        "id, name, company, email, phone, requirement, sales_person, location, source, status, notes",
      )
      .eq("org_id", DEFAULT_ORG_ID)
      .in("id", leadIds);
    for (const lead of leads || []) {
      leadMap.set(lead.id as string, mergeFieldsFromLead(lead));
    }
  }

  const customerMap = new Map<string, EmailMergeFields>();
  if (customerIds.length) {
    const { data: customers } = await supabase
      .from("customers")
      .select("id, name, company, email, phone, notes")
      .eq("org_id", DEFAULT_ORG_ID)
      .in("id", customerIds);
    for (const customer of customers || []) {
      customerMap.set(customer.id as string, mergeFieldsFromCustomer(customer));
    }
  }

  let stoppedEarly = false;
  let nextIndex = 0;

  // Fail fast if Gmail isn't usable — release claim so another tick can retry.
  try {
    await getValidGmailAccessToken();
  } catch (err) {
    const claimedIds = list.map((r) => r.id as string).filter(Boolean);
    if (claimedIds.length) {
      await supabase
        .from("broadcast_recipients")
        .update({ status: "pending", claimed_at: null })
        .in("id", claimedIds)
        .eq("status", "sending");
    }
    await supabase
      .from("broadcasts")
      .update({
        status: "Queued",
        failed_count: 0,
      })
      .eq("id", broadcastId);
    throw err instanceof Error
      ? err
      : new Error("Gmail is not connected. Connect Gmail under Channels → Email.");
  }

  for (; nextIndex < list.length; nextIndex++) {
    if (Date.now() - startedAt > maxMs) {
      stoppedEarly = true;
      break;
    }

    const r = list[nextIndex];
    const email = String(r.email || "").trim().toLowerCase();
    if (!email) {
      await supabase
        .from("broadcast_recipients")
        .update({ status: "failed", error: "Missing email", claimed_at: null })
        .eq("id", r.id);
    } else {
      try {
        const fromLead = r.lead_id ? leadMap.get(String(r.lead_id)) : undefined;
        const fromCustomer = r.customer_id ? customerMap.get(String(r.customer_id)) : undefined;
        const rawMerge = r.merge_fields;
        const fromUploadCol: EmailMergeFields | undefined =
          rawMerge && typeof rawMerge === "object" && !Array.isArray(rawMerge)
            ? (rawMerge as EmailMergeFields)
            : undefined;
        const fromAudience = mergeByEmail[email];
        // Upload CSV / audience map wins for campaign-only shortlists; else CRM.
        const fields: EmailMergeFields = {
          ...(fromCustomer || {}),
          ...(fromLead || {}),
          ...(fromAudience || {}),
          ...(fromUploadCol || {}),
          name:
            fromUploadCol?.name ||
            fromAudience?.name ||
            fromLead?.name ||
            fromCustomer?.name ||
            (r.name as string) ||
            null,
          email:
            fromUploadCol?.email ||
            fromAudience?.email ||
            fromLead?.email ||
            fromCustomer?.email ||
            email,
        };

        const personalizedBody = applyEmailMerge(body, fields);
        const personalizedSubject = applyEmailMerge(subject, fields);

        const result = await sendGmailMessage({
          to: email,
          subject: personalizedSubject,
          body: personalizedBody,
          format,
        });
        await supabase
          .from("broadcast_recipients")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            wa_message_id: result.id,
            error: null,
            claimed_at: null,
          })
          .eq("id", r.id);
      } catch (err) {
        await supabase
          .from("broadcast_recipients")
          .update({
            status: "failed",
            error: err instanceof Error ? err.message : "send failed",
            claimed_at: null,
          })
          .eq("id", r.id);
      }
    }

    // Random pause between emails (not after the last one) — Gmail pacing
    if (nextIndex < list.length - 1 && !stoppedEarly && delayMaxSec > 0) {
      if (Date.now() - startedAt > maxMs) {
        stoppedEarly = true;
        break;
      }
      const span = delayMaxSec - delayMinSec;
      const waitSec = delayMinSec + (span > 0 ? Math.random() * span : 0);
      const waitMs = Math.max(0, Math.round(waitSec * 1000));
      const remainingBudget = maxMs - (Date.now() - startedAt);
      if (waitMs > remainingBudget) {
        stoppedEarly = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  // Release unsent claims so the next cron/UI tick can continue.
  const unsentIds = list
    .slice(nextIndex)
    .map((r) => r.id as string)
    .filter(Boolean);
  if (unsentIds.length) {
    await supabase
      .from("broadcast_recipients")
      .update({ status: "pending", claimed_at: null })
      .in("id", unsentIds)
      .eq("status", "sending");
  }

  // Recount from DB so cron resumes don't overwrite totals.
  const { data: allRecipients } = await supabase
    .from("broadcast_recipients")
    .select("status")
    .eq("broadcast_id", broadcastId);
  const statuses = (allRecipients || []).map((row) => String(row.status || ""));
  const sent = statuses.filter((s) => s === "sent").length;
  const failed = statuses.filter((s) => s === "failed").length;
  const pending = statuses.filter((s) => s === "pending" || s === "sending").length;
  const total = statuses.length;
  const done = pending === 0;
  const status = done
    ? failed > 0 && sent === 0
      ? "Failed"
      : "Completed"
    : "Sending";

  await supabase
    .from("broadcasts")
    .update({
      status,
      sent_count: sent,
      failed_count: failed,
      total_count: total,
      completed_at: done ? new Date().toISOString() : null,
    })
    .eq("id", broadcastId);

  return {
    sent,
    failed,
    pending,
    total,
    delayMinSec,
    delayMaxSec,
    status,
    done,
  };
}

/** Resume any email campaigns stuck in Sending / Queued with pending recipients. */
export async function tickPendingEmailBroadcasts(limit = 3): Promise<{
  processed: number;
  results: Array<{ broadcastId: string; sent: number; failed: number; pending: number; done: boolean }>;
}> {
  const supabase = createServiceSupabase();
  const { data: rows, error } = await supabase
    .from("broadcasts")
    .select("id")
    .eq("org_id", DEFAULT_ORG_ID)
    .eq("channel_type", "email")
    .in("status", ["Queued", "Sending"])
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const results: Array<{
    broadcastId: string;
    sent: number;
    failed: number;
    pending: number;
    done: boolean;
  }> = [];

  for (const row of rows || []) {
    const id = row.id as string;
    const { count } = await supabase
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", id)
      .in("status", ["pending", "sending"]);
    if (!count) {
      // No pending/in-flight — finalize status from counts
      await runEmailBroadcast(id, { maxMs: 5_000 }).catch(() => null);
      continue;
    }
    try {
      const r = await runEmailBroadcast(id, { maxMs: 45_000 });
      results.push({
        broadcastId: id,
        sent: r.sent,
        failed: r.failed,
        pending: r.pending,
        done: r.done,
      });
    } catch (err) {
      console.error("tickPendingEmailBroadcasts", id, err);
    }
  }

  return { processed: results.length, results };
}
