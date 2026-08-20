import { createHmac, timingSafeEqual } from "node:crypto";

/** Meta App Secret used for X-Hub-Signature-256 on WhatsApp / Facebook / Instagram. */
export function loadMetaAppSecret(): string | undefined {
  const secret =
    process.env.META_APP_SECRET?.trim() ||
    process.env.WHATSAPP_APP_SECRET?.trim() ||
    process.env.FACEBOOK_APP_SECRET?.trim() ||
    undefined;
  return secret || undefined;
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.RENDER);
}

/**
 * Verify Meta webhook signature (HMAC-SHA256 of raw body).
 * Header format: `X-Hub-Signature-256: sha256=<hex>`
 */
export function verifyMetaSignature256(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const receivedHex = signatureHeader.slice(prefix.length).trim();
  if (!/^[0-9a-fA-F]+$/.test(receivedHex)) return false;

  const expectedHex = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    const a = Buffer.from(expectedHex, "hex");
    const b = Buffer.from(receivedHex, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Escape hatch for first-time Meta setup only: accept unsigned/mismatched webhooks in
 * production. Every tenant shares one Meta App, so an unverified webhook can name any
 * page_id and post into any workspace — never leave this on.
 */
function allowUnsignedMetaWebhooks(): boolean {
  const raw = (process.env.META_WEBHOOK_ALLOW_UNSIGNED || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Read and authenticate a Meta webhook body.
 *
 * Inbound events carry the target page / phone number in the payload, so an unsigned
 * request is enough to write into another workspace. Signatures are therefore enforced
 * in production; local dev logs and continues so setup is not blocked.
 */
export async function readAndVerifyMetaWebhookBody(
  request: Request,
): Promise<{ ok: true; rawBody: string; payload: unknown } | { ok: false; response: Response }> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const appSecret = loadMetaAppSecret();
  const strict = isProductionRuntime() && !allowUnsignedMetaWebhooks();

  if (!appSecret) {
    if (strict) {
      console.error(
        "Meta webhook rejected: META_APP_SECRET is not set. Add the Meta App Secret (not an access token) to the service environment.",
      );
      return { ok: false, response: new Response("Forbidden", { status: 403 }) };
    }
    console.warn("Meta webhook: META_APP_SECRET unset — accepting inbound (non-production)");
  } else if (!verifyMetaSignature256(rawBody, signature, appSecret)) {
    if (strict) {
      console.error(
        "Meta webhook rejected: X-Hub-Signature-256 mismatch. Confirm META_APP_SECRET is the Meta App Secret for the app these pages are subscribed to.",
      );
      return { ok: false, response: new Response("Forbidden", { status: 403 }) };
    }
    console.warn(
      "Meta webhook: signature mismatch (check META_APP_SECRET is Meta App Secret, not access token) — accepting inbound (non-production)",
    );
  }

  let payload: unknown = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { ok: false, response: new Response("Invalid JSON", { status: 400 }) };
  }

  return { ok: true, rawBody, payload };
}
