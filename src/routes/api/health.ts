import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";

/**
 * Liveness + DB connectivity for Render / load balancers.
 * Do not require auth — keep this cheap and public.
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const started = Date.now();
        try {
          const supabase = createServiceSupabase();
          const { error } = await supabase.from("organizations").select("id").limit(1);
          if (error) throw new Error(error.message);

          return Response.json({
            ok: true,
            service: "enertech-engage",
            db: "up",
            ms: Date.now() - started,
            ts: new Date().toISOString(),
          });
        } catch (err) {
          return Response.json(
            {
              ok: false,
              service: "enertech-engage",
              db: "down",
              error: err instanceof Error ? err.message : "health check failed",
              ms: Date.now() - started,
              ts: new Date().toISOString(),
            },
            { status: 503 },
          );
        }
      },
    },
  },
});
