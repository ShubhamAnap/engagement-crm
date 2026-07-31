import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Check,
  CircleUser,
  Command as CommandIcon,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Palette,
  Plus,
  Search,
  Settings,
  ShieldAlert,
  Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { COLOR_PALETTES, useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { Pill } from "@/components/shared/ui-kit";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
} from "@/lib/notifications-api";
import { listPendingApprovals } from "@/lib/automations-api";

const searchTargets = [
  { label: "Dashboard", to: "/" },
  { label: "AI Command Center", to: "/command-center" },
  { label: "Inbox", to: "/inbox" },
  { label: "AI Chat Support", to: "/ai-chat" },
  { label: "AI Agents", to: "/agents" },
  { label: "Knowledge Base", to: "/knowledge" },
  { label: "Products", to: "/products" },
  { label: "Customers", to: "/customers" },
  { label: "Leads", to: "/leads" },
  { label: "Pipeline", to: "/pipeline" },
  { label: "Analytics", to: "/analytics" },
  { label: "Automation", to: "/automation" },
  { label: "Channels", to: "/channels" },
  { label: "Broadcasting", to: "/broadcasting" },
  { label: "Human Support", to: "/human-support" },
  { label: "Reports", to: "/reports" },
  { label: "Settings", to: "/settings" },
];

export function TopBar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const [open, setOpen] = useState(false);
  const { theme, setTheme, palette, setPalette } = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile, signOut } = useAuth();

  const displayName = profile?.fullName ?? "User";
  const displayEmail = profile?.email ?? "";
  const displayRole = profile?.role ?? "Agent";
  const displayInitials = profile?.initials ?? "?";
  const displayAvatar = profile?.avatarUrl ?? null;
  const orgId = profile?.org.id;
  const userId = profile?.id;

  const notificationsQuery = useQuery({
    queryKey: ["notifications", orgId, userId],
    queryFn: () => listNotifications(orgId!, userId!),
    enabled: Boolean(orgId && userId),
    refetchInterval: 20_000,
  });

  const approvalsQuery = useQuery({
    queryKey: ["automation-approvals", orgId],
    queryFn: () => listPendingApprovals(orgId!),
    enabled: Boolean(orgId),
    refetchInterval: 15_000,
  });

  const notifications = notificationsQuery.data ?? [];
  const unreadCount = notifications.filter((n) => n.unread).length;
  const pendingApprovals = approvalsQuery.data?.length ?? 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </Button>

      <button
        onClick={() => setOpen(true)}
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary md:max-w-md"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">Search conversations, leads, products…</span>
        <kbd className="num ml-auto hidden shrink-0 items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] sm:inline-flex">
          <CommandIcon className="size-3" />K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="hidden gap-1.5 sm:inline-flex">
              <Plus className="size-4" /> Quick action
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Create</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => navigate({ to: "/leads" })}>
              New lead
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate({ to: "/inbox" })}>
              Open inbox
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate({ to: "/knowledge" })}>
              Upload knowledge document
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate({ to: "/automation" })}>
              New automation
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate({ to: "/channels" })}>
              Website embed code
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Automation approvals"
          title={
            pendingApprovals
              ? `${pendingApprovals} campaign(s) waiting for approval`
              : "No pending automation approvals"
          }
          onClick={() => {
            if (pendingApprovals > 0) {
              document
                .querySelector("[data-automation-approvals]")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            } else {
              navigate({ to: "/automation" });
            }
          }}
        >
          <ShieldAlert className="size-[18px]" />
          {pendingApprovals > 0 ? (
            <span className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white ring-2 ring-background">
              {pendingApprovals > 9 ? "9+" : pendingApprovals}
            </span>
          ) : null}
        </Button>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
              <Bell className="size-[18px]" />
              {unreadCount > 0 ? (
                <span className="absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-background" />
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-88 p-0">
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <p className="text-sm font-semibold">
                Notifications
                {unreadCount > 0 ? (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    ({unreadCount})
                  </span>
                ) : null}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                disabled={unreadCount === 0 || !userId}
                onClick={() => {
                  if (!userId) return;
                  markAllNotificationsRead(userId, notifications);
                  void queryClient.invalidateQueries({ queryKey: ["notifications"] });
                }}
              >
                <Check className="size-3.5" /> Mark all read
              </Button>
            </div>
            <ul className="max-h-80 overflow-y-auto">
              {notificationsQuery.isLoading ? (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</li>
              ) : notifications.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No alerts right now — escalations, new leads, and handoffs will show here.
                </li>
              ) : (
                notifications.map((n) => (
                  <li key={n.id} className="border-b border-border last:border-0">
                    <button
                      type="button"
                      className="w-full px-3 py-2.5 text-left hover:bg-secondary/60"
                      onClick={() => {
                        if (userId) {
                          markNotificationsRead(userId, [n.id]);
                          void queryClient.invalidateQueries({ queryKey: ["notifications"] });
                        }
                        if (n.to === "/inbox" && n.search?.c) {
                          navigate({ to: "/inbox", search: { c: n.search.c } });
                        } else {
                          navigate({ to: n.to });
                        }
                      }}
                    >
                      <div className="flex items-start gap-2">
                        {n.unread ? (
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                        ) : (
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-transparent" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{n.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{n.body}</p>
                        </div>
                        <span className="num ml-auto shrink-0 text-[11px] text-muted-foreground">
                          {n.time}
                        </span>
                      </div>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Choose color theme">
              <Palette className="size-[18px]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Color theme</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {COLOR_PALETTES.map((item) => (
              <DropdownMenuItem key={item.id} onSelect={() => setPalette(item.id)}>
                <span
                  className="size-3.5 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: item.swatch }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-tight">{item.label}</span>
                  <span className="block text-[11px] leading-tight text-muted-foreground">{item.description}</span>
                </span>
                {palette === item.id ? <Check className="ml-auto size-3.5" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Toggle theme">
              <Sun className="size-[18px] scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
              <Moon className="absolute size-[18px] scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={() => setTheme("light")}>
              <Sun className="size-4" /> Light {theme === "light" && <Check className="ml-auto size-3.5" />}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme("dark")}>
              <Moon className="size-4" /> Dark {theme === "dark" && <Check className="ml-auto size-3.5" />}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme("system")}>
              <Monitor className="size-4" /> System{" "}
              {theme === "system" && <Check className="ml-auto size-3.5" />}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-secondary">
              <Avatar className="size-7">
                {displayAvatar ? <AvatarImage src={displayAvatar} alt="" /> : null}
                <AvatarFallback className="bg-primary/15 text-[11px] font-semibold text-primary">
                  {displayInitials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-left lg:block">
                <span className="block text-xs font-medium leading-tight">{displayName}</span>
                <span className="block text-[11px] leading-tight text-muted-foreground">
                  {displayRole}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="flex flex-col gap-1">
              <span>{displayName}</span>
              <span className="text-xs font-normal text-muted-foreground">{displayEmail}</span>
              <Pill tone="primary" className="mt-1 w-fit">
                {displayRole}
              </Pill>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings" search={{ tab: "profile" }}>
                <CircleUser className="size-4" /> Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/settings" search={{ tab: "company" }}>
                <Settings className="size-4" /> Workspace settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void (async () => {
                  await signOut();
                  toast.success("Signed out");
                  navigate({ to: "/login" });
                })();
              }}
            >
              <LogOut className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Jump to a module, conversation or lead…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigation">
            {searchTargets.map((t) => (
              <CommandItem
                key={t.to}
                value={t.label}
                onSelect={() => {
                  setOpen(false);
                  navigate({ to: t.to });
                }}
              >
                {t.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </header>
  );
}