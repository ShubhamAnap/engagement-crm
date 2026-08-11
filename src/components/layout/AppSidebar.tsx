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
import { useAuth } from "@/lib/auth";
import { countWaitingHandoffs, ENERTECH_ORG_ID } from "@/lib/chat-api";
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
    label: "Commerce",
    items: [
      { to: "/products", label: "Products", icon: Boxes, section: "products" },
      { to: "/customers", label: "Customers", icon: Users, section: "customers" },
      { to: "/leads", label: "Leads", icon: Zap, section: "leads" },
      { to: "/pipeline", label: "Pipeline", icon: KanbanSquare, section: "pipeline" },
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
  const orgShort = profile?.org.short ?? "EnerTech";
  const orgPlan = profile?.org.plan ?? "Enterprise";
  const logoUrl = profile?.org.logoUrl;
  const orgId = profile?.org.id ?? ENERTECH_ORG_ID;

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
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <Link
          to="/"
          onClick={() => onNavigate?.()}
          className="flex min-w-0 items-center gap-2.5"
          aria-label="Go to dashboard"
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              className="size-8 shrink-0 rounded-lg object-contain"
            />
          ) : (
            <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Cpu className="size-4.5" />
            </div>
          )}
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-sidebar-accent-foreground">
                {orgShort}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">{orgPlan} workspace</p>
            </div>
          )}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3" aria-label="Main">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <p className="px-2 pb-1.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
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
                      "group flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    <item.icon
                      className={cn(
                        "size-4.5 shrink-0",
                        active ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && item.badge && (
                      <span className="num ml-auto rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
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

      <div className="border-t border-sidebar-border p-2.5">
        {!mobile && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "w-full justify-start gap-2 text-muted-foreground",
              collapsed && "justify-center",
            )}
          >
            <ChevronsLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
            {!collapsed && <span className="text-xs">Collapse</span>}
          </Button>
        )}
      </div>
    </aside>
  );
}