import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Facebook,
  Globe,
  Inbox as InboxIcon,
  Instagram,
  Mail,
  MessageCircle,
  Search,
  SlidersHorizontal,
  ArrowUpDown,
  Store,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="border-b border-border bg-background/80 px-6 py-5 backdrop-blur">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-[19px] font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{description}</p>
          ) : null}
          {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        className,
      )}
    >
      {title ? (
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
            {description ? (
              <p className="truncate text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  delta,
  trend,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down";
  hint?: string;
  icon?: LucideIcon;
}) {
  const good = trend === "up";
  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="num text-2xl font-semibold text-foreground">{value}</span>
        {delta ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium",
              good ? "text-success" : "text-destructive",
            )}
          >
            {good ? (
              <ArrowUpRight className="size-3.5" />
            ) : (
              <ArrowDownRight className="size-3.5" />
            )}
            {delta}
          </span>
        ) : null}
      </div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const toneMap = {
  neutral: "bg-secondary text-secondary-foreground border-transparent",
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/14 text-warning border-warning/25",
  danger: "bg-destructive/12 text-destructive border-destructive/25",
  info: "bg-info/12 text-info border-info/25",
  primary: "bg-primary/12 text-primary border-primary/25",
} as const;

export type Tone = keyof typeof toneMap;

export function Pill({
  children,
  tone = "neutral",
  dot,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        toneMap[tone],
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export const channelMeta: Record<
  string,
  { label: string; icon: LucideIcon; tone: Tone }
> = {
  website: { label: "Website", icon: Globe, tone: "info" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, tone: "success" },
  email: { label: "Email", icon: Mail, tone: "neutral" },
  instagram: { label: "Instagram", icon: Instagram, tone: "danger" },
  facebook: { label: "Facebook", icon: Facebook, tone: "info" },
  indiamart: { label: "IndiaMART", icon: Store, tone: "warning" },
  api: { label: "API", icon: Globe, tone: "primary" },
  webhook: { label: "Webhook", icon: Globe, tone: "warning" },
};

export function ChannelIcon({ channel, className }: { channel: string; className?: string }) {
  const meta = channelMeta[channel] ?? channelMeta.website;
  const Icon = meta.icon;
  return <Icon className={cn("size-4", className)} aria-label={meta.label} />;
}

export function ScoreBar({ score }: { score: number }) {
  const tone = score >= 80 ? "bg-success" : score >= 60 ? "bg-warning" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-secondary">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${score}%` }} />
      </div>
      <span className="num text-xs text-muted-foreground">{score}</span>
    </div>
  );
}

export function Toolbar({
  placeholder = "Search…",
  value,
  onChange,
  right,
  children,
  filter,
  sort,
}: {
  placeholder?: string;
  value?: string;
  onChange?: (v: string) => void;
  right?: ReactNode;
  children?: ReactNode;
  /** Custom Filter control. Pass `null` to hide. Omit for default inert button. */
  filter?: ReactNode | null;
  /** Custom Sort control. Pass `null` to hide. Omit for default inert button. */
  sort?: ReactNode | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
      <div className="relative min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          className="h-9 pl-8"
          aria-label={placeholder}
        />
      </div>
      {children}
      {filter === null
        ? null
        : (filter ?? (
            <Button variant="outline" size="sm" className="h-9 gap-1.5" type="button" disabled>
              <SlidersHorizontal className="size-4" /> Filter
            </Button>
          ))}
      {sort === null
        ? null
        : (sort ?? (
            <Button variant="outline" size="sm" className="h-9 gap-1.5" type="button" disabled>
              <ArrowUpDown className="size-4" /> Sort
            </Button>
          ))}
      {right}
    </div>
  );
}

export function TablePagination({ total, shown }: { total: number; shown: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
      <span>
        Showing <span className="num text-foreground">{shown}</span> of{" "}
        <span className="num text-foreground">{total}</span> records
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="size-8" aria-label="Previous page" disabled>
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="secondary" size="icon" className="size-8" aria-label="Page 1">
          1
        </Button>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Page 2" disabled title="Pagination coming soon">
          2
        </Button>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Page 3" disabled title="Pagination coming soon">
          3
        </Button>
        <Button variant="outline" size="icon" className="size-8" aria-label="Next page" disabled title="Pagination coming soon">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = InboxIcon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="grid size-11 place-items-center rounded-xl border border-border bg-secondary">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}