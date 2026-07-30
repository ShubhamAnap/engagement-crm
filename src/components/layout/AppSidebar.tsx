import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Bot,
  BookOpen,
  Boxes,
  ChevronsLeft,
  Cpu,
  FileBarChart,
  Headphones,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
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
import { org } from "@/data/mock";

type Item = { to: string; label: string; icon: typeof Inbox; badge?: string };

const groups: { label: string; items: Item[] }[] = [
  {
    label: "Operate",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard },
      { to: "/command-center", label: "AI Command Center", icon: Activity, badge: "5" },
      { to: "/inbox", label: "Inbox", icon: Inbox, badge: "12" },
      { to: "/ai-chat", label: "AI Chat Support", icon: MessagesSquare },
      { to: "/human-support", label: "Human Support", icon: Headphones, badge: "2" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/agents", label: "AI Agents", icon: Bot },
      { to: "/knowledge", label: "Knowledge Base", icon: BookOpen },
      { to: "/automation", label: "Automation", icon: Workflow },
    ],
  },
  {
    label: "Commerce",
    items: [
      { to: "/products", label: "Products", icon: Boxes },
      { to: "/customers", label: "Customers", icon: Users },
      { to: "/leads", label: "Leads", icon: Zap },
      { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
    ],
  },
  {
    label: "Insight",
    items: [
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/reports", label: "Reports", icon: FileBarChart },
      { to: "/channels", label: "Channels", icon: Radio },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function AppSidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex",
        collapsed ? "w-[68px]" : "w-[248px]",
      )}
    >
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Cpu className="size-4.5" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-sidebar-accent-foreground">
              {org.short}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">{org.plan} workspace</p>
          </div>
        )}
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
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn("w-full justify-start gap-2 text-muted-foreground", collapsed && "justify-center")}
        >
          <ChevronsLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
          {!collapsed && <span className="text-xs">Collapse</span>}
        </Button>
      </div>
    </aside>
  );
}