import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Plus, Trash2, Upload, UserPlus } from "lucide-react";
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
  TablePagination,
  Toolbar,
} from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import type { ChannelType, LeadStatus, PriorityLevel } from "@/lib/db-types";
import {
  bulkAssignLeads,
  bulkUpdateLeadStatus,
  createLead,
  deleteLead,
  downloadLeadsCsv,
  listLeads,
  listOrgSalesPeople,
  updateLead,
  type LeadRow,
} from "@/lib/leads-api";
import {
  downloadLeadsImportTemplate,
  importLeadsFromCsv,
  MAX_IMPORT_ROWS,
} from "@/lib/leads-import";

const statusOptions: LeadStatus[] = [
  "New",
  "Contacted",
  "Qualified",
  "Proposal",
  "Negotiation",
  "Won",
  "Lost",
];
const priorityOptions: PriorityLevel[] = ["High", "Medium", "Low"];
const sourceOptions: Array<{ value: ChannelType; label: string }> = [
  { value: "website", label: "Website" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "indiamart", label: "IndiaMART" },
  { value: "tradeindia", label: "TradeIndia" },
  { value: "brainmine", label: "Brainmine CRM+" },
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
  requirement: string;
  location: string;
  salesPerson: string;
  ownerId: string;
  tags: string;
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
  requirement: "",
  location: "",
  salesPerson: "",
  ownerId: "",
  tags: "",
  status: "New",
  priority: "Medium",
  source: "website",
  nextFollowUpAt: "",
  notes: "",
};

export const Route = createFileRoute("/leads")({
  head: () => ({
    meta: [
      { title: "Leads (Master) — EnerTech Engage" },
      {
        name: "description",
        content:
          "Master lead sheet: company, contact, source, requirement, salesperson, status, notes and tags.",
      },
      { property: "og:title", content: "Leads (Master) — EnerTech Engage" },
    ],
  }),
  component: Page,
});

function statusTone(status: LeadStatus): "success" | "danger" | "primary" | "neutral" | "warning" {
  if (status === "Won") return "success";
  if (status === "Lost") return "danger";
  if (status === "New") return "warning";
  if (status === "Qualified" || status === "Proposal" || status === "Negotiation") return "primary";
  return "neutral";
}

function toDateTimeLocal(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formFromLead(lead: LeadRow): LeadFormState {
  return {
    name: lead.name,
    company: lead.company || "",
    phone: lead.phone || "",
    email: lead.email || "",
    requirement: lead.requirement || lead.product_label || "",
    location: lead.location || "",
    salesPerson: lead.sales_person || lead.owner_name || "",
    ownerId: lead.owner_id || "",
    tags: (lead.tags || []).join(", "),
    status: lead.status,
    priority: lead.priority,
    source: lead.source || "website",
    nextFollowUpAt: toDateTimeLocal(lead.next_follow_up_at),
    notes: lead.notes || (typeof lead.metadata?.notes === "string" ? lead.metadata.notes : ""),
  };
}

function Page() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.org.id;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | LeadStatus>("All");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<LeadRow | null>(null);
  const [leadToDelete, setLeadToDelete] = useState<LeadRow | null>(null);
  const [form, setForm] = useState<LeadFormState>(defaultForm);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [bulkOwnerId, setBulkOwnerId] = useState("");
  const [bulkStatus, setBulkStatus] = useState<LeadStatus | "">("");
  const [importOpen, setImportOpen] = useState(false);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importCsvText, setImportCsvText] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const leadsQuery = useQuery({
    queryKey: ["leads", orgId],
    enabled: Boolean(orgId),
    queryFn: () => listLeads(orgId!),
  });

  const peopleQuery = useQuery({
    queryKey: ["sales-people", orgId],
    enabled: Boolean(orgId),
    queryFn: () => listOrgSalesPeople(orgId!),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !profile) throw new Error("Your profile is still loading");
      if (!form.name.trim()) throw new Error("Name is required");
      const people = peopleQuery.data ?? [];
      const matched = people.find((p) => p.id === form.ownerId);
      const payload = {
        orgId,
        ownerId: form.ownerId || profile.id,
        name: form.name,
        company: form.company,
        phone: form.phone,
        email: form.email,
        requirement: form.requirement,
        productLabel: form.requirement,
        location: form.location,
        salesPerson: form.salesPerson || matched?.name || profile.fullName || profile.email,
        tags: form.tags.split(/[,;]+/).map((t) => t.trim()).filter(Boolean),
        notes: form.notes,
        status: form.status,
        priority: form.priority,
        source: form.source,
        nextFollowUpAt: form.nextFollowUpAt ? new Date(form.nextFollowUpAt).toISOString() : null,
      };
      return editingLead ? updateLead(editingLead.id, payload) : createLead(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["leads", orgId] });
      toast.success(editingLead ? "Lead updated" : "Lead added to master");
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
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (leadToDelete) next.delete(leadToDelete.id);
        return next;
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not delete lead");
    },
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      const ids = [...selectedIds];
      if (ids.length === 0) throw new Error("Select at least one lead");
      const person = (peopleQuery.data ?? []).find((p) => p.id === bulkOwnerId);
      if (!person) throw new Error("Choose a sales person");
      return bulkAssignLeads({
        leadIds: ids,
        ownerId: person.id,
        salesPerson: person.name,
      });
    },
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({ queryKey: ["leads", orgId] });
      toast.success(`Assigned ${count} lead${count === 1 ? "" : "s"}`);
      setAssignOpen(false);
      setBulkOwnerId("");
      setSelectedIds(new Set());
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Bulk assign failed"),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async () => {
      const ids = [...selectedIds];
      if (ids.length === 0) throw new Error("Select at least one lead");
      if (!bulkStatus) throw new Error("Choose a status");
      return bulkUpdateLeadStatus({ leadIds: ids, status: bulkStatus });
    },
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({ queryKey: ["leads", orgId] });
      toast.success(`Updated status on ${count} lead${count === 1 ? "" : "s"}`);
      setBulkStatus("");
      setSelectedIds(new Set());
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Bulk status update failed"),
  });

  const importMutation = useMutation({
    mutationFn: async (csvText: string) => {
      if (!orgId) throw new Error("Your profile is still loading");
      return importLeadsFromCsv({
        orgId,
        csvText,
        ownerId: profile?.id ?? null,
      });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["leads", orgId] });
      setImportOpen(false);
      setImportFileName(null);
      setImportCsvText(null);
      if (importInputRef.current) importInputRef.current.value = "";
      const parts = [
        `${result.imported} imported`,
        result.skippedDuplicate ? `${result.skippedDuplicate} skipped (duplicate)` : null,
        result.skippedInvalid ? `${result.skippedInvalid} skipped (invalid)` : null,
      ].filter(Boolean);
      toast.success(parts.join(" · "));
      if (result.errors.length > 0) {
        toast.message(
          `Notes: ${result.errors.slice(0, 3).join("; ")}${result.errors.length > 3 ? "…" : ""}`,
        );
      }
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Import failed"),
  });

  const onImportFile = (file: File | null) => {
    if (!file) {
      setImportFileName(null);
      setImportCsvText(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      toast.error("Please choose a .csv file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImportFileName(file.name);
      setImportCsvText(String(reader.result ?? ""));
    };
    reader.onerror = () => toast.error("Could not read file");
    reader.readAsText(file);
  };

  const filteredLeads = useMemo(() => {
    let items = leadsQuery.data ?? [];
    if (statusFilter !== "All") {
      items = items.filter((l) => l.status === statusFilter);
    }
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((lead) =>
      [
        lead.name,
        lead.company,
        lead.email,
        lead.phone,
        lead.requirement,
        lead.product_label,
        lead.sales_person,
        lead.location,
        lead.notes,
        lead.external_ref,
        ...(lead.tags || []),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [leadsQuery.data, search, statusFilter]);

  const allFilteredSelected =
    filteredLeads.length > 0 && filteredLeads.every((l) => selectedIds.has(l.id));
  const someFilteredSelected = filteredLeads.some((l) => selectedIds.has(l.id));

  const toggleSelectAllFiltered = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const lead of filteredLeads) next.add(lead.id);
      } else {
        for (const lead of filteredLeads) next.delete(lead.id);
      }
      return next;
    });
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectedLeads = useMemo(() => {
    const all = leadsQuery.data ?? [];
    return all.filter((l) => selectedIds.has(l.id));
  }, [leadsQuery.data, selectedIds]);

  const exportSelectedOrFiltered = () => {
    const rows = selectedLeads.length > 0 ? selectedLeads : filteredLeads;
    if (rows.length === 0) {
      toast.message("Nothing to export");
      return;
    }
    downloadLeadsCsv(rows);
    toast.success(
      `Exported ${rows.length} lead${rows.length === 1 ? "" : "s"}${
        selectedLeads.length > 0 ? " (selected)" : " (current filter)"
      }`,
    );
  };

  const openCreate = () => {
    setEditingLead(null);
    setForm({
      ...defaultForm,
      ownerId: profile?.id || "",
      salesPerson: profile?.fullName || profile?.email || "",
    });
    setDialogOpen(true);
  };

  const openEdit = (lead: LeadRow) => {
    setEditingLead(lead);
    setForm(formFromLead(lead));
    setDialogOpen(true);
  };

  const columns = [
    "Select",
    "Company",
    "Name",
    "Email",
    "Phone",
    "Location",
    "Source",
    "Requirement",
    "Sales Person",
    "Status",
    "Note",
    "Tags",
    "Actions",
  ];

  return (
    <>
      <PageHeader
        title="Leads — Master"
        description="Single master sheet for every enquiry. Select rows to assign, change status, or export CSV."
        meta={
          <Pill tone="neutral">
            {(leadsQuery.data ?? []).length} leads
          </Pill>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={exportSelectedOrFiltered}>
              <Download className="size-4" /> Export CSV
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" /> Bulk import
            </Button>
            <Button size="sm" className="gap-1.5" onClick={openCreate}>
              <Plus className="size-4" /> Add lead
            </Button>
          </div>
        }
      />
      <div className="space-y-4 p-6">
        <Panel bodyClassName="p-0">
          <Toolbar
            placeholder="Search company, name, phone, requirement, tags…"
            value={search}
            onChange={setSearch}
            right={
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as "All" | LeadStatus)}
              >
                <SelectTrigger className="h-8 w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All statuses</SelectItem>
                  {statusOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />

          {selectedIds.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/30 px-3 py-2">
              <span className="text-xs font-medium text-foreground">
                {selectedIds.size} selected
              </span>
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5"
                onClick={() => setAssignOpen(true)}
              >
                <UserPlus className="size-3.5" /> Assign sales person
              </Button>
              <Select
                value={bulkStatus || undefined}
                onValueChange={(v: LeadStatus) => setBulkStatus(v)}
              >
                <SelectTrigger className="h-8 w-[140px]">
                  <SelectValue placeholder="Set status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                disabled={!bulkStatus || bulkStatusMutation.isPending}
                onClick={() => bulkStatusMutation.mutate()}
              >
                {bulkStatusMutation.isPending ? "Updating…" : "Apply status"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => {
                  downloadLeadsCsv(selectedLeads);
                  toast.success(`Exported ${selectedLeads.length} selected`);
                }}
              >
                <Download className="size-3.5" /> Export selected
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            </div>
          ) : null}

          {leadsQuery.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading master leads…</div>
          ) : filteredLeads.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={search || statusFilter !== "All" ? "No matching leads" : "Master table is empty"}
                description={
                  search || statusFilter !== "All"
                    ? "Try a different search or status filter."
                    : "Add a lead, or sync from IndiaMART / TradeIndia / website chat — they land here."
                }
              />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      {columns.map((h) => (
                        <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">
                          {h === "Select" ? (
                            <Checkbox
                              checked={
                                allFilteredSelected
                                  ? true
                                  : someFilteredSelected
                                    ? "indeterminate"
                                    : false
                              }
                              onCheckedChange={(v) => toggleSelectAllFiltered(v === true)}
                              aria-label="Select all filtered leads"
                            />
                          ) : (
                            h
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredLeads.map((lead) => (
                      <tr
                        key={lead.id}
                        className={
                          selectedIds.has(lead.id)
                            ? "bg-primary/5 hover:bg-primary/10"
                            : "hover:bg-secondary/40"
                        }
                      >
                        <td className="px-3 py-2.5">
                          <Checkbox
                            checked={selectedIds.has(lead.id)}
                            onCheckedChange={(v) => toggleOne(lead.id, v === true)}
                            aria-label={`Select ${lead.name}`}
                          />
                        </td>
                        <td className="max-w-[140px] truncate px-3 py-2.5 font-medium">
                          {lead.company || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">{lead.name}</td>
                        <td className="max-w-[160px] truncate px-3 py-2.5 text-muted-foreground">
                          {lead.email || "—"}
                        </td>
                        <td className="num whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                          {lead.phone || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                          {lead.location || "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <ChannelIcon
                              channel={lead.source ?? "website"}
                              className="text-muted-foreground"
                            />
                            <span className="text-xs capitalize">{lead.source || "—"}</span>
                          </div>
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-2.5">
                          {lead.requirement || lead.product_label || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          {lead.sales_person || lead.owner_name || "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <Pill tone={statusTone(lead.status)}>{lead.status}</Pill>
                        </td>
                        <td className="max-w-[160px] truncate px-3 py-2.5 text-muted-foreground">
                          {lead.notes || "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex max-w-[160px] flex-wrap gap-1">
                            {(lead.tags || []).length === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              (lead.tags || []).slice(0, 3).map((t) => (
                                <Pill key={t} tone="neutral">
                                  {t}
                                </Pill>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => openEdit(lead)}>
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setLeadToDelete(lead)}
                            >
                              <Trash2 className="size-3.5" />
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

        <p className="text-xs text-muted-foreground">
          Tip: use Bulk import for CSV (template download). Select rows for assign / status. Export uses
          selected rows, or the current filter if nothing is selected. Run{" "}
          <code className="rounded bg-secondary px-1">010_leads_master.sql</code> once if columns are
          missing.
        </p>
      </div>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) {
            setImportFileName(null);
            setImportCsvText(null);
            if (importInputRef.current) importInputRef.current.value = "";
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk import leads</DialogTitle>
            <DialogDescription>
              Download the CSV template, fill rows (max {MAX_IMPORT_ROWS}), then upload. Rows with an
              existing email or phone are skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Button
              type="button"
              variant="outline"
              className="w-full gap-1.5"
              onClick={() => downloadLeadsImportTemplate()}
            >
              <Download className="size-4" />
              Download CSV template
            </Button>
            <div className="space-y-2">
              <Label htmlFor="leads-csv">Upload CSV</Label>
              <input
                ref={importInputRef}
                id="leads-csv"
                type="file"
                accept=".csv,text/csv"
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
                onChange={(e) => onImportFile(e.target.files?.[0] ?? null)}
              />
              {importFileName ? (
                <p className="text-xs text-muted-foreground">Selected: {importFileName}</p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!importCsvText || importMutation.isPending}
              onClick={() => {
                if (!importCsvText) return;
                importMutation.mutate(importCsvText);
              }}
            >
              {importMutation.isPending ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={assignOpen}
        onOpenChange={(open) => {
          setAssignOpen(open);
          if (!open) setBulkOwnerId("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign sales person</DialogTitle>
            <DialogDescription>
              Assign {selectedIds.size} selected lead{selectedIds.size === 1 ? "" : "s"} to a team
              member.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Sales person</Label>
            <Select value={bulkOwnerId || undefined} onValueChange={setBulkOwnerId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose person" />
              </SelectTrigger>
              <SelectContent>
                {(peopleQuery.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!bulkOwnerId || assignMutation.isPending}
              onClick={() => assignMutation.mutate()}
            >
              {assignMutation.isPending ? "Assigning…" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingLead ? "Edit lead" : "Add lead"}</DialogTitle>
            <DialogDescription>
              Master enquiry record. Changing status can trigger Automation later.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Company</Label>
              <Input
                value={form.company}
                onChange={(e) => setForm((s) => ({ ...s, company: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Input
                value={form.location}
                onChange={(e) => setForm((s) => ({ ...s, location: e.target.value }))}
                placeholder="City / site"
              />
            </div>
            <div className="space-y-2">
              <Label>Source</Label>
              <Select
                value={form.source}
                onValueChange={(value: ChannelType) => setForm((s) => ({ ...s, source: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sourceOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Requirement</Label>
              <Input
                value={form.requirement}
                onChange={(e) => setForm((s) => ({ ...s, requirement: e.target.value }))}
                placeholder="e.g. 10 kVA UPS + batteries for cold storage"
              />
            </div>
            <div className="space-y-2">
              <Label>Sales Person</Label>
              <Select
                value={form.ownerId || "custom"}
                onValueChange={(value) => {
                  if (value === "custom") {
                    setForm((s) => ({ ...s, ownerId: "", salesPerson: s.salesPerson }));
                    return;
                  }
                  const person = (peopleQuery.data ?? []).find((p) => p.id === value);
                  setForm((s) => ({
                    ...s,
                    ownerId: value,
                    salesPerson: person?.name || s.salesPerson,
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Assign" />
                </SelectTrigger>
                <SelectContent>
                  {(peopleQuery.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom name…</SelectItem>
                </SelectContent>
              </Select>
              {!form.ownerId ? (
                <Input
                  className="mt-2"
                  placeholder="Sales person name"
                  value={form.salesPerson}
                  onChange={(e) => setForm((s) => ({ ...s, salesPerson: e.target.value }))}
                />
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(value: LeadStatus) => setForm((s) => ({ ...s, status: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Note</Label>
              <Textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
                placeholder="Qualification notes, callbacks, objections…"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Tags (comma-separated)</Label>
              <Input
                value={form.tags}
                onChange={(e) => setForm((s) => ({ ...s, tags: e.target.value }))}
                placeholder="hot, cold-storage, dealer"
              />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={form.priority}
                onValueChange={(value: PriorityLevel) => setForm((s) => ({ ...s, priority: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {priorityOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Next follow-up</Label>
              <Input
                type="datetime-local"
                value={form.nextFollowUpAt}
                onChange={(e) => setForm((s) => ({ ...s, nextFollowUpAt: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : editingLead ? "Update" : "Add to master"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(leadToDelete)} onOpenChange={(open) => !open && setLeadToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete lead?</AlertDialogTitle>
            <AlertDialogDescription>
              {leadToDelete
                ? `This permanently removes ${leadToDelete.name} from the master table.`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (leadToDelete) deleteMutation.mutate(leadToDelete.id);
              }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
