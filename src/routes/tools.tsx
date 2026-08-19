import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Globe2, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState, PageHeader, Panel, Pill, StatCard } from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import { ENERTECH_ORG_ID } from "@/lib/chat-api";
import { listAgents } from "@/lib/agents-api";
import {
  allowedToolsFromAgentConfig,
  ensureDefaultAiTools,
  listAiTools,
  listAgentsUsingTool,
  setAiToolEnabled,
  stripToolFromAllAgents,
  toolRuntimeHint,
  type DbAiTool,
} from "@/lib/tools-api";

export const Route = createFileRoute("/tools")({
  head: () => ({
    meta: [
      { title: "Tools" },
      {
        name: "description",
        content: "Global AI tools (Calculator, Web search). Enable tools here; allow them per agent under AI Agents.",
      },
      { property: "og:title", content: "Tools" },
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
  const isAdmin = profile?.role === "Admin";
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

  const agentsQuery = useQuery({
    queryKey: ["agents", orgId],
    queryFn: () => listAgents(orgId),
  });

  const tools = toolsQuery.data ?? [];
  const agents = agentsQuery.data ?? [];
  const enabledCount = tools.filter((t) => t.is_enabled).length;

  const agentsByTool = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const tool of tools) {
      const names = agents
        .filter((a) => allowedToolsFromAgentConfig(a.config).includes(tool.key))
        .map((a) => a.name);
      map.set(tool.key, names);
    }
    return map;
  }, [tools, agents]);

  const toggleMutation = useMutation({
    mutationFn: async ({ tool, enabled }: { tool: DbAiTool; enabled: boolean }) => {
      if (!isAdmin) throw new Error("Only Admin can enable or disable tools");
      const row = await setAiToolEnabled({ toolId: tool.id, enabled });
      if (!enabled) {
        const using = await listAgentsUsingTool(tool.key, orgId);
        if (using.length > 0) {
          const names = using.map((a) => a.name).join(", ");
          const clean = confirm(
            `${tool.name} is still listed on: ${names}.\n\nRemove it from those agents' allow-lists now?`,
          );
          if (clean) {
            const n = await stripToolFromAllAgents(tool.key, orgId);
            toast.message(`Cleared ${tool.name} from ${n} agent(s)`);
          } else {
            toast.message("Left stale allow-list entries — they stay inactive while the tool is off");
          }
        }
      }
      return row;
    },
    onSuccess: async (_row, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ai-tools", orgId] }),
        queryClient.invalidateQueries({ queryKey: ["agents", orgId] }),
      ]);
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
        meta={
          <div className="flex flex-wrap gap-2">
            <Pill tone="success" dot>
              {enabledCount} enabled
            </Pill>
            <Pill tone="neutral">{tools.length} total</Pill>
            {!isAdmin ? <Pill tone="warning">View only</Pill> : null}
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
              Chat uses only the intersection: globally on <strong>and</strong> allowed on Master or the
              active specialist (union). Answer Inspector shows tools used per reply.
            </li>
            <li>
              Run migration <code className="rounded bg-secondary px-1">021_ai_tools.sql</code> once in Supabase
              if this page errors.
            </li>
            {!isAdmin ? (
              <li className="text-warning">Only Admin can toggle tools on or off.</li>
            ) : null}
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
              isAdmin ? (
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
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {tools.map((tool) => {
              const Icon = toolIcon(tool.key);
              const busy =
                toggleMutation.isPending && toggleMutation.variables?.tool.id === tool.id;
              const runtime = toolRuntimeHint(tool.key);
              const using = agentsByTool.get(tool.key) || [];
              const stale = !tool.is_enabled && using.length > 0;
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
                      disabled={busy || !isAdmin}
                      aria-label={`Enable ${tool.name}`}
                      onCheckedChange={(on) => {
                        if (!isAdmin) {
                          toast.error("Only Admin can toggle tools");
                          return;
                        }
                        toggleMutation.mutate({ tool, enabled: on });
                      }}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Pill tone={tool.is_enabled ? "success" : "neutral"} dot>
                      {tool.is_enabled ? "Enabled globally" : "Disabled globally"}
                    </Pill>
                    <Pill tone={runtime.ready || !tool.is_enabled ? "neutral" : "warning"}>
                      {runtime.detail}
                    </Pill>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Allowed on agents:{" "}
                    {using.length ? using.join(", ") : "none yet — tick under Agents → Configure"}
                  </p>
                  {stale ? (
                    <p className="mt-1 text-xs text-warning">
                      Stale allow-list while disabled — toggle off again and choose “Remove” to clean, or
                      re-enable the tool.
                    </p>
                  ) : null}
                </Panel>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
