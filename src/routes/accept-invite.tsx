import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { getBrowserSupabase } from "@/lib/supabase";
import { syncStaffAccessCookie } from "@/lib/staff-access-cookie";
import { completeInviteAcceptance } from "@/server/org-invites";

export const Route = createFileRoute("/accept-invite")({
  head: () => ({
    meta: [
      { title: "Accept invite" },
      { name: "description", content: "Join your team workspace." },
    ],
  }),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { session, profile, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [bootstrapping, setBootstrapping] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapSession() {
      try {
        const supabase = getBrowserSupabase();
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        const { data } = await supabase.auth.getSession();
        syncStaffAccessCookie(data.session?.access_token ?? null);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Invalid or expired invite link");
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    }

    void bootstrapSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loading && !bootstrapping && profile) {
      void navigate({ to: "/" });
    }
  }, [loading, bootstrapping, profile, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getBrowserSupabase();
      const { error: passErr } = await supabase.auth.updateUser({ password });
      if (passErr) throw passErr;

      await completeInviteAcceptance();
      await refreshProfile();
      toast.success("Welcome to the team!");
      void navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not accept invite");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || bootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Verifying invite…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Invite link expired</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ask your admin to send a new invite, then open the link from your email.
          </p>
          <Link to="/login" className="mt-6 inline-block text-sm font-semibold text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  const formValid = password.length >= 8 && password === confirmPassword;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div className="relative w-full max-w-[440px]">
        <div className="rounded-2xl border border-border/60 bg-card/95 p-8 shadow-xl shadow-black/5 backdrop-blur-md">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/90 to-primary shadow-lg shadow-primary/20">
              <UserPlus className="size-7 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold tracking-[-0.03em] text-foreground">
              Join your team
            </h1>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              Set a password for {session.user.email}
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  className="pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full py-5" disabled={submitting || !formValid}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" /> Joining…
                </>
              ) : (
                "Accept invite"
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
