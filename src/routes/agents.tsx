import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Pencil, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader, Panel, Pill, StatCard } from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import { ENERTECH_ORG_ID } from "@/lib/chat-api";
import {
  AGENT_MODEL_OPTIONS,
  defaultPromptForKey,
  listAgentsWithStats,
  setAgentStatus,
  updateAgent,
} from "@/lib/agents-api";
import { allowedToolsFromAgentConfig, listAiTools } from "@/lib/tools-api";
import type { AgentStatus, DbAgent } from "@/lib/db-types";

const statusOptions: AgentStatus[] = ["Active", "Paused", "Degraded"];
const MASTER_KEY = "support";

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [
      { title: "AI Agents — EnerTech Engage" },
      {
        name: "description",
        content: "Purpose-built agents for sales, support, technical, warranty and follow-up workflows.",
      },
      { property: "og:title", content: "AI Agents — EnerTech Engage" },
    ],
  }),
  component: Page,
});

function statusTone(status: AgentStatus): "success" | "warning" | "neutral" {
  if (status === "Active") return "success";
  if (status === "Degraded") return "warning";
  return "neutral";
}

function Page() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.org.id ?? ENERTECH_ORG_ID;

  const [editing, setEditing] = useState<DbAgent | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formStatus, setFormStatus] = useState<AgentStatus>("Active");
  const [formModel, setFormModel] = useState("gpt-4o-mini");
  const [formMemory, setFormMemory] = useState(true);
  const [formPrompt, setFormPrompt] = useState("");
  const [formAllowedTools, setFormAllowedTools] = useState<string[]>([]);

  const agentsQuery = useQuery({
    queryKey: ["agents", orgId],
    queryFn: () => listAgentsWithStats(orgId),
  });

  const toolsQuery = useQuery({
    queryKey: ["ai-tools", orgId],
    queryFn: () => listAiTools(orgId),
  });

  const agents = agentsQuery.data ?? [];
  const enabledTools = (toolsQuery.data ?? []).filter((t) => t.is_enabled);
  const activeCount = agents.filter((a) => a.status === "Active").length;
  const totalReplies = agents.reduce((sum, a) => sum + a.aiMessageCount, 0);
  const assignedThreads = agents.reduce((sum, a) => sum + a.conversationCount, 0);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["agents", orgId] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("No agent selected");
      if (!formName.trim()) throw new Error("Name is required");
      return updateAgent(editing.id, {
        name: formName,
        description: formDesc,
        status: formStatus,
        model: formModel,
        memoryEnabled: formMemory,
        systemPrompt: formPrompt,
        allowedTools: formAllowedTools,
      });
    },
    onSuccess: async () => {
      await invalidate();
      setEditing(null);
      toast.success("Agent saved — chat will use this config");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Save failed"),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AgentStatus }) => setAgentStatus(id, status),
    onSuccess: async (_data, vars) => {
      await invalidate();
      toast.success(vars.status === "Active" ? "Agent activated" : `Agent set to ${vars.status}`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update status"),
  });

  function openEdit(agent: DbAgent) {
    setEditing(agent);
    setFormName(agent.name);
    setFormDesc(agent.description || "");
    setFormStatus(agent.status);
    setFormModel(agent.model || "gpt-4o-mini");
    setFormMemory(agent.memory_enabled);
    setFormPrompt(agent.system_prompt || "");
    setFormAllowedTools(allowedToolsFromAgentConfig(agent.config));
  }

  const modelOptions = useMemo(() => {
    const set = new Set<string>([...AGENT_MODEL_OPTIONS]);
    if (editing?.model) set.add(editing.model);
    return Array.from(set);
  }, [editing?.model]);

  return (
    <>
      <PageHeader
        title="AI Agents"
        description="Support is the Master Agent. Specialists (Sales, Warranty, …) are applied when needed inside the same chat."
        meta={
          <div className="flex flex-wrap gap-2">
            <Pill tone="success" dot>
              {activeCount} active
            </Pill>
            <Pill tone="neutral">{agents.length} total</Pill>
          </div>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={agentsQuery.isFetching}
              onClick={async () => {
                await invalidate();
                toast.success("Agents refreshed");
              }}
            >
              <RefreshCw className={`size-3.5 ${agentsQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/tools">Tools</Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/ai-chat">Open AI Chat</Link>
            </Button>
          </div>
        }
      />

      <div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Active agents" value={String(activeCount)} />
          <StatCard label="Assigned threads" value={String(assignedThreads)} />
          <StatCard label="AI replies (tracked)" value={String(totalReplies)} />
        </div>

        <Panel title="Master + specialists">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Support Agent</span> is the Master: it owns every
            conversation and keeps full memory. When the customer asks about sales, warranty, batteries,
            quotes, etc., the Master applies that specialist’s prompt for that reply — without starting a
            new chat or telling the customer bots switched. Inbox shows{" "}
            <code className="rounded bg-secondary px-1 text-xs">AI · Support → Warranty</code> when a
            specialist is active. Pause a specialist to stop using it; keep Master Active. Allow tools per
            agent under Configure (tools must also be enabled on{" "}
            <Link to="/tools" className="underline underline-offset-2">
              Tools
            </Link>
            ).
          </p>
        </Panel>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agentsQuery.isLoading ? (
            <Panel>
              <p className="text-sm text-muted-foreground">Loading agents…</p>
            </Panel>
          ) : agents.length === 0 ? (
            <div className="sm:col-span-2 xl:col-span-3">
              <EmptyState
                title="No agents"
                description="Run supabase/migrations/003_core_schema.sql to seed Sales, Support, Technical, and other agents."
              />
            </div>
          ) : (
            agents.map((a) => {
              const toggling = statusMutation.isPending && statusMutation.variables?.id === a.id;
              const toolCount = allowedToolsFromAgentConfig(a.config).length;
              return (
                <Panel key={a.id} bodyClassName="p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                      <Bot className="size-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{a.name}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {a.description || `Key: ${a.key}`}
                      </p>
                    </div>
                    <Switch
                      checked={a.status === "Active"}
                      disabled={toggling}
                      aria-label={`Activate ${a.name}`}
                      onCheckedChange={(on) =>
                        statusMutation.mutate({ id: a.id, status: on ? "Active" : "Paused" })
                      }
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {a.key === MASTER_KEY ? <Pill tone="success">Master</Pill> : <Pill tone="neutral">Specialist</Pill>}
                    <Pill tone={statusTone(a.status)} dot>
                      {a.status}
                    </Pill>
                    <Pill tone="neutral">{a.model}</Pill>
                    {a.memory_enabled ? <Pill tone="success">Memory on</Pill> : <Pill tone="neutral">Memory off</Pill>}
                    {a.system_prompt ? <Pill tone="success">Custom prompt</Pill> : <Pill tone="neutral">Default prompt</Pill>}
                    {toolCount > 0 ? (
                      <Pill tone="success">{toolCount} tools</Pill>
                    ) : (
                      <Pill tone="neutral">No tools</Pill>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">Threads</p>
                      <p className="num text-sm font-semibold">{a.conversationCount}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">AI replies</p>
                      <p className="num text-sm font-semibold">{a.aiMessageCount}</p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => openEdit(a)}>
                      <Pencil className="size-3.5" /> Configure
                    </Button>
                  </div>
                </Panel>
              );
            })
          )}
        </div>
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Configure {editing?.name}</DialogTitle>
            <DialogDescription>
              Key <code className="rounded bg-secondary px-1 text-xs">{editing?.key}</code> — used for routing.
              Leave system prompt blank to use the built-in default for this agent.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="ag-name">Display name</Label>
              <Input id="ag-name" value={formName} onChange={(e) => setFormName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ag-desc">Description</Label>
              <Input id="ag-desc" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formStatus} onValueChange={(v: AgentStatus) => setFormStatus(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Model</Label>
                <Select value={formModel} onValueChange={setFormModel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="ag-memory" checked={formMemory} onCheckedChange={setFormMemory} />
              <Label htmlFor="ag-memory" className="font-normal">
                Conversation memory (include prior messages)
              </Label>
            </div>
            <div className="space-y-2">
              <Label>Allowed tools</Label>
              <p className="text-xs text-muted-foreground">
                Only tools enabled on{" "}
                <Link to="/tools" className="underline underline-offset-2">
                  Tools
                </Link>{" "}
                appear here. Chat uses tools allowed on Master or the active specialist.
              </p>
              {toolsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading tools…</p>
              ) : enabledTools.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No globally enabled tools. Enable Calculator (or others) on the Tools page first.
                </p>
              ) : (
                <div className="space-y-2 rounded-md border border-border p-3">
                  {enabledTools.map((tool) => {
                    const checked = formAllowedTools.includes(tool.key);
                    return (
                      <label
                        key={tool.id}
                        className="flex cursor-pointer items-start gap-2 text-sm"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(on) => {
                            setFormAllowedTools((prev) =>
                              on ? [...new Set([...prev, tool.key])] : prev.filter((k) => k !== tool.key),
                            );
                          }}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="font-medium">{tool.name}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {tool.description || tool.key}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="ag-prompt">System prompt</Label>
              <Textarea
                id="ag-prompt"
                rows={6}
                value={formPrompt}
                onChange={(e) => setFormPrompt(e.target.value)}
                placeholder={editing ? defaultPromptForKey(editing.key) : ""}
              />
              {editing && !formPrompt.trim() ? (
                <p className="text-xs text-muted-foreground">Using built-in default for “{editing.key}”.</p>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? "Saving…" : "Save agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
