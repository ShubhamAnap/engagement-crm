import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import { deleteMyAccount } from "@/server/org-admin";

export function AccountDangerZonePanel() {
  const { signOut } = useAuth();
  const [confirmText, setConfirmText] = useState("");

  const deleteMutation = useMutation({
    mutationFn: () => deleteMyAccount({ data: { confirmText } }),
    onSuccess: async () => {
      toast.success("Account deleted");
      await signOut();
      window.location.href = "/signup";
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not delete account"),
  });

  const canDelete = confirmText.trim().toUpperCase() === "DELETE ACCOUNT";

  return (
    <Panel
      title="Delete account"
      description="Remove your own login from this workspace. If you are the last Admin or last member, the action is blocked."
    >
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex items-start gap-3">
          <Trash2 className="mt-0.5 size-4 text-destructive" />
          <div className="flex-1 space-y-3">
            <p className="text-sm font-medium text-foreground">Delete my account</p>
            <p className="text-xs text-muted-foreground">
              This removes your login and personal profile from the workspace. It does not delete the
              whole workspace unless you are the last member, in which case use workspace deletion.
            </p>
            <div className="space-y-2">
              <Label htmlFor="delete-account-confirm">Type DELETE ACCOUNT to confirm</Label>
              <Input
                id="delete-account-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE ACCOUNT"
              />
            </div>
            <Button
              size="sm"
              variant="destructive"
              disabled={!canDelete || deleteMutation.isPending}
              onClick={() => {
                if (!confirm("Delete your account from this workspace?")) return;
                deleteMutation.mutate();
              }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete my account"}
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
