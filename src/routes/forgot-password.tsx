import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBrowserSupabase } from "@/lib/supabase";
import { ArrowLeft, Loader2, Mail } from "lucide-react";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset password" },
      { name: "description", content: "Reset your account password." },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    setSubmitting(true);
    try {
      const supabase = getBrowserSupabase();
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: `${window.location.origin}/login`,
      });
      if (error) {
        toast.error(error.message);
      } else {
        setSent(true);
        toast.success("Reset link sent! Check your email.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      {/* Premium background */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_50%)]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,color-mix(in_oklab,var(--primary)_8%,transparent),transparent_50%)]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:radial-gradient(circle_at_1px_1px,color-mix(in_oklab,var(--foreground)_12%,transparent)_1px,transparent_0)] [background-size:24px_24px]" aria-hidden />

      <div className="relative w-full max-w-[440px]">
        <div className="rounded-2xl border border-border/60 bg-card/95 p-8 shadow-xl shadow-black/5 backdrop-blur-md">
          {sent ? (
            /* Success state */
            <div className="flex flex-col items-center text-center">
              <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10">
                <Mail className="size-7 text-emerald-600" />
              </div>
              <h1 className="text-2xl font-bold tracking-[-0.03em] text-foreground">
                Check your email
              </h1>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                We sent a password reset link to<br />
                <span className="font-medium text-foreground">{email.trim().toLowerCase()}</span>
              </p>
              <p className="mt-4 text-xs text-muted-foreground">
                Didn't receive the email? Check your spam folder or{" "}
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => setSent(false)}
                >
                  try again
                </button>
              </p>
              <Link
                to="/login"
                className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
              >
                <ArrowLeft className="size-4" /> Back to sign in
              </Link>
            </div>
          ) : (
            /* Form state */
            <>
              <div className="mb-8 flex flex-col items-center text-center">
                <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/90 to-primary shadow-lg shadow-primary/20">
                  <Mail className="size-7 text-primary-foreground" />
                </div>
                <h1 className="text-2xl font-bold tracking-[-0.03em] text-foreground">
                  Reset your password
                </h1>
                <p className="mt-1.5 text-[13px] text-muted-foreground">
                  Enter your email and we'll send you a reset link
                </p>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-medium">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    autoFocus
                    className="rounded-lg border-border/70 py-2.5 shadow-sm transition-shadow focus:shadow"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full rounded-xl py-5 text-sm font-semibold shadow-md shadow-primary/15 transition-all hover:shadow-lg hover:shadow-primary/20"
                  disabled={submitting || !email.trim()}
                >
                  {submitting ? (
                    <><Loader2 className="mr-2 size-4 animate-spin" /> Sending reset link…</>
                  ) : (
                    "Send reset link"
                  )}
                </Button>
              </form>

              <Link
                to="/login"
                className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="size-4" /> Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
