import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — EnerTech Engage" },
      { name: "description", content: "Sign in to EnerTech Engage." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { signIn, session, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && session) {
      void navigate({ to: "/" });
    }
  }, [loading, session, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await signIn(email.trim(), password);
    setSubmitting(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Signed in");
    void navigate({ to: "/" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 grid size-12 place-items-center rounded-xl bg-primary text-lg font-semibold tracking-tight text-primary-foreground">
            E
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">EnerTech Engage</h1>
          <p className="mt-1 text-sm text-muted-foreground">EnerTech UPS workspace</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@enertechups.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting || loading}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
