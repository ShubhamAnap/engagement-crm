/**
 * Client-safe createServerFn wrappers for the Email channel.
 * SMTP/nodemailer live in `email-core.ts` and are only loaded inside handlers.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const saveEmailChannelConfig = createServerFn({ method: "POST" })
  .validator(
    z.object({
      fromEmail: z.string().email(),
      fromName: z.string().max(120).optional(),
      smtpHost: z.string().min(1).max(200),
      smtpPort: z.number().int().min(1).max(65535).default(587),
      smtpSecure: z.boolean().optional(),
      smtpUser: z.string().min(1).max(200),
      smtpPass: z.string().min(1).max(500),
      inboundSecret: z.string().max(200).optional(),
      enable: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { persistEmailChannelConfig } = await import("./email-core");
    return persistEmailChannelConfig(data);
  });

export const getEmailSetupInfo = createServerFn({ method: "GET" }).handler(async () => {
  const { getEmailSetup } = await import("./email-core");
  return getEmailSetup();
});

export const sendEmailAgentReply = createServerFn({ method: "POST" })
  .validator(
    z.object({
      conversationId: z.string().uuid(),
      body: z.string().min(1).max(8000),
    }),
  )
  .handler(async ({ data }) => {
    const { sendAgentEmailReply } = await import("./email-core");
    return sendAgentEmailReply(data.conversationId, data.body);
  });
