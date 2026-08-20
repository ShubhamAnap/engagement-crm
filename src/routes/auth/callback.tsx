import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getBrowserSupabase } from "@/lib/supabase";
import { syncStaffAccessCookie } from "@/lib/staff-access-cookie";
import { bootstrapAuthSession } from "@/server/org-invites";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({
    meta: [{ title: "Signing in…" }],
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Completing sign in…");

  useEffect(() => {
    let cancelled = false;

    async function finish() {
      try {
        const supabase = getBrowserSupabase();
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!data.session) {
          toast.error("Sign-in failed. Try again.");
          void navigate({ to: "/login" });
          return;
        }

        syncStaffAccessCookie(data.session.access_token);
        const result = await bootstrapAuthSession();

        if (cancelled) return;

        if (result.status === "ready") {
          void navigate({ to: "/" });
          return;
        }

        if (result.status === "onboarding") {
          void navigate({ to: "/onboarding" });
          return;
        }

        toast.error("This workspace is invite-only. Ask your admin for an invite.");
        await supabase.auth.signOut();
        syncStaffAccessCookie(null);
        void navigate({ to: "/login" });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Sign-in failed";
        setMessage(msg);
        toast.error(msg);
        void navigate({ to: "/login" });
      }
    }

    void finish();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
