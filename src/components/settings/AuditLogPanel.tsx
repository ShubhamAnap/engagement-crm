import { useQuery } from "@tanstack/react-query";
import { EmptyState, Panel } from "@/components/shared/ui-kit";
import { listOrgAuditEvents } from "@/server/platform-console";

export function AuditLogPanel() {
  const query = useQuery({
    queryKey: ["org-audit-log"],
    queryFn: () => listOrgAuditEvents({ data: { limit: 50 } }),
  });

  const rows = query.data ?? [];

  return (
    <Panel
      title="Audit log"
      description="Recent security and configuration changes in your workspace."
    >
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : query.isError ? (
        <EmptyState
          title="Audit log unavailable"
          description="Run 042_platform_admin.sql in Supabase, then refresh."
        />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No audit events recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="border-b border-border bg-secondary/40 uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Actor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-medium">{row.action}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.actor_email || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
