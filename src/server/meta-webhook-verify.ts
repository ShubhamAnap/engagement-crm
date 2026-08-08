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
 * Read raw body + verify Meta signature when META_APP_SECRET is set.
 * If secret is unset, accept the webhook (log warning) so inbound WA/FB/IG
 * keep working until ops configures App Secret — do not brick messaging.
 * When secret IS set, invalid signatures are rejected (401).
 */
export async function readAndVerifyMetaWebhookBody(
  request: Request,
): Promise<{ ok: true; rawBody: string; payload: unknown } | { ok: false; response: Response }> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const appSecret = loadMetaAppSecret();

  if (!appSecret) {
    console.warn(
      "Meta webhook: META_APP_SECRET unset — accepting without signature check. Set App Secret on Render to lock this down.",
    );
  } else if (!verifyMetaSignature256(rawBody, signature, appSecret)) {
    return { ok: false, response: new Response("Invalid signature", { status: 401 }) };
  }

  let payload: unknown = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { ok: false, response: new Response("Invalid JSON", { status: 400 }) };
  }

  return { ok: true, rawBody, payload };
}
