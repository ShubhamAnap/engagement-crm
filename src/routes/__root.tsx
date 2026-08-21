import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportClientError } from "../lib/error-reporting";
import { useState } from "react";
import { ThemeProvider, themeInitScript } from "@/lib/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { AutomationApprovalBanner } from "@/components/automation/AutomationApprovalBanner";
import { ImpersonationBanner } from "@/components/layout/ImpersonationBanner";
import { MaintenanceBanner } from "@/components/layout/MaintenanceBanner";
import { ChatWidget } from "@/components/ChatWidget";
import { AuthProvider, useAuth } from "@/lib/auth";
import { canAccessPath } from "@/lib/permissions";
import { toast } from "sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportClientError(error, { boundary: "root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Engage CRM" },
      {
        name: "description",
        content:
          "AI-powered customer engagement platform — conversations, leads, knowledge and support.",
      },
      { property: "og:title", content: "Engage CRM" },
      {
        property: "og:description",
        content:
          "AI-powered customer engagement platform — conversations, leads, knowledge and support.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Engage CRM" },
      {
        name: "twitter:description",
        content:
          "AI-powered customer engagement platform — conversations, leads, knowledge and support.",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.png?v=6", type: "image/png", sizes: "48x48" },
      { rel: "icon", href: "/favicon-32.png?v=6", type: "image/png", sizes: "32x32" },
      { rel: "icon", href: "/favicon-16.png?v=6", type: "image/png", sizes: "16x16" },
      { rel: "shortcut icon", href: "/favicon-32.png?v=6", type: "image/png" },
      { rel: "icon", href: "/favicon.ico?v=6", sizes: "any" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png?v=6", sizes: "180x180" },
      { rel: "icon", href: "/favicon-192.png?v=6", type: "image/png", sizes: "192x192" },
    ],
    scripts: [{ children: themeInitScript }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delayDuration={200}>
          <AuthProvider>
            <AuthenticatedShell />
            <Toaster position="bottom-left" />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function AuthenticatedShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { session, loading, profile, signOut } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isLogin = pathname === "/login";
  const isEmbed = pathname === "/embed";
  const isCatalogueShortLink = pathname.startsWith("/c/");
  const isDocShortLink = pathname.startsWith("/d/");
  const isFriendlyFileLink = pathname.startsWith("/f/");
  const isSignup = pathname === "/signup";
  const isForgotPassword = pathname === "/forgot-password";
  const isAuthCallback = pathname === "/auth/callback";
  const isOnboarding = pathname === "/onboarding";
  const isAcceptInvite = pathname === "/accept-invite";
  const isTerms = pathname === "/terms";
  const isPrivacy = pathname === "/privacy";
  const isStatus = pathname === "/status";
  const isPricing = pathname === "/pricing";
  const isFeatures = pathname === "/features";
  const isSupport = pathname === "/support";
  const isDpa = pathname === "/dpa";
  const isPlatform = pathname === "/platform" || pathname.startsWith("/platform/");
  const isPublic =
    isLogin ||
    isSignup ||
    isForgotPassword ||
    isAuthCallback ||
    isOnboarding ||
    isAcceptInvite ||
    isTerms ||
    isPrivacy ||
    isStatus ||
    isPricing ||
    isFeatures ||
    isSupport ||
    isDpa ||
    isEmbed ||
    isCatalogueShortLink ||
    isDocShortLink ||
    isFriendlyFileLink;
  const isAuthFlow = isAuthCallback || isOnboarding || isAcceptInvite;
  const isMinimalShell = isPublic || isPlatform;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!session && !isPublic) {
      void navigate({ to: "/login" });
    }
  }, [loading, session, isPublic, navigate]);

  useEffect(() => {
    if (loading || !session || isPublic) return;
    if (!profile && !isAuthFlow) {
      void navigate({ to: "/onboarding" });
    }
  }, [loading, session, profile, isPublic, isAuthFlow, navigate]);

  useEffect(() => {
    if (loading || !session || !profile || isMinimalShell) return;
    if (profile.isActive === false) {
      toast.error("This account is disabled. Contact your admin.");
      void signOut().then(() => navigate({ to: "/login" }));
      return;
    }
    if (!canAccessPath(profile.role, profile.permissions, pathname)) {
      const fallback = canAccessPath(profile.role, profile.permissions, "/")
        ? "/"
        : canAccessPath(profile.role, profile.permissions, "/inbox")
          ? "/inbox"
          : "/";
      if (pathname !== fallback) {
        toast.message("You do not have access to that page");
        void navigate({ to: fallback });
      }
    }
  }, [loading, session, profile, pathname, isMinimalShell, navigate, signOut]);

  // Close mobile drawer after route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (isMinimalShell) {
    return (
      <>
        <MaintenanceBanner />
        <ImpersonationBanner />
        <Outlet />
      </>
    );
  }

  if (!mounted || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Redirecting to sign in…
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Redirecting to setup…
      </div>
    );
  }

  return (
    <>
      <div className="flex h-dvh max-h-dvh w-full overflow-hidden bg-background">
        <AppSidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-[248px] p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <AppSidebar
              collapsed={false}
              onToggle={() => {}}
              mobile
              onNavigate={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <MaintenanceBanner />
          <ImpersonationBanner />
          <TopBar onOpenMobileNav={() => setMobileOpen(true)} />
          <AutomationApprovalBanner />
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div
              className={
                pathname === "/inbox"
                  ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                  : "min-h-0 flex-1 overflow-y-auto"
              }
            >
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      {pathname !== "/inbox" && pathname !== "/channels" ? <ChatWidget /> : null}
    </>
  );
}
