import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { stopPlatformImpersonation } from "@/server/platform-impersonation";
import { Link } from "@tanstack/react-router";

/** Sticky banner while a platform admin is in tenant support mode. */
export function ImpersonationBanner() {
  const { profile, refreshProfile } = useAuth();
  const queryClient = useQueryClient();

  const exitMutation = useMutation({
    mutationFn: () => stopPlatformImpersonation(),
    onSuccess: async () => {
      toast.success("Exited support mode");
      await refreshProfile();
      await queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not exit support mode"),
  });

  if (!profile?.impersonating) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-50">
      <p className="flex items-center gap-2 font-medium">
        <ShieldAlert className="size-4 shrink-0" />
        Support mode — viewing <span className="font-semibold">{profile.org.name}</span> as Admin
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" asChild>
          <Link to="/platform">Platform</Link>
        </Button>
        <Button
          size="sm"
          variant="default"
          disabled={exitMutation.isPending}
          onClick={() => exitMutation.mutate()}
        >
          Exit support mode
        </Button>
      </div>
    </div>
  );
}
