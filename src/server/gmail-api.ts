/**
 * Client-safe Gmail createServerFn wrappers.
 * Heavy OAuth/API logic stays in `gmail.ts` and loads only inside handlers.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const saveGmailOAuthAppConfig = createServerFn({ method: "POST" })
  .validator(
    z.object({
      clientId: z.string().min(8).max(300),
      clientSecret: z.string().min(8).max(300),
    }),
  )
  .handler(async ({ data }) => {
    const { persistGmailOAuthAppConfig } = await import("./gmail");
    return persistGmailOAuthAppConfig(data);
  });

export const getGmailSetupInfo = createServerFn({ method: "GET" }).handler(async () => {
  const { fetchGmailSetupInfo } = await import("./gmail");
  return fetchGmailSetupInfo();
});

export const getGmailConnectUrl = createServerFn({ method: "POST" }).handler(async () => {
  const { createGmailConnectUrl } = await import("./gmail");
  return createGmailConnectUrl();
});

export const disconnectGmail = createServerFn({ method: "POST" }).handler(async () => {
  const { clearGmailConnection } = await import("./gmail");
  return clearGmailConnection();
});

export const sendGmailCompose = createServerFn({ method: "POST" })
  .validator(
    z.object({
      to: z.string().email(),
      subject: z.string().min(1).max(300),
      body: z.string().min(1).max(100_000),
      format: z.enum(["text", "html"]).default("text"),
    }),
  )
  .handler(async ({ data }) => {
    const { sendGmailMessage } = await import("./gmail");
    return sendGmailMessage({
      to: data.to,
      subject: data.subject,
      body: data.body,
      format: data.format,
    });
  });

export const runGmailEmailBroadcast = createServerFn({ method: "POST" })
  .validator(z.object({ broadcastId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { runEmailBroadcast } = await import("./gmail");
    return runEmailBroadcast(data.broadcastId);
  });
