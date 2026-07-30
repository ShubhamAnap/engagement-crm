import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  Check,
  CircleUser,
  Command as CommandIcon,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { useTheme } from "@/lib/theme";
import { currentUser } from "@/data/mock";
import { Pill } from "@/components/shared/ui-kit";

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
  { label: "Human Support", to: "/human-support" },
  { label: "Reports", to: "/reports" },
  { label: "Settings", to: "/settings" },
];

const notifications = [
  { title: "Escalation from AI · Technical Agent", body: "CV-4820 · Sunrise Hospitals · confidence 0.41", time: "4m", unread: true },
  { title: "Webhook endpoint failing", body: "orders-sync returned 502 three times", time: "22m", unread: true },
  { title: "Quotation QT-1182 viewed", body: "Metro Datacenters opened the proposal", time: "1h", unread: false },
  { title: "Datasheets re-indexed", body: "3,210 chunks embedded successfully", time: "2h", unread: false },
];

export function TopBar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

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
            <DropdownMenuItem onSelect={() => toast.success("New lead form opened")}>
              New lead
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toast.success("Quotation draft created")}>
              New quotation
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate({ to: "/knowledge" })}>
              Upload knowledge document
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate({ to: "/automation" })}>
              New automation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
              <Bell className="size-[18px]" />
              <span className="absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-background" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-88 p-0">
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <p className="text-sm font-semibold">Notifications</p>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                <Check className="size-3.5" /> Mark all read
              </Button>
            </div>
            <ul className="max-h-80 overflow-y-auto">
              {notifications.map((n) => (
                <li
                  key={n.title}
                  className="border-b border-border px-3 py-2.5 last:border-0 hover:bg-secondary/60"
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
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>

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
                <AvatarFallback className="bg-primary/15 text-[11px] font-semibold text-primary">
                  {currentUser.initials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-left lg:block">
                <span className="block text-xs font-medium leading-tight">{currentUser.name}</span>
                <span className="block text-[11px] leading-tight text-muted-foreground">
                  {currentUser.role}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="flex flex-col gap-1">
              <span>{currentUser.name}</span>
              <span className="text-xs font-normal text-muted-foreground">{currentUser.email}</span>
              <Pill tone="primary" className="mt-1 w-fit">
                {currentUser.role}
              </Pill>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <CircleUser className="size-4" /> Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <Settings className="size-4" /> Workspace settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => toast("Signed out of this device")}>
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