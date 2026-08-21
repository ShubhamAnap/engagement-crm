import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Pill } from "@/components/shared/ui-kit";
import { getPublicMaintenanceBanner } from "@/server/platform-settings";

type HealthResponse = {
  ok: boolean;
  service: string;
  db: string;
  ms?: number;
  ts?: string;
  error?: string;
};

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [{ title: "Service status" }],
  }),
  component: StatusPage,
});

function StatusPage() {
  const healthQuery = useQuery({
    queryKey: ["public-health"],
    queryFn: async (): Promise<HealthResponse> => {
      const res = await fetch("/api/health");
      return res.json() as Promise<HealthResponse>;
    },
    refetchInterval: 60_000,
  });

  const maintenanceQuery = useQuery({
    queryKey: ["platform-maintenance-banner"],
    queryFn: () => getPublicMaintenanceBanner(),
    staleTime: 60_000,
  });

  const ok = healthQuery.data?.ok === true;
  const maintenance = maintenanceQuery.data;

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-lg text-center">
        <Link to="/features" className="text-sm font-medium text-primary hover:underline">
          Engage CRM
        </Link>
        <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Service status</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Live check of application and database connectivity.
        </p>

        <div className="mt-8 rounded-2xl border border-border bg-card p-8 shadow-sm">
          {healthQuery.isLoading ? (
            <Loader2 className="mx-auto size-10 animate-spin text-muted-foreground" />
          ) : (
            <>
              {ok ? (
                <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
              ) : (
                <XCircle className="mx-auto size-12 text-destructive" />
              )}
              <div className="mt-4 flex justify-center">
                <Pill tone={ok ? "success" : "danger"} dot>
                  {ok ? "All systems operational" : "Degraded"}
                </Pill>
              </div>
              {maintenance?.enabled && maintenance.message.trim() ? (
                <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-2 text-left text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-50">
                  {maintenance.message.trim()}
                </p>
              ) : null}
              <dl className="mt-6 space-y-2 text-left text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Application</dt>
                  <dd>{healthQuery.data?.service ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Database</dt>
                  <dd className={healthQuery.data?.db === "up" ? "text-emerald-600" : "text-destructive"}>
                    {healthQuery.data?.db ?? "unknown"}
                  </dd>
                </div>
                {healthQuery.data?.ms != null ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Response</dt>
                    <dd>{healthQuery.data.ms} ms</dd>
                  </div>
                ) : null}
                {healthQuery.data?.ts ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Checked</dt>
                    <dd>{new Date(healthQuery.data.ts).toLocaleString()}</dd>
                  </div>
                ) : null}
              </dl>
              {!ok && healthQuery.data?.error ? (
                <p className="mt-4 text-left text-xs text-destructive">{healthQuery.data.error}</p>
              ) : null}
            </>
          )}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          For incidents, contact{" "}
          <a href="mailto:support@engagecrm.com" className="text-primary hover:underline">
            support@engagecrm.com
          </a>{" "}
          or see{" "}
          <Link to="/support" className="text-primary hover:underline">
            Support
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
