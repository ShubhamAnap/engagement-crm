import { createHash } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function hashIp(ip: string): string {
  return createHash("sha256").update(ip.trim()).digest("hex");
}

export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function assertSignupRateLimit(request: Request): Promise<void> {
  const ip = clientIpFromRequest(request);
  const ipHash = hashIp(ip);
  const supabase = createServiceSupabase();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  await supabase.from("signup_attempts").delete().lt("created_at", since);

  const { count, error } = await supabase
    .from("signup_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  if (error) {
    console.warn("signup rate limit check failed", error.message);
    return;
  }

  if ((count ?? 0) >= MAX_ATTEMPTS) {
    throw new Error("Too many signup attempts from this network. Try again in an hour.");
  }

  await supabase.from("signup_attempts").insert({ ip_hash: ipHash });
}

export function inviteOnlyMode(): boolean {
  return String(process.env.INVITE_ONLY || "").trim().toLowerCase() === "true";
}
