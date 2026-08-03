import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Globe2, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState, PageHeader, Panel, Pill, StatCard } from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import { ENERTECH_ORG_ID } from "@/lib/chat-api";
import {
  ensureDefaultAiTools,
  listAiTools,
  setAiToolEnabled,
  type DbAiTool,
} from "@/lib/tools-api";

export const Route = createFileRoute("/tools")({
  head: () => ({
    meta: [
      { title: "Tools — EnerTech Engage" },
      {
        name: "description",
        content: "Global AI tools (Calculator, Web search). Enable tools here; allow them per agent under AI Agents.",
      },
      { property: "og:title", content: "Tools — EnerTech Engage" },
    ],
  }),
  component: Page,
});

function toolIcon(key: string) {
  if (key === "calculator") return Calculator;
  if (key === "web_search") return Globe2;
  return Wrench;
}

function Page() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.org.id ?? ENERTECH_ORG_ID;
  const [bootstrapped, setBootstrapped] = useState(false);

  const toolsQuery = useQuery({
    queryKey: ["ai-tools", orgId],
    queryFn: async () => {
      try {
        return await listAiTools(orgId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/021_ai_tools|does not exist|schema cache/i.test(msg) && !bootstrapped) {
          setBootstrapped(true);
          return ensureDefaultAiTools(orgId);
        }
        throw err;
      }
    },
  });

  const tools = toolsQuery.data ?? [];
  const enabledCount = tools.filter((t) => t.is_enabled).length;

  const toggleMutation = useMutation({
    mutationFn: ({ tool, enabled }: { tool: DbAiTool; enabled: boolean }) =>
      setAiToolEnabled({ toolId: tool.id, enabled }),
    onSuccess: async (_row, vars) => {
      await queryClient.invalidateQueries({ queryKey: ["ai-tools", orgId] });
      toast.success(
        vars.enabled
          ? `${vars.tool.name} enabled — allow it on agents that should use it`
          : `${vars.tool.name} disabled for all agents`,
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update tool"),
  });

  return (
    <>
      <PageHeader
        title="Tools"
        description="Global toolbox for AI agents. Turn tools on here, then allow them per agent under AI Agents → Configure."
        meta={
          <div className="flex flex-wrap gap-2">
            <Pill tone="success" dot>
              {enabledCount} enabled
            </Pill>
            <Pill tone="neutral">{tools.length} total</Pill>
          </div>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={toolsQuery.isFetching}
              onClick={async () => {
                await queryClient.invalidateQueries({ queryKey: ["ai-tools", orgId] });
                toast.success("Tools refreshed");
              }}
            >
              <RefreshCw className={`size-3.5 ${toolsQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/agents">Configure agents</Link>
            </Button>
          </div>
        }
      />

      <div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Tools" value={String(tools.length)} />
          <StatCard label="Enabled" value={String(enabledCount)} />
          <StatCard label="Disabled" value={String(Math.max(0, tools.length - enabledCount))} />
        </div>

        <Panel title="How tools work">
          <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
            <li>
              Enable a tool on this page (global allow). Disabled tools cannot be used by any agent.
            </li>
            <li>
              Open <strong>AI Agents → Configure</strong> and tick which enabled tools that agent may use.
            </li>
            <li>
              Chat uses only the intersection: globally on <strong>and</strong> allowed on the agent (master +
              specialist stack).
            </li>
            <li>
              Run migration <code className="rounded bg-secondary px-1">021_ai_tools.sql</code> once in Supabase
              if this page errors.
            </li>
          </ol>
        </Panel>

        {toolsQuery.isLoading ? (
          <Panel>
            <p className="text-sm text-muted-foreground">Loading tools…</p>
          </Panel>
        ) : toolsQuery.isError ? (
          <EmptyState
            title="Could not load tools"
            description={
              toolsQuery.error instanceof Error
                ? toolsQuery.error.message
                : "Run 021_ai_tools.sql in Supabase SQL Editor."
            }
          />
        ) : tools.length === 0 ? (
          <EmptyState
            title="No tools yet"
            description="Run migration 021_ai_tools.sql to seed Calculator and Web search."
            action={
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await ensureDefaultAiTools(orgId);
                    await queryClient.invalidateQueries({ queryKey: ["ai-tools", orgId] });
                    toast.success("Default tools created");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Seed failed");
                  }
                }}
              >
                Seed default tools
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {tools.map((tool) => {
              const Icon = toolIcon(tool.key);
              const busy =
                toggleMutation.isPending && toggleMutation.variables?.tool.id === tool.id;
              return (
                <Panel key={tool.id} bodyClassName="p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                      <Icon className="size-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{tool.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <code className="rounded bg-secondary px-1">{tool.key}</code>
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {tool.description || "No description"}
                      </p>
                    </div>
                    <Switch
                      checked={tool.is_enabled}
                      disabled={busy}
                      aria-label={`Enable ${tool.name}`}
                      onCheckedChange={(on) => toggleMutation.mutate({ tool, enabled: on })}
                    />
                  </div>
                  <div className="mt-3">
                    <Pill tone={tool.is_enabled ? "success" : "neutral"} dot>
                      {tool.is_enabled ? "Enabled globally" : "Disabled globally"}
                    </Pill>
                  </div>
                </Panel>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
