/**
 * Copy for features whose database objects are not present yet.
 *
 * Workspace admins have no database access, so migration filenames and raw Postgres
 * errors are operator detail — they belong in the browser console and in dev builds,
 * never in a customer's empty state. Keep the hint argument for developers; the
 * customer-facing sentence stays the same in production.
 */

const SUPPORT_LINE = "Contact support and we will switch it on for your workspace.";

/** Matches "relation … does not exist" and a stale PostgREST schema cache. */
export function isMissingSchemaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /does not exist|schema cache|42P01|PGRST205/i.test(message);
}

function withDevHint(sentence: string, operatorHint?: string): string {
  if (!operatorHint || !import.meta.env.DEV) return sentence;
  return `${sentence} [dev: ${operatorHint}]`;
}

/** Empty-state copy for a feature that has not been provisioned for this workspace. */
export function featureNotSetUp(feature: string, operatorHint?: string): string {
  return withDevHint(`${feature} is not available for this workspace yet. ${SUPPORT_LINE}`, operatorHint);
}

/**
 * Customer-safe message for a failed load. Missing tables read as "not enabled yet";
 * anything else reads as a transient failure. The raw error still reaches the console.
 */
export function describeLoadError(err: unknown, feature: string, operatorHint?: string): string {
  if (err) console.error(`[${feature}]`, err);
  if (isMissingSchemaError(err)) return featureNotSetUp(feature, operatorHint);
  const detail = err instanceof Error ? err.message : undefined;
  return withDevHint(
    `Could not load ${feature.toLowerCase()}. Refresh to try again — if it keeps happening, contact support.`,
    detail,
  );
}
