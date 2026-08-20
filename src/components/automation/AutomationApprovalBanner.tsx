import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck, ShieldAlert, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth, useOrgId } from "@/lib/auth";
import {
  approveAutomationApprovalFn,
  bulkApproveAutomationApprovalsFn,
  bulkRejectAutomationApprovalsFn,
  listPendingApprovals,
  rejectAutomationApprovalFn,
  type DbAutomationApproval,
} from "@/lib/automations-api";
import { Pill } from "@/components/shared/ui-kit";

/**
 * Top-of-app queue: Approve / Reject before automation campaigns run.
 * Supports bulk Approve all / Reject all for IndiaMART / TradeIndia batches.
 */
export function AutomationApprovalBanner() {
  const { profile } = useAuth();
  const orgId = useOrgId();
  const userId = profile?.id;
  const queryClient = useQueryClient();

  const approvalsQuery = useQuery({
    queryKey: ["automation-approvals", orgId],
    queryFn: () => listPendingApprovals(orgId),
    enabled: Boolean(profile),
    refetchInterval: 15_000,
  });

  const pending = approvalsQuery.data ?? [];
  const pendingIds = pending.map((p) => p.id);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["automation-approvals"] });
    await queryClient.invalidateQueries({ queryKey: ["automation-runs"] });
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    await queryClient.invalidateQueries({ queryKey: ["leads"] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      approveAutomationApprovalFn({
        data: { approvalId: id, resolvedBy: userId },
      }),
    onSuccess: async (result) => {
      await refresh();
      if (result.ok) toast.success("Campaign approved — running now");
      else toast.error(result.error || "Approved but some steps failed — check run log");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Approve failed"),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      rejectAutomationApprovalFn({
        data: { approvalId: id, resolvedBy: userId },
      }),
    onSuccess: async () => {
      await refresh();
      toast.message("Campaign rejected — not executed");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Reject failed"),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: () =>
      bulkApproveAutomationApprovalsFn({
        data: { approvalIds: pendingIds, resolvedBy: userId },
      }),
    onSuccess: async (result) => {
      await refresh();
      toast.success(
        `Approved ${result.approved} campaign${result.approved === 1 ? "" : "s"}${
          result.failed ? ` · ${result.failed} failed` : ""
        }`,
      );
      if (result.errors.length) {
        toast.message("Some steps had issues", { description: result.errors[0] });
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Bulk approve failed"),
  });

  const bulkRejectMutation = useMutation({
    mutationFn: () =>
      bulkRejectAutomationApprovalsFn({
        data: { approvalIds: pendingIds, resolvedBy: userId },
      }),
    onSuccess: async (result) => {
      await refresh();
      toast.message(
        `Rejected ${result.rejected} campaign${result.rejected === 1 ? "" : "s"} — not executed`,
      );
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Bulk reject failed"),
  });

  const busy =
    approveMutation.isPending ||
    rejectMutation.isPending ||
    bulkApproveMutation.isPending ||
    bulkRejectMutation.isPending;

  if (!profile || pending.length === 0) return null;

  return (
    <div className="border-b border-warning/30 bg-warning/10 px-4 py-2.5" data-automation-approvals>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <ShieldAlert className="size-4 shrink-0 text-warning" />
        <p className="text-sm font-semibold text-foreground">
          Automation approval needed
          <span className="ml-1.5 font-normal text-muted-foreground">({pending.length})</span>
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {pending.length > 1 ? (
            <>
              <Button
                size="sm"
                className="gap-1"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Approve all ${pending.length} campaigns? They will run immediately (WhatsApp/email/CRM actions).`,
                    )
                  ) {
                    bulkApproveMutation.mutate();
                  }
                }}
              >
                <CheckCheck className="size-3.5" />
                {bulkApproveMutation.isPending ? "Approving…" : `Approve all (${pending.length})`}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Reject all ${pending.length} campaigns? None will run.`)) {
                    bulkRejectMutation.mutate();
                  }
                }}
              >
                <XCircle className="size-3.5" />
                {bulkRejectMutation.isPending ? "Rejecting…" : "Reject all"}
              </Button>
            </>
          ) : (
            <Pill tone="warning" className="hidden sm:inline-flex">
              Approve to run · Reject to skip
            </Pill>
          )}
        </div>
      </div>
      <ul className="max-h-56 space-y-2 overflow-y-auto">
        {pending.map((item) => (
          <ApprovalCard
            key={item.id}
            item={item}
            busy={busy}
            onApprove={() => approveMutation.mutate(item.id)}
            onReject={() => rejectMutation.mutate(item.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function ApprovalCard({
  item,
  busy,
  onApprove,
  onReject,
}: {
  item: DbAutomationApproval;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const ctx = item.context || {};
  const contact =
    [ctx.leadName, ctx.company].filter(Boolean).join(" · ") ||
    item.lead_id?.slice(0, 8) ||
    "—";

  return (
    <li className="rounded-lg border border-border bg-background/90 p-3 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{item.automation_name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">Goal:</span> {item.goal}
          </p>
          <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
            {item.summary || `Contact: ${contact} · Trigger: ${item.trigger_type}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" className="gap-1" disabled={busy} onClick={onApprove}>
            <Check className="size-3.5" /> Approve
          </Button>
          <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={onReject}>
            <X className="size-3.5" /> Reject
          </Button>
        </div>
      </div>
    </li>
  );
}
