/** Client-side error reporting for React error boundaries. */
import { captureClientException } from "@/lib/observability";

export function reportClientError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  captureClientException(error, context);
}
