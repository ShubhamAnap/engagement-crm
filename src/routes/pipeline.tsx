import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { EmptyState, PageHeader, Pill, ScoreBar } from "@/components/shared/ui-kit";
import { ChannelBrandMark } from "@/components/shared/ChannelBrandMark";
import { getChannelBrand } from "@/lib/channel-brand";
import { useAuth } from "@/lib/auth";
import type { ChannelType, DbLead, LeadStatus, PriorityLevel } from "@/lib/db-types";
import { createLead, listLeads, updateLeadStatus } from "@/lib/leads-api";

const PIPELINE_STAGES: Array<{ status: LeadStatus; title: string; tint: string }> = [
  { status: "New", title: "New", tint: "bg-sky-500/8 border-sky-500/25" },
  { status: "Contacted", title: "Contacted", tint: "bg-indigo-500/8 border-indigo-500/25" },
  { status: "Qualified", title: "Qualified", tint: "bg-violet-500/8 border-violet-500/25" },
  { status: "Proposal", title: "Proposal", tint: "bg-warning/8 border-warning/25" },
  { status: "Negotiation", title: "Negotiation", tint: "bg-orange-500/8 border-orange-500/25" },
  { status: "Won", title: "Won", tint: "bg-success/10 border-success/30" },
  { status: "Lost", title: "Lost", tint: "bg-muted/60 border-border" },
];

const priorityOptions: PriorityLevel[] = ["High", "Medium", "Low"];
const sourceOptions: Array<{ value: ChannelType; label: string }> = [
  { value: "website", label: "Website" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "api", label: "API" },
  { value: "webhook", label: "Webhook" },
];

type DealForm = {
  name: string;
  company: string;
  phone: string;
  email: string;
  productLabel: string;
  priority: PriorityLevel;
  source: ChannelType;
  score: string;
};

const defaultForm: DealForm = {
  name: "",
  company: "",
  phone: "",
  email: "",
  productLabel: "",
  priority: "Medium",
  source: "website",
  score: "55",
};

export const Route = createFileRoute("/pipeline")({
  head: () => ({
    meta: [
      { title: "Sales Pipeline" },
      { name: "description", content: "Drag leads across stages from first touch to closed won." },
      { property: "og:title", content: "Sales Pipeline" },
      { property: "og:description", content: "Drag leads across stages from first touch to closed won." },
    ],
  }),
  component: Page,
});

function priorityTone(priority: PriorityLevel): "danger" | "warning" | "neutral" {
  if (priority === "High") return "danger";
  if (priority === "Medium") return "warning";
  return "neutral";
}

function Page() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.org.id;
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<DealForm>(defaultForm);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<LeadStatus | null>(null);

  const leadsQuery = useQuery({
    queryKey: ["leads", orgId],
    enabled: Boolean(orgId),
    queryFn: () => listLeads(orgId!),
  });

  const leads = useMemo(() => {
    const items = leadsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((lead) =>
      [lead.name, lead.company, lead.product_label, lead.email, lead.phone, lead.external_ref]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [leadsQuery.data, search]);

  const byStage = useMemo(() => {
    const map = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.status, [] as DbLead[]])) as Record<
      LeadStatus,
      DbLead[]
    >;
    for (const lead of leads) {
      (map[lead.status] ?? map.New).push(lead);
    }
    return map;
  }, [leads]);

  const moveMutation = useMutation({
    mutationFn: async ({ leadId, status }: { leadId: string; status: LeadStatus }) =>
      updateLeadStatus(leadId, status),
    onMutate: async ({ leadId, status }) => {
      await queryClient.cancelQueries({ queryKey: ["leads", orgId] });
      const previous = queryClient.getQueryData<DbLead[]>(["leads", orgId]);
      queryClient.setQueryData<DbLead[]>(["leads", orgId], (old) =>
        (old ?? []).map((lead) =>
          lead.id === leadId ? { ...lead, status, last_activity_at: new Date().toISOString() } : lead,
        ),
      );
      return { previous };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["leads", orgId], ctx.previous);
      toast.error(error instanceof Error ? error.message : "Could not move lead");
    },
    onSuccess: (lead) => {
      toast.success(`Moved to ${lead.status}`);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["leads", orgId] });
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Your profile is still loading");
      if (!form.name.trim()) throw new Error("Name is required");
      const score = Number(form.score);
      if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error("Score must be 0–100");
      return createLead({
        orgId,
        ownerId: profile?.id ?? null,
        name: form.name,
        company: form.company,
        phone: form.phone,
        email: form.email,
        productLabel: form.productLabel,
        priority: form.priority,
        source: form.source,
        score,
        status: "New",
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["leads", orgId] });
      setCreateOpen(false);
      setForm(defaultForm);
      toast.success("Deal created in New");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not create deal"),
  });

  function onDropToStage(status: LeadStatus) {
    if (!draggingId) return;
    const lead = (leadsQuery.data ?? []).find((l) => l.id === draggingId);
    setDropTarget(null);
    setDraggingId(null);
    if (!lead || lead.status === status) return;
    moveMutation.mutate({ leadId: draggingId, status });
  }

  const openCount = leads.filter((l) => l.status !== "Won" && l.status !== "Lost").length;
  const wonCount = byStage.Won.length;

  return (
    <>
      <PageHeader
        title="Sales Pipeline"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to="/leads">All leads</Link>
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" /> New deal
            </Button>
          </div>
        }
      />

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search deals…"
            className="h-9 max-w-xs"
          />
          <p className="text-xs text-muted-foreground">
            <span className="num font-medium text-foreground">{openCount}</span> open ·{" "}
            <span className="num font-medium text-foreground">{wonCount}</span> won
          </p>
        </div>

        {leadsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading pipeline…</p>
        ) : (leadsQuery.data ?? []).length === 0 ? (
          <EmptyState
            title="No leads yet"
            description="Create a deal here or capture one from Website chat — it will appear in New."
            action={
              <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
                <Plus className="size-3.5" /> New deal
              </Button>
            }
          />
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {PIPELINE_STAGES.map((stage) => {
              const cards = byStage[stage.status] ?? [];
              const isTarget = dropTarget === stage.status;
              return (
                <div
                  key={stage.status}
                  className={`min-w-[240px] max-w-[260px] flex-1 rounded-xl border p-2.5 transition-colors ${
                    isTarget ? "border-primary bg-primary/5" : stage.tint
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropTarget(stage.status);
                  }}
                  onDragLeave={() => {
                    if (dropTarget === stage.status) setDropTarget(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    onDropToStage(stage.status);
                  }}
                >
                  <div className="mb-2 flex items-center justify-between px-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{stage.title}</p>
                    <span className="num text-xs text-muted-foreground">{cards.length}</span>
                  </div>
                  <div className="min-h-[120px] space-y-2">
                    {cards.map((lead) => (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={() => setDraggingId(lead.id)}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDropTarget(null);
                        }}
                        className={`cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm active:cursor-grabbing ${
                          draggingId === lead.id ? "opacity-60" : ""
                        }`}
                        style={{ boxShadow: `inset 3px 0 0 ${getChannelBrand(lead.source).accent}` }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-medium">{lead.company || lead.name}</p>
                          <div className="flex shrink-0 items-center gap-1">
                            <ChannelBrandMark channel={lead.source} size="sm" />
                            <Pill tone={priorityTone(lead.priority)}>{lead.priority}</Pill>
                          </div>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {lead.name}
                          {lead.product_label ? ` · ${lead.product_label}` : ""}
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="num text-sm font-semibold">{lead.value_label || "—"}</span>
                          <ScoreBar score={Math.round(Number(lead.score) || 0)} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Select
                            value={lead.status}
                            onValueChange={(status: LeadStatus) => {
                              if (status !== lead.status) {
                                moveMutation.mutate({ leadId: lead.id, status });
                              }
                            }}
                          >
                            <SelectTrigger className="h-7 w-[120px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PIPELINE_STAGES.map((s) => (
                                <SelectItem key={s.status} value={s.status}>
                                  {s.title}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ))}
                    {cards.length === 0 ? (
                      <p className="px-1 py-8 text-center text-xs text-muted-foreground">Drop deals here</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setForm(defaultForm);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New deal</DialogTitle>
            <DialogDescription>Creates a lead in the New stage (same table as Lead Management).</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="deal-name">Contact name</Label>
              <Input id="deal-name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} placeholder="Priya Sharma" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deal-company">Company</Label>
              <Input id="deal-company" value={form.company} onChange={(e) => setForm((s) => ({ ...s, company: e.target.value }))} placeholder="Sunrise Hospitals" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deal-product">Product interest</Label>
              <Input id="deal-product" value={form.productLabel} onChange={(e) => setForm((s) => ({ ...s, productLabel: e.target.value }))} placeholder="EN-3000X" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deal-phone">Phone</Label>
              <Input id="deal-phone" value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deal-email">Email</Label>
              <Input id="deal-email" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={(value: PriorityLevel) => setForm((s) => ({ ...s, priority: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {priorityOptions.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Source</Label>
              <Select value={form.source} onValueChange={(value: ChannelType) => setForm((s) => ({ ...s, source: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sourceOptions.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="deal-score">Score</Label>
              <Input id="deal-score" type="number" min="0" max="100" value={form.score} onChange={(e) => setForm((s) => ({ ...s, score: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Creating…" : "Create deal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
