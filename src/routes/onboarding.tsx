import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, Building2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { completeOAuthOnboarding } from "@/server/org-invites";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Set up your workspace" },
      { name: "description", content: "Create your organization workspace." },
    ],
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const { session, profile, loading, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !session) {
      void navigate({ to: "/login" });
    }
  }, [loading, session, navigate]);

  useEffect(() => {
    if (!loading && profile) {
      void navigate({ to: "/" });
    }
  }, [loading, profile, navigate]);

  useEffect(() => {
    if (session?.user) {
      const name =
        String(session.user.user_metadata?.full_name || session.user.user_metadata?.name || "").trim();
      if (name) setFullName(name);
    }
  }, [session?.user]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await completeOAuthOnboarding({
        data: {
          orgName: orgName.trim(),
          fullName: fullName.trim() || undefined,
        },
      });
      await refreshProfile();
      toast.success("Workspace ready!");
      void navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create workspace");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Loading…
      </div>
    );
  }

  const formValid = orgName.trim().length >= 2 && fullName.trim().length >= 2;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_50%)]" aria-hidden />

      <div className="relative w-full max-w-[440px]">
        <div className="rounded-2xl border border-border/60 bg-card/95 p-8 shadow-xl shadow-black/5 backdrop-blur-md">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/90 to-primary shadow-lg shadow-primary/20">
              <Building2 className="size-7 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold tracking-[-0.03em] text-foreground">
              Set up your workspace
            </h1>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              One last step — tell us about your organization
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="orgName">Organization name</Label>
              <Input
                id="orgName"
                required
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Technologies Pvt. Ltd."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Your full name</Label>
              <Input
                id="fullName"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Rahul Sharma"
              />
            </div>
            <Button type="submit" className="w-full py-5" disabled={submitting || !formValid}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" /> Creating workspace…
                </>
              ) : (
                "Create workspace"
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Signed in as {session.user.email}.{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => void signOut().then(() => navigate({ to: "/login" }))}
            >
              Use a different account
            </button>
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Have an invite?{" "}
          <Link to="/accept-invite" className="font-semibold text-primary hover:underline">
            Accept invite
          </Link>
        </p>
      </div>
    </div>
  );
}
