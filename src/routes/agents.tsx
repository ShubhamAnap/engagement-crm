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
import {
  SPECIALIST_ROUTING_HINTS,
  previewSpecialistKey,
  routingHintForKey,
} from "@/lib/agent-routing";
import { allowedToolsFromAgentConfig, listAiTools } from "@/lib/tools-api";
import type { AgentStatus, DbAgent } from "@/lib/db-types";

const statusOptions: AgentStatus[] = ["Active", "Paused"];
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
  const isAdmin = profile?.role === "Admin";

  const [editing, setEditing] = useState<DbAgent | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formStatus, setFormStatus] = useState<AgentStatus>("Active");
  const [formModel, setFormModel] = useState("gpt-4o-mini");
  const [formMemory, setFormMemory] = useState(true);
  const [formPrompt, setFormPrompt] = useState("");
  const [formAllowedTools, setFormAllowedTools] = useState<string[]>([]);
  const [classifyText, setClassifyText] = useState("");
  const [classifyChannel, setClassifyChannel] = useState("whatsapp");

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
  const enabledToolKeys = useMemo(() => new Set(enabledTools.map((t) => t.key)), [enabledTools]);
  const masterAgent = agents.find((a) => a.key === MASTER_KEY) || null;
  const masterToolKeys = allowedToolsFromAgentConfig(masterAgent?.config);
  const activeCount = agents.filter((a) => a.status === "Active").length;
  const totalReplies = agents.reduce((sum, a) => sum + a.aiMessageCount, 0);
  const assignedThreads = agents.reduce((sum, a) => sum + a.conversationCount, 0);

  const classifyPreview = useMemo(() => {
    if (!classifyText.trim()) return null;
    const key = previewSpecialistKey(classifyChannel, classifyText);
    if (!key) return { key: null as string | null, label: "Master (Support) only", status: null as string | null };
    const agent = agents.find((a) => a.key === key);
    return {
      key,
      label: agent?.name || key,
      status: agent?.status || "missing",
      when: routingHintForKey(key),
    };
  }, [classifyText, classifyChannel, agents]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["agents", orgId] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!isAdmin) throw new Error("Only Admin can save agent config");
      if (!editing) throw new Error("No agent selected");
      if (!formName.trim()) throw new Error("Name is required");
      return updateAgent(editing.id, {
        name: formName,
        description: formDesc,
        status: formStatus === "Degraded" ? "Paused" : formStatus,
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
    mutationFn: ({ id, status }: { id: string; status: AgentStatus }) => {
      if (!isAdmin) throw new Error("Only Admin can change agent status");
      return setAgentStatus(id, status);
    },
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
    setFormStatus(agent.status === "Degraded" ? "Paused" : agent.status);
    setFormModel(agent.model || "gpt-4o-mini");
    setFormMemory(agent.memory_enabled);
    setFormPrompt(agent.system_prompt || "");
    setFormAllowedTools(allowedToolsFromAgentConfig(agent.config));
  }

  function requestStatusToggle(agent: DbAgent, on: boolean) {
    if (!isAdmin) {
      toast.error("Only Admin can change agent status");
      return;
    }
    if (agent.key === MASTER_KEY && !on) {
      if (
        !confirm(
          "Pause Master (Support)? All channels will lose the primary AI orchestrator until you activate it again.",
        )
      ) {
        return;
      }
    }
    statusMutation.mutate({ id: agent.id, status: on ? "Active" : "Paused" });
  }

  function effectiveToolsFor(agent: DbAgent): string[] {
    const own = allowedToolsFromAgentConfig(agent.config).filter((k) => enabledToolKeys.has(k));
    if (agent.key === MASTER_KEY) return own;
    const union = new Set([...masterToolKeys.filter((k) => enabledToolKeys.has(k)), ...own]);
    return [...union];
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
        description="Support is the Master Agent. Specialists are applied per message inside the same chat — customers never see a bot switch."
        meta={
          <div className="flex flex-wrap gap-2">
            <Pill tone="success" dot>
              {activeCount} active
            </Pill>
            <Pill tone="neutral">{agents.length} total</Pill>
            {!isAdmin ? <Pill tone="warning">View only</Pill> : null}
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

        <Panel title="Architecture — Master + specialists">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Master (Support)</span> owns every thread and
              memory. Inbox label stays on Support; specialist appears as{" "}
              <code className="rounded bg-secondary px-1 text-xs">AI · Support → …</code>.
            </li>
            <li>
              Specialists only add a domain brief for that reply. Pause a specialist to stop routing to it;
              keep Master Active.
            </li>
            <li>
              <span className="font-medium text-foreground">Follow-up (chat)</span> specialist ≠{" "}
              <Link to="/automation" className="underline underline-offset-2">
                Automation → Follow-up Agent
              </Link>{" "}
              daily campaign. Chat prompt does not send outbound WA campaigns.
            </li>
            <li>
              Tools = globally enabled on{" "}
              <Link to="/tools" className="underline underline-offset-2">
                Tools
              </Link>{" "}
              ∩ allowed on Master or the active specialist (union at runtime).
            </li>
            {!isAdmin ? (
              <li className="text-amber-700 dark:text-amber-400">
                Only Admin can save prompts, tools, or pause/activate agents.
              </li>
            ) : null}
          </ul>
        </Panel>

        <Panel title="When each specialist fires" description="Priority order — first match wins (same as production).">
          <ul className="space-y-1.5 text-sm">
            {SPECIALIST_ROUTING_HINTS.map((h, i) => (
              <li key={h.key} className="flex gap-2">
                <span className="num w-5 shrink-0 text-muted-foreground">{i + 1}.</span>
                <span>
                  <span className="font-medium text-foreground">{h.label}</span>
                  <span className="text-muted-foreground"> — {h.when}</span>
                </span>
              </li>
            ))}
            <li className="flex gap-2 text-muted-foreground">
              <span className="num w-5 shrink-0">—</span>
              <span>No match → Master (Support) alone</span>
            </li>
          </ul>
        </Panel>

        <Panel title="Test classify" description="Preview which specialist a customer message would pick (no API call).">
          <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select value={classifyChannel} onValueChange={setClassifyChannel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="website">Website</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="classify-msg">Sample customer message</Label>
              <Input
                id="classify-msg"
                value={classifyText}
                onChange={(e) => setClassifyText(e.target.value)}
                placeholder="e.g. Battery runtime for 5kVA UPS?"
              />
            </div>
          </div>
          {classifyPreview ? (
            <p className="mt-3 text-sm">
              Result:{" "}
              <span className="font-medium text-foreground">{classifyPreview.label}</span>
              {classifyPreview.key ? (
                <span className="text-muted-foreground">
                  {" "}
                  ({classifyPreview.key}
                  {classifyPreview.status === "Paused" || classifyPreview.status === "missing"
                    ? ` — ${classifyPreview.status === "missing" ? "not seeded" : "Paused, Master will handle"}`
                    : ""}
                  )
                </span>
              ) : null}
              {classifyPreview.when ? (
                <span className="mt-1 block text-xs text-muted-foreground">{classifyPreview.when}</span>
              ) : null}
            </p>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">Type a message to preview routing.</p>
          )}
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
              const effective = effectiveToolsFor(a);
              const hint =
                a.key === MASTER_KEY
                  ? "Owns every conversation; used when no specialist matches"
                  : routingHintForKey(a.key);
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
                      disabled={toggling || !isAdmin}
                      aria-label={`Activate ${a.name}`}
                      onCheckedChange={(on) => requestStatusToggle(a, on)}
                    />
                  </div>

                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Fires when: {hint}
                  </p>
                  {a.key === "followup" ? (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                      Chat specialist only — daily WA campaigns live under Automation.
                    </p>
                  ) : null}
                  {a.status === "Degraded" ? (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                      Legacy “Degraded” status — switch Active/Paused to clear (health pipeline not wired yet).
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {a.key === MASTER_KEY ? (
                      <Pill tone="success">Master</Pill>
                    ) : (
                      <Pill tone="neutral">Specialist</Pill>
                    )}
                    <Pill tone={statusTone(a.status)} dot>
                      {a.status}
                    </Pill>
                    <Pill tone="neutral">{a.model}</Pill>
                    {a.memory_enabled ? (
                      <Pill tone="success">Memory on</Pill>
                    ) : (
                      <Pill tone="neutral">Memory off</Pill>
                    )}
                    {a.system_prompt ? (
                      <Pill tone="success">Custom prompt</Pill>
                    ) : (
                      <Pill tone="neutral">Default prompt</Pill>
                    )}
                    {toolCount > 0 ? (
                      <Pill tone="success">{toolCount} allowed</Pill>
                    ) : (
                      <Pill tone="neutral">No tools</Pill>
                    )}
                  </div>

                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Effective tools (runtime):{" "}
                    {effective.length ? effective.join(", ") : "none"}
                    {a.key !== MASTER_KEY ? " · includes Master allow-list" : ""}
                  </p>

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
                  {a.key !== MASTER_KEY ? (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Threads count is Master-owned; specialist utilization shows in Inbox labels / Inspector.
                    </p>
                  ) : null}

                  <div className="mt-3">
                    <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => openEdit(a)}>
                      <Pencil className="size-3.5" /> {isAdmin ? "Configure" : "View"}
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
            <DialogTitle>
              {isAdmin ? "Configure" : "View"} {editing?.name}
            </DialogTitle>
            <DialogDescription>
              Key <code className="rounded bg-secondary px-1 text-xs">{editing?.key}</code>
              {editing?.key === MASTER_KEY
                ? " — Master orchestrator."
                : ` — fires when: ${routingHintForKey(editing?.key || "")}.`}
              {!isAdmin ? " Admin can edit." : " Leave system prompt blank for built-in default."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="ag-name">Display name</Label>
              <Input
                id="ag-name"
                value={formName}
                disabled={!isAdmin}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ag-desc">Description</Label>
              <Input
                id="ag-desc"
                value={formDesc}
                disabled={!isAdmin}
                onChange={(e) => setFormDesc(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={formStatus}
                  disabled={!isAdmin}
                  onValueChange={(v: AgentStatus) => setFormStatus(v)}
                >
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
                <Select value={formModel} disabled={!isAdmin} onValueChange={setFormModel}>
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
              <Switch
                id="ag-memory"
                checked={formMemory}
                disabled={!isAdmin}
                onCheckedChange={setFormMemory}
              />
              <Label htmlFor="ag-memory" className="font-normal">
                Conversation memory (include prior messages)
              </Label>
            </div>
            <div className="space-y-2">
              <Label>Allowed tools</Label>
              <p className="text-xs text-muted-foreground">
                Chat uses tools allowed on Master <strong>or</strong> the active specialist (union), and only
                if enabled on Tools.
              </p>
              {editing ? (
                <p className="text-xs text-muted-foreground">
                  Effective now:{" "}
                  {effectiveToolsFor(editing).length
                    ? effectiveToolsFor(editing).join(", ")
                    : "none"}
                </p>
              ) : null}
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
                          disabled={!isAdmin}
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
                disabled={!isAdmin}
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
            {isAdmin ? (
              <Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending ? "Saving…" : "Save agent"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
