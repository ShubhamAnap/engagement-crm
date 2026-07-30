import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Textarea } from "@/components/ui/textarea";
import {
  ChannelIcon,
  EmptyState,
  PageHeader,
  Panel,
  Pill,
  ScoreBar,
  TablePagination,
  Toolbar,
} from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import type { ChannelType, DbLead, LeadStatus, PriorityLevel } from "@/lib/db-types";
import { createLead, deleteLead, listLeads, updateLead } from "@/lib/leads-api";

const statusOptions: LeadStatus[] = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won", "Lost"];
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

type LeadFormState = {
  name: string;
  company: string;
  phone: string;
  email: string;
  productLabel: string;
  score: string;
  status: LeadStatus;
  priority: PriorityLevel;
  source: ChannelType;
  nextFollowUpAt: string;
  notes: string;
};

const defaultForm: LeadFormState = {
  name: "",
  company: "",
  phone: "",
  email: "",
  productLabel: "",
  score: "55",
  status: "New",
  priority: "Medium",
  source: "website",
  nextFollowUpAt: "",
  notes: "",
};

export const Route = createFileRoute("/leads")({
  head: () => ({
    meta: [
      { title: "Lead Management — EnerTech Engage" },
      { name: "description", content: "AI-scored leads with source, ownership, product interest and follow-up scheduling." },
      { property: "og:title", content: "Lead Management — EnerTech Engage" },
      { property: "og:description", content: "AI-scored leads with source, ownership, product interest and follow-up scheduling." },
    ],
  }),
  component: Page,
});

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusTone(status: LeadStatus): "success" | "danger" | "primary" | "neutral" {
  if (status === "Won") return "success";
  if (status === "Lost") return "danger";
  if (status === "Qualified" || status === "Proposal" || status === "Negotiation") return "primary";
  return "neutral";
}

function priorityTone(priority: PriorityLevel): "warning" | "neutral" {
  return priority === "High" ? "warning" : "neutral";
}

function toDateTimeLocal(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formFromLead(lead: DbLead): LeadFormState {
  return {
    name: lead.name,
    company: lead.company || "",
    phone: lead.phone || "",
    email: lead.email || "",
    productLabel: lead.product_label || "",
    score: String(lead.score),
    status: lead.status,
    priority: lead.priority,
    source: lead.source || "website",
    nextFollowUpAt: toDateTimeLocal(lead.next_follow_up_at),
    notes: typeof lead.metadata?.notes === "string" ? lead.metadata.notes : "",
  };
}

function Page() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.org.id;
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<DbLead | null>(null);
  const [leadToDelete, setLeadToDelete] = useState<DbLead | null>(null);
  const [form, setForm] = useState<LeadFormState>(defaultForm);

  const leadsQuery = useQuery({
    queryKey: ["leads", orgId],
    enabled: Boolean(orgId),
    queryFn: () => listLeads(orgId!),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !profile) throw new Error("Your profile is still loading");
      if (!form.name.trim()) throw new Error("Lead name is required");
      const score = Number(form.score);
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        throw new Error("Score must be between 0 and 100");
      }
      const payload = {
        orgId,
        ownerId: profile.id,
        name: form.name,
        company: form.company,
        phone: form.phone,
        email: form.email,
        productLabel: form.productLabel,
        score,
        status: form.status,
        priority: form.priority,
        source: form.source,
        nextFollowUpAt: form.nextFollowUpAt ? new Date(form.nextFollowUpAt).toISOString() : null,
        notes: form.notes,
      };
      return editingLead ? updateLead(editingLead.id, payload) : createLead(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["leads", orgId] });
      toast.success(editingLead ? "Lead updated" : "Lead created");
      setDialogOpen(false);
      setEditingLead(null);
      setForm(defaultForm);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not save lead");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (leadId: string) => deleteLead(leadId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["leads", orgId] });
      toast.success("Lead deleted");
      setLeadToDelete(null);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not delete lead");
    },
  });

  const filteredLeads = useMemo(() => {
    const items = leadsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((lead) =>
      [lead.name, lead.company, lead.email, lead.phone, lead.product_label, lead.external_ref]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [leadsQuery.data, search]);

  const openCreate = () => {
    setEditingLead(null);
    setForm(defaultForm);
    setDialogOpen(true);
  };

  const openEdit = (lead: DbLead) => {
    setEditingLead(lead);
    setForm(formFromLead(lead));
    setDialogOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Lead Management"
        description="AI-scored leads with source, ownership, product interest and follow-up scheduling."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" /> New lead
          </Button>
        }
      />
      <div className="space-y-4 p-6">
        <Panel bodyClassName="p-0">
          <Toolbar
            placeholder="Search leads by name, company or product…"
            value={search}
            onChange={setSearch}
            right={
              <Button size="sm" variant="outline" onClick={() => toast("Bulk assign comes next")}>
                Bulk assign
              </Button>
            }
          />

          {leadsQuery.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading leads…</div>
          ) : filteredLeads.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={search ? "No matching leads" : "No leads yet"}
                description={search ? "Try a different search term." : "Create your first lead to start tracking pipeline activity."}
              />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5"><Checkbox aria-label="Select all" disabled /></th>
                      {["Score","Status","Priority","Source","Name","Company","Phone","Interested","Owner","Last activity","Next follow-up","Actions"].map((h) => (
                        <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredLeads.map((lead) => (
                      <tr key={lead.id} className="hover:bg-secondary/40">
                        <td className="px-4 py-3"><Checkbox aria-label={`Select ${lead.name}`} disabled /></td>
                        <td className="px-4 py-3"><ScoreBar score={lead.score} /></td>
                        <td className="px-4 py-3"><Pill tone={statusTone(lead.status)}>{lead.status}</Pill></td>
                        <td className="px-4 py-3"><Pill tone={priorityTone(lead.priority)}>{lead.priority}</Pill></td>
                        <td className="px-4 py-3"><ChannelIcon channel={lead.source ?? "website"} className="text-muted-foreground" /></td>
                        <td className="px-4 py-3 font-medium whitespace-nowrap">{lead.name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{lead.company || "—"}</td>
                        <td className="num px-4 py-3 text-muted-foreground whitespace-nowrap">{lead.phone || "—"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{lead.product_label || "—"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{lead.owner_id === profile?.id ? "You" : "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDateTime(lead.last_activity_at)}</td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDateTime(lead.next_follow_up_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => openEdit(lead)}>
                              <Pencil className="size-4" /> Edit
                            </Button>
                            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setLeadToDelete(lead)}>
                              <Trash2 className="size-4" /> Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination total={filteredLeads.length} shown={filteredLeads.length} />
            </>
          )}
        </Panel>
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingLead(null);
            setForm(defaultForm);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLead ? "Edit lead" : "New lead"}</DialogTitle>
            <DialogDescription>{editingLead ? "Update this lead in Supabase." : "Create a real lead record in Supabase."}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="lead-name">Lead name</Label>
              <Input id="lead-name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} placeholder="Customer name" />
            </div>
            <div className="space-y-2"><Label htmlFor="lead-company">Company</Label><Input id="lead-company" value={form.company} onChange={(e) => setForm((s) => ({ ...s, company: e.target.value }))} placeholder="Company name" /></div>
            <div className="space-y-2"><Label htmlFor="lead-phone">Phone</Label><Input id="lead-phone" value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} placeholder="Phone number" /></div>
            <div className="space-y-2"><Label htmlFor="lead-email">Email</Label><Input id="lead-email" type="email" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} placeholder="Email address" /></div>
            <div className="space-y-2"><Label htmlFor="lead-product">Interested product</Label><Input id="lead-product" value={form.productLabel} onChange={(e) => setForm((s) => ({ ...s, productLabel: e.target.value }))} placeholder="UPS / battery / service" /></div>
            <div className="space-y-2"><Label htmlFor="lead-score">Score</Label><Input id="lead-score" type="number" min="0" max="100" value={form.score} onChange={(e) => setForm((s) => ({ ...s, score: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Status</Label><Select value={form.status} onValueChange={(value: LeadStatus) => setForm((s) => ({ ...s, status: value }))}><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger><SelectContent>{statusOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Priority</Label><Select value={form.priority} onValueChange={(value: PriorityLevel) => setForm((s) => ({ ...s, priority: value }))}><SelectTrigger><SelectValue placeholder="Select priority" /></SelectTrigger><SelectContent>{priorityOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Source</Label><Select value={form.source} onValueChange={(value: ChannelType) => setForm((s) => ({ ...s, source: value }))}><SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger><SelectContent>{sourceOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="lead-followup">Next follow-up</Label><Input id="lead-followup" type="datetime-local" value={form.nextFollowUpAt} onChange={(e) => setForm((s) => ({ ...s, nextFollowUpAt: e.target.value }))} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="lead-notes">Notes</Label><Textarea id="lead-notes" value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} placeholder="Qualification notes, requirement summary, or callback context" /></div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saveMutation.isPending}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>{saveMutation.isPending ? "Saving…" : editingLead ? "Update lead" : "Create lead"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(leadToDelete)} onOpenChange={(open) => !open && setLeadToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete lead?</AlertDialogTitle>
            <AlertDialogDescription>{leadToDelete ? `This will permanently delete ${leadToDelete.name} from the pipeline.` : "This action cannot be undone."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(e) => { e.preventDefault(); if (leadToDelete) deleteMutation.mutate(leadToDelete.id); }}>{deleteMutation.isPending ? "Deleting…" : "Delete"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
