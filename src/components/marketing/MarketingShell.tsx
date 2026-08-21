import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PRODUCT_NAME, SUPPORT_EMAIL } from "@/lib/public-site";

const NAV = [
  { to: "/features" as const, label: "Features" },
  { to: "/pricing" as const, label: "Pricing" },
  { to: "/support" as const, label: "Support" },
];

export function MarketingShell({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  const width = wide ? "max-w-5xl" : "max-w-3xl";

  return (
    <div className="min-h-screen bg-background">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,color-mix(in_oklab,var(--primary)_14%,transparent),transparent_55%)]"
        aria-hidden
      />
      <header className="relative border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className={`mx-auto flex ${width} items-center justify-between gap-4 px-4 py-4 sm:px-8`}>
          <Link to="/features" className="flex items-center gap-2.5">
            <span className="et-grad flex size-9 items-center justify-center rounded-xl shadow-md shadow-primary/20">
              <span className="text-sm font-bold text-et-grad-fg">E</span>
            </span>
            <span className="text-sm font-semibold tracking-tight text-foreground">{PRODUCT_NAME}</span>
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-muted-foreground sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="transition-colors hover:text-foreground"
                activeProps={{ className: "text-foreground font-medium" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              Start free
            </Link>
          </div>
        </div>
        <nav className="flex gap-4 overflow-x-auto border-t border-border/60 px-4 py-2 text-xs text-muted-foreground sm:hidden">
          {NAV.map((item) => (
            <Link key={item.to} to={item.to} className="shrink-0 hover:text-foreground">
              {item.label}
            </Link>
          ))}
          <Link to="/login" className="shrink-0 hover:text-foreground">
            Sign in
          </Link>
        </nav>
      </header>

      <main className={`relative mx-auto ${width} px-4 py-10 sm:px-8`}>{children}</main>

      <footer className="relative border-t border-border/70">
        <div
          className={`mx-auto flex ${width} flex-col gap-3 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8`}
        >
          <p>
            © {new Date().getFullYear()} {PRODUCT_NAME}. Multi-tenant engagement for growing teams.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link to="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link to="/dpa" className="hover:text-foreground">
              DPA
            </Link>
            <Link to="/status" className="hover:text-foreground">
              Status
            </Link>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-foreground">
              {SUPPORT_EMAIL}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
