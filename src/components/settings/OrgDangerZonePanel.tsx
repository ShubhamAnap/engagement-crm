import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import { disableOrganization, deleteOrganizationPermanently, exportOrganizationData } from "@/server/org-admin";

export function OrgDangerZonePanel() {
  const { profile, signOut } = useAuth();
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [deleteName, setDeleteName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const exportMutation = useMutation({
    mutationFn: () => exportOrganizationData(),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `engage-export-${data.orgId.slice(0, 8)}-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Export failed"),
  });

  const disableMutation = useMutation({
    mutationFn: () => disableOrganization({ data: { reason: reason.trim() || undefined } }),
    onSuccess: async () => {
      toast.success("Workspace disabled");
      await signOut();
      window.location.href = "/login";
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not disable workspace"),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      deleteOrganizationPermanently({
        data: {
          confirmText: deleteConfirm,
          confirmName: deleteName,
        },
      }),
    onSuccess: async () => {
      toast.success("Workspace permanently deleted");
      await signOut();
      window.location.href = "/signup";
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not delete workspace"),
  });

  const canDisable = confirmText.trim().toUpperCase() === "DISABLE";
  const canDelete =
    deleteConfirm.trim().toUpperCase() === "DELETE WORKSPACE" &&
    deleteName.trim() === (profile?.org.name || "");

  return (
    <Panel
      title="Danger zone"
      description="Export your data or permanently disable this workspace for all team members."
    >
      <div className="space-y-6">
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-start gap-3">
            <Download className="mt-0.5 size-4 text-muted-foreground" />
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-foreground">Export workspace data</p>
              <p className="text-xs text-muted-foreground">
                Downloads leads, customers, conversations metadata, products, channels, and team
                members as JSON. Message bodies and files are not included.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={exportMutation.isPending}
                onClick={() => exportMutation.mutate()}
              >
                {exportMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 size-3.5 animate-spin" /> Preparing…
                  </>
                ) : (
                  "Download export"
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-4 text-destructive" />
            <div className="flex-1 space-y-3">
              <p className="text-sm font-medium text-foreground">Disable workspace</p>
              <p className="text-xs text-muted-foreground">
                Blocks all team members immediately and revokes pending invites. This cannot be
                undone from the app — contact support to re-enable.
              </p>
              <div className="space-y-2">
                <Label htmlFor="disable-reason">Reason (optional)</Label>
                <Input
                  id="disable-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Closing account, migrating, etc."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="disable-confirm">Type DISABLE to confirm</Label>
                <Input
                  id="disable-confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="DISABLE"
                />
              </div>
              <Button
                size="sm"
                variant="destructive"
                disabled={!canDisable || disableMutation.isPending}
                onClick={() => {
                  if (!confirm("Disable this workspace for everyone?")) return;
                  disableMutation.mutate();
                }}
              >
                {disableMutation.isPending ? "Disabling…" : "Disable workspace"}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <div className="flex items-start gap-3">
            <Trash2 className="mt-0.5 size-4 text-destructive" />
            <div className="flex-1 space-y-3">
              <p className="text-sm font-medium text-foreground">Permanently delete workspace</p>
              <p className="text-xs text-muted-foreground">
                Deletes team accounts, database records, and stored files for this workspace. This
                action cannot be undone.
              </p>
              <div className="space-y-2">
                <Label htmlFor="delete-org-name">
                  Type workspace name: <span className="font-medium">{profile?.org.name || "—"}</span>
                </Label>
                <Input
                  id="delete-org-name"
                  value={deleteName}
                  onChange={(e) => setDeleteName(e.target.value)}
                  placeholder={profile?.org.name || "Workspace name"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="delete-workspace-confirm">Type DELETE WORKSPACE to confirm</Label>
                <Input
                  id="delete-workspace-confirm"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder="DELETE WORKSPACE"
                />
              </div>
              <Button
                size="sm"
                variant="destructive"
                disabled={!canDelete || deleteMutation.isPending}
                onClick={() => {
                  if (!confirm("Permanently delete this workspace and all member accounts?")) return;
                  deleteMutation.mutate();
                }}
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete workspace permanently"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
