import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PRODUCT_NAME } from "@/lib/public-site";

export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-3xl">
          <Link to="/features" className="text-sm font-medium text-primary hover:underline">
            ← {PRODUCT_NAME}
          </Link>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">Last updated {updated}</p>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-8">{children}</main>
      <footer className="mx-auto flex max-w-3xl flex-wrap gap-3 px-4 pb-10 text-xs text-muted-foreground sm:px-8">
        <Link to="/terms" className="hover:text-foreground">
          Terms
        </Link>
        <Link to="/privacy" className="hover:text-foreground">
          Privacy
        </Link>
        <Link to="/dpa" className="hover:text-foreground">
          DPA
        </Link>
        <Link to="/support" className="hover:text-foreground">
          Support
        </Link>
        <Link to="/pricing" className="hover:text-foreground">
          Pricing
        </Link>
      </footer>
    </div>
  );
}
