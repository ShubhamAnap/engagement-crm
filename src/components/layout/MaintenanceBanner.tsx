import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info, Wrench } from "lucide-react";
import { getPublicMaintenanceBanner } from "@/server/platform-settings";
import { cn } from "@/lib/utils";

/** Platform-wide maintenance / outage notice. Shown on every shell including login. */
export function MaintenanceBanner() {
  const query = useQuery({
    queryKey: ["platform-maintenance-banner"],
    queryFn: () => getPublicMaintenanceBanner(),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: false,
  });

  const data = query.data;
  if (!data?.enabled || !data.message.trim()) return null;

  const Icon =
    data.severity === "critical"
      ? AlertTriangle
      : data.severity === "warning"
        ? Wrench
        : Info;

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 border-b px-4 py-2.5 text-sm",
        data.severity === "critical" &&
          "border-destructive/40 bg-destructive/10 text-destructive",
        data.severity === "warning" &&
          "border-amber-500/40 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50",
        data.severity === "info" &&
          "border-sky-500/30 bg-sky-50 text-sky-950 dark:bg-sky-950/40 dark:text-sky-50",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1 font-medium leading-snug">{data.message.trim()}</p>
    </div>
  );
}
