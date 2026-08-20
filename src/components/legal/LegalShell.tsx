import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

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
          <Link to="/login" className="text-sm font-medium text-primary hover:underline">
            ← Engage CRM
          </Link>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">Last updated {updated}</p>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-8">{children}</main>
    </div>
  );
}
