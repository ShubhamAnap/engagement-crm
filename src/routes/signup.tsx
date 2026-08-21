import { useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBrowserSupabase } from "@/lib/supabase";
import { isBusinessEmail } from "@/lib/auth-email";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { AuthBrandMark } from "@/components/auth/AuthBrandMark";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create your workspace" },
      { name: "description", content: "Sign up and create your organization." },
    ],
  }),
  component: SignupPage,
});

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function SignupPage() {
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [phoneError, setPhoneError] = useState("");

  function validateEmail(value: string) {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) { setEmailError(""); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError("Enter a valid email address");
      return;
    }
    if (!isBusinessEmail(trimmed)) {
      setEmailError("Please use your business email (not Gmail, Yahoo, etc.)");
      return;
    }
    setEmailError("");
  }

  function validatePhone(value: string) {
    if (!value.trim()) { setPhoneError(""); return; }
    if (!isValidPhone(value)) {
      setPhoneError("Enter a valid mobile number (10-15 digits)");
      return;
    }
    setPhoneError("");
  }

  async function handleGoogleSignup() {
    const supabase = getBrowserSupabase();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) toast.error(error.message);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();

    if (!isBusinessEmail(trimmedEmail)) {
      setEmailError("Please use your business email (not Gmail, Yahoo, etc.)");
      return;
    }
    if (phone.trim() && !isValidPhone(phone)) {
      setPhoneError("Enter a valid mobile number");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName, fullName, email: trimmedEmail, password, phone: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Signup failed");
        setSubmitting(false);
        return;
      }

      const supabase = getBrowserSupabase();
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (error) {
        toast.error("Account created but sign-in failed. Please log in manually.");
        void navigate({ to: "/login" });
        return;
      }

      toast.success("Welcome! Your workspace is ready.");
      void navigate({ to: "/" });
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const formValid =
    orgName.trim().length >= 2 &&
    fullName.trim().length >= 2 &&
    email.trim().length > 5 &&
    !emailError &&
    !phoneError &&
    password.length >= 8;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* Premium background effects */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_50%)]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,color-mix(in_oklab,var(--primary)_8%,transparent),transparent_50%)]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:radial-gradient(circle_at_1px_1px,color-mix(in_oklab,var(--foreground)_12%,transparent)_1px,transparent_0)] [background-size:24px_24px]" aria-hidden />

      <div className="relative w-full max-w-[440px]">
        {/* Card */}
        <div className="rounded-2xl border border-border/60 bg-card/95 p-8 shadow-xl shadow-black/5 backdrop-blur-md">
          <AuthBrandMark
            title="Create your workspace"
            subtitle="Get started free — no credit card required"
          />

          {/* Google signup */}
          <Button
            type="button"
            variant="outline"
            className="mb-6 w-full gap-3 rounded-xl border-border/80 py-5 text-sm font-medium shadow-sm transition-all hover:bg-accent/60 hover:shadow"
            onClick={handleGoogleSignup}
          >
            <svg className="size-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84Z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z" fill="#EA4335" />
            </svg>
            Continue with Google
          </Button>

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border/60" /></div>
            <div className="relative flex justify-center"><span className="bg-card px-3 text-xs text-muted-foreground">or sign up with email</span></div>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="orgName" className="text-xs font-medium">Organization name</Label>
              <Input
                id="orgName"
                required
                className="rounded-lg border-border/70 py-2.5 shadow-sm transition-shadow focus:shadow"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Technologies Pvt. Ltd."
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fullName" className="text-xs font-medium">Full name</Label>
              <Input
                id="fullName"
                required
                className="rounded-lg border-border/70 py-2.5 shadow-sm transition-shadow focus:shadow"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Rahul Sharma"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-medium">Work email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                className={`rounded-lg border-border/70 py-2.5 shadow-sm transition-shadow focus:shadow ${emailError ? "border-destructive focus-visible:ring-destructive/30" : ""}`}
                value={email}
                onChange={(e) => { setEmail(e.target.value); validateEmail(e.target.value); }}
                onBlur={() => validateEmail(email)}
                placeholder="you@company.com"
              />
              {emailError && <p className="text-xs text-destructive">{emailError}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone" className="text-xs font-medium">Mobile number</Label>
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                className={`rounded-lg border-border/70 py-2.5 shadow-sm transition-shadow focus:shadow ${phoneError ? "border-destructive focus-visible:ring-destructive/30" : ""}`}
                value={phone}
                onChange={(e) => { setPhone(e.target.value); validatePhone(e.target.value); }}
                onBlur={() => validatePhone(phone)}
                placeholder="+91 98765 43210"
              />
              {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-medium">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  className="rounded-lg border-border/70 py-2.5 pr-10 shadow-sm transition-shadow focus:shadow"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {password.length > 0 && password.length < 8 && (
                <p className="text-xs text-muted-foreground">At least 8 characters required</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full rounded-xl py-5 text-sm font-semibold shadow-md shadow-primary/15 transition-all hover:shadow-lg hover:shadow-primary/20"
              disabled={submitting || !formValid}
            >
              {submitting ? (
                <><Loader2 className="mr-2 size-4 animate-spin" /> Creating workspace…</>
              ) : (
                "Create workspace"
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-[13px] text-muted-foreground">
            By signing up, you agree to our{" "}
            <Link to="/terms" className="text-primary hover:underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link to="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>

        {/* Bottom link */}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>
        </p>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          <Link to="/features" className="hover:underline">
            Product
          </Link>
          {" · "}
          <Link to="/pricing" className="hover:underline">
            Pricing
          </Link>
          {" · "}
          <Link to="/support" className="hover:underline">
            Support
          </Link>
        </p>
      </div>
    </div>
  );
}
