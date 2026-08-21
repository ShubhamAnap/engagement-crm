import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  Bot,
  BookOpen,
  Boxes,
  Calculator,
  ChevronsLeft,
  Cpu,
  FileBarChart,
  Headphones,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Radio,
  Settings,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth, useOrgId } from "@/lib/auth";
import { countWaitingHandoffs } from "@/lib/chat-api";
import { canAccessPath, type AppSectionKey } from "@/lib/permissions";

type Item = { to: string; label: string; icon: typeof Inbox; badge?: string; section?: AppSectionKey };

const groupsBase: { label: string; items: Item[] }[] = [
  {
    label: "Operate",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, section: "dashboard" },
      { to: "/command-center", label: "AI Command Center", icon: Activity, section: "command-center" },
      { to: "/inbox", label: "Inbox", icon: Inbox, section: "inbox" },
      { to: "/ai-chat", label: "AI Chat Support", icon: MessagesSquare, section: "ai-chat" },
      { to: "/human-support", label: "Human Support", icon: Headphones, section: "human-support" },
    ],
  },
  {
    label: "Commerce",
    items: [
      { to: "/products", label: "Products", icon: Boxes, section: "products" },
      { to: "/customers", label: "Customers", icon: Users, section: "customers" },
      { to: "/leads", label: "Leads", icon: Zap, section: "leads" },
      { to: "/pipeline", label: "Pipeline", icon: KanbanSquare, section: "pipeline" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/agents", label: "AI Agents", icon: Bot, section: "agents" },
      { to: "/tools", label: "Tools", icon: Cpu, section: "tools" },
      { to: "/formulas", label: "Formulas", icon: Calculator, section: "formulas" },
      { to: "/knowledge", label: "Knowledge Base", icon: BookOpen, section: "knowledge" },
      { to: "/automation", label: "Automation", icon: Workflow, section: "automation" },
      { to: "/broadcasting", label: "Broadcasting", icon: Megaphone, section: "broadcasting" },
    ],
  },
  {
    label: "Insight",
    items: [
      { to: "/analytics", label: "Analytics", icon: BarChart3, section: "analytics" },
      { to: "/reports", label: "Reports", icon: FileBarChart, section: "reports" },
      { to: "/channels", label: "Channels", icon: Radio, section: "channels" },
      { to: "/settings", label: "Settings", icon: Settings, section: "settings" },
    ],
  },
];

export function AppSidebar({
  collapsed,
  onToggle,
  mobile = false,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle: () => void;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { profile } = useAuth();
  const orgShort = profile?.org.short ?? "Engage";
  const orgPlan = profile?.org.plan ?? "Enterprise";
  const logoUrl = profile?.org.logoUrl;
  const orgId = useOrgId();

  const waitingQuery = useQuery({
    queryKey: ["waiting-handoffs", orgId],
    queryFn: () => countWaitingHandoffs(orgId),
    refetchInterval: 15_000,
    enabled: Boolean(profile),
  });
  const waitingCount = waitingQuery.data ?? 0;

  const groups = groupsBase
    .map((group) => {
      const items = group.items
        .map((item) =>
          item.to === "/human-support"
            ? { ...item, badge: waitingCount > 0 ? String(waitingCount) : undefined }
            : item,
        )
        .filter((item) => {
          if (!profile) return false;
          if (profile.role === "Admin") return true;
          if (!item.section) return true;
          return canAccessPath(profile.role, profile.permissions, item.to);
        });
      return { ...group, items };
    })
    .filter((group) => group.items.length > 0);

  return (
    <aside
      className={cn(
        "sticky top-0 h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200",
        mobile ? "flex w-[248px]" : "hidden md:flex",
        collapsed ? "w-[68px]" : "w-[248px]",
        mobile && "w-[248px]",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center border-b border-sidebar-border",
          collapsed && !mobile ? "flex-col gap-1 px-2 py-2.5" : "h-14 gap-2 px-3",
        )}
      >
        <Link
          to="/"
          onClick={() => onNavigate?.()}
          className={cn(
            "flex min-w-0 items-center gap-2.5",
            collapsed && !mobile ? "justify-center" : "flex-1",
          )}
          aria-label="Go to dashboard"
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              className="size-8 shrink-0 rounded-lg object-contain ring-1 ring-sidebar-border"
            />
          ) : (
            <div className="et-grad grid size-8 shrink-0 place-items-center rounded-lg shadow-sm">
              <span className="text-xs font-bold text-et-grad-fg" aria-hidden>
                {(orgShort || "E").charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-sidebar-accent-foreground">
                {orgShort}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                Engage · {orgPlan}
              </p>
            </div>
          )}
        </Link>
        {!mobile && (
          <Button
            variant="ghost"
            size={collapsed ? "icon" : "sm"}
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "shrink-0 text-muted-foreground",
              collapsed ? "size-8" : "ml-auto h-8 gap-1.5 px-2",
            )}
          >
            <ChevronsLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
            {!collapsed && <span className="text-xs">Collapse</span>}
          </Button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3" aria-label="Main">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <p className="px-2 pb-1.5 text-[10px] font-medium tracking-[0.12em] text-muted-foreground/80 uppercase">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                const link = (
                  <Link
                    to={item.to}
                    onClick={() => onNavigate?.()}
                    className={cn(
                      "group flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-150",
                      active
                        ? "et-grad text-et-grad-fg shadow-sm"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    <item.icon
                      className={cn(
                        "size-4.5 shrink-0",
                        active ? "text-et-grad-fg" : "text-muted-foreground",
                      )}
                    />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && item.badge && (
                      <span
                        className={cn(
                          "num ml-auto rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                          active
                            ? "bg-et-grad-fg/20 text-et-grad-fg"
                            : "bg-primary/15 text-primary",
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
                return (
                  <li key={item.to}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent side="right">{item.label}</TooltipContent>
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}