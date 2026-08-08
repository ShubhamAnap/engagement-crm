/**
 * Minimal observability: structured console logs + optional Sentry (env-gated).
 * No hard dependency — unset DSN = console only. Never throws into callers.
 */

type LogFields = Record<string, unknown>;

function baseFields(extra?: LogFields): LogFields {
  return {
    service: "enertech-engage",
    ts: new Date().toISOString(),
    ...extra,
  };
}

export function structuredLog(
  level: "info" | "warn" | "error",
  message: string,
  fields: LogFields = {},
) {
  const payload = baseFields({ level, message, ...fields });
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function parseSentryDsn(dsn: string): { key: string; host: string; projectId: string } | null {
  try {
    const u = new URL(dsn);
    const key = u.username;
    const projectId = u.pathname.replace(/^\//, "");
    if (!key || !projectId || !u.host) return null;
    return { key, host: u.host, projectId };
  } catch {
    return null;
  }
}

async function postSentryEvent(
  dsn: string,
  event: Record<string, unknown>,
): Promise<void> {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) return;
  const url = `https://${parsed.host}/api/${parsed.projectId}/store/`;
  const auth = `Sentry sentry_version=7, sentry_client=enertech-engage/1.0, sentry_key=${parsed.key}`;
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sentry-Auth": auth,
    },
    body: JSON.stringify(event),
  });
}

/** Server-side exception capture. Uses SENTRY_DSN when set. */
export async function captureException(
  error: unknown,
  context: LogFields = {},
): Promise<void> {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  structuredLog("error", message, { ...context, stack });

  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn || typeof fetch !== "function") return;

  try {
    await postSentryEvent(dsn, {
      event_id: crypto.randomUUID().replace(/-/g, ""),
      timestamp: Date.now() / 1000,
      platform: "node",
      level: "error",
      server_name: process.env.RENDER_SERVICE_NAME || "enertech-engage",
      environment: process.env.NODE_ENV || "development",
      message,
      exception: {
        values: [
          {
            type: error instanceof Error ? error.name : "Error",
            value: message,
            stacktrace: stack ? { frames: [{ filename: "app", function: "captureException", abs_path: stack }] } : undefined,
          },
        ],
      },
      tags: {
        ...(typeof context.route === "string" ? { route: context.route } : {}),
        ...(typeof context.cronRunId === "string" ? { cron_run_id: context.cronRunId } : {}),
      },
      extra: context,
    });
  } catch (err) {
    console.warn("[observability] Sentry send failed", err);
  }
}

/** Browser capture via VITE_SENTRY_DSN (optional). */
export function captureClientException(error: unknown, context: LogFields = {}) {
  if (typeof window === "undefined") return;

  const message =
    error instanceof Response
      ? `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);

  structuredLog("error", message, {
    route: window.location.pathname,
    stack: error instanceof Error ? error.stack : undefined,
    ...context,
  });

  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();
  if (!dsn) return;

  void postSentryEvent(dsn, {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    environment: import.meta.env.MODE || "development",
    message,
    exception: {
      values: [
        {
          type: error instanceof Error ? error.name : "Error",
          value: message,
        },
      ],
    },
    tags: { route: window.location.pathname },
    extra: context,
    request: { url: window.location.href },
  }).catch(() => undefined);
}
