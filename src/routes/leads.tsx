import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
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
import { canLeadsCreate, canLeadsDelete } from "@/lib/permissions";
import type { ChannelType, LeadStatus, PriorityLevel } from "@/lib/db-types";
import {
  bulkAssignLeads,
  bulkDeleteLeads,
  bulkUpdateLeadStatus,
  countLeadsBySource,
  createLead,
  deleteLead,
  deleteLeadsBySource,
  downloadLeadsCsv,
  LEADS_PAGE_SIZE,
  listLeadFacets,
  listLeadsPage,
  listOrgSalesPeople,
  updateLead,
  type LeadFollowUpFilter,
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
  const canEdit = canLeadsCreate(profile?.role, profile?.permissions);
  const canDelete = canLeadsDelete(profile?.role, profile?.permissions);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | LeadStatus>("All");
  const [sourceFilter, setSourceFilter] = useState<"All" | ChannelType>("All");
  const [crmSourceFilter, setCrmSourceFilter] = useState<string>("All");
  const [salesFilter, setSalesFilter] = useState<string>("All");
  const [priorityFilter, setPriorityFilter] = useState<"All" | PriorityLevel>("All");
  const [followUpFilter, setFollowUpFilter] = useState<LeadFollowUpFilter>("all");
  const [page, setPage] = useState(1);
  const [showCrmCols, setShowCrmCols] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<LeadRow | null>(null);
  const [leadToDelete, setLeadToDelete] = useState<LeadRow | null>(null);
  const [deleteBySourceOpen, setDeleteBySourceOpen] = useState(false);
  const [deleteSource, setDeleteSource] = useState<ChannelType | "">("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [form, setForm] = useState<LeadFormState>(defaultForm);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [bulkOwnerId, setBulkOwnerId] = useState("");
  const [bulkStatus, setBulkStatus] = useState<LeadStatus | "">("");
  const [importOpen, setImportOpen] = useState(false);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importCsvText, setImportCsvText] = useState<string | null>(null);
  const [importFireAutomations, setImportFireAutomations] = useState(true);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [
    searchDebounced,
    statusFilter,
    sourceFilter,
    crmSourceFilter,
    salesFilter,
    priorityFilter,
    followUpFilter,
  ]);

  const listFilters = useMemo(
    () => ({
      search: searchDebounced,
      status: statusFilter,
      source: sourceFilter,
      crmSource: crmSourceFilter,
      salesPerson: salesFilter,
      priority: priorityFilter,
      followUp: followUpFilter,
      page,
      pageSize: LEADS_PAGE_SIZE,
    }),
    [
      searchDebounced,
      statusFilter,
      sourceFilter,
      crmSourceFilter,
      salesFilter,
      priorityFilter,
      followUpFilter,
      page,
    ],
  );

  const leadsQuery = useQuery({
    queryKey: ["leads", orgId, listFilters],
    enabled: Boolean(orgId),
    queryFn: () => listLeadsPage(orgId!, listFilters),
  });

  const facetsQuery = useQuery({
    queryKey: ["leads-facets", orgId],
    enabled: Boolean(orgId),
    queryFn: () => listLeadFacets(orgId!),
  });

  const deleteSourceCountQuery = useQuery({
    queryKey: ["leads-count-source", orgId, deleteSource],
    enabled: Boolean(orgId && deleteSource && deleteBySourceOpen),
    queryFn: () => countLeadsBySource(orgId!, deleteSource as ChannelType),
  });

  const peopleQuery = useQuery({
    queryKey: ["sales-people", orgId],
    enabled: Boolean(orgId),
    queryFn: () => listOrgSalesPeople(orgId!),
  });

  const pageRows = leadsQuery.data?.rows ?? [];
  const totalLeads = leadsQuery.data?.total ?? 0;
  const facets = facetsQuery.data;

  const invalidateLeads = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["leads", orgId] }),
      queryClient.invalidateQueries({ queryKey: ["leads-facets", orgId] }),
    ]);
  };

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
      await invalidateLeads();
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
      await invalidateLeads();
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

  const deleteBySourceMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Your profile is still loading");
      if (!deleteSource) throw new Error("Choose a source");
      const label =
        sourceOptions.find((o) => o.value === deleteSource)?.label || deleteSource;
      if (deleteConfirmText.trim().toLowerCase() !== String(label).toLowerCase()) {
        throw new Error(`Type "${label}" to confirm`);
      }
      return deleteLeadsBySource(orgId, deleteSource);
    },
    onSuccess: async (count) => {
      await invalidateLeads();
      const label =
        sourceOptions.find((o) => o.value === deleteSource)?.label || deleteSource;
      toast.success(`Deleted ${count} lead${count === 1 ? "" : "s"} from ${label}`);
      setDeleteBySourceOpen(false);
      setDeleteSource("");
      setDeleteConfirmText("");
      setSelectedIds(new Set());
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not delete by source"),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Your profile is still loading");
      const ids = [...selectedIds];
      if (ids.length === 0) throw new Error("Select at least one lead");
      return bulkDeleteLeads(orgId, ids);
    },
    onSuccess: async (count) => {
      await invalidateLeads();
      toast.success(`Deleted ${count} lead${count === 1 ? "" : "s"}`);
      setDeleteSelectedOpen(false);
      setSelectedIds(new Set());
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not delete selected"),
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!canEdit) throw new Error("You do not have permission to edit leads");
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
      await invalidateLeads();
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
      if (!canEdit) throw new Error("You do not have permission to edit leads");
      const ids = [...selectedIds];
      if (ids.length === 0) throw new Error("Select at least one lead");
      if (!bulkStatus) throw new Error("Choose a status");
      return bulkUpdateLeadStatus({ leadIds: ids, status: bulkStatus });
    },
    onSuccess: async (count) => {
      await invalidateLeads();
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
      setImportProgress({ done: 0, total: 0 });
      return importLeadsFromCsv({
        orgId,
        csvText,
        ownerId: profile?.id ?? null,
        fireAutomations: importFireAutomations,
        onProgress: (done, total) => setImportProgress({ done, total }),
      });
    },
    onSuccess: async (result) => {
      await invalidateLeads();
      setImportOpen(false);
      setImportFileName(null);
      setImportCsvText(null);
      setImportProgress(null);
      if (importInputRef.current) importInputRef.current.value = "";
      const parts = [
        `${result.imported} imported`,
        result.skippedDuplicate ? `${result.skippedDuplicate} skipped (duplicate)` : null,
        result.skippedInvalid ? `${result.skippedInvalid} skipped (invalid)` : null,
        importFireAutomations ? null : "automations skipped",
      ].filter(Boolean);
      toast.success(parts.join(" · "));
      if (result.errors.length > 0) {
        toast.message(
          `Notes: ${result.errors.slice(0, 3).join("; ")}${result.errors.length > 3 ? "…" : ""}`,
        );
      }
    },
    onError: (error) => {
      setImportProgress(null);
      toast.error(error instanceof Error ? error.message : "Import failed");
    },
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

  const deleteSourceCount = deleteSourceCountQuery.data ?? 0;
  const sourceCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of facets?.sources ?? []) map.set(row.value, row.count);
    return map;
  }, [facets]);

  const crmSourceOptions = facets?.crmSources ?? [];
  const salesPersonOptions = facets?.salesPeople ?? [];

  function formatCrmDate(iso: string | null | undefined) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString();
  }

  function formatFollowUp(iso: string | null | undefined) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function followUpSummaryText(lead: LeadRow): string {
    const meta = lead.metadata;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "";
    const raw = (meta as Record<string, unknown>).follow_up_summary;
    return typeof raw === "string" ? raw.trim() : "";
  }

  function priorityTone(p: PriorityLevel): "danger" | "warning" | "neutral" {
    if (p === "High") return "danger";
    if (p === "Low") return "neutral";
    return "warning";
  }

  const allFilteredSelected =
    pageRows.length > 0 && pageRows.every((l) => selectedIds.has(l.id));
  const someFilteredSelected = pageRows.some((l) => selectedIds.has(l.id));

  const toggleSelectAllFiltered = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const lead of pageRows) next.add(lead.id);
      } else {
        for (const lead of pageRows) next.delete(lead.id);
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
    return pageRows.filter((l) => selectedIds.has(l.id));
  }, [pageRows, selectedIds]);

  const exportSelectedOrFiltered = () => {
    const rows = selectedLeads.length > 0 ? selectedLeads : pageRows;
    if (rows.length === 0) {
      toast.message("Nothing to export");
      return;
    }
    downloadLeadsCsv(rows);
    toast.success(
      `Exported ${rows.length} lead${rows.length === 1 ? "" : "s"}${
        selectedLeads.length > 0 ? " (selected)" : " (this page)"
      }`,
    );
  };

  const openCreate = () => {
    if (!canEdit) {
      toast.error("You do not have permission to add leads");
      return;
    }
    setEditingLead(null);
    setForm({
      ...defaultForm,
      ownerId: profile?.id || "",
      salesPerson: profile?.fullName || profile?.email || "",
    });
    setDialogOpen(true);
  };

  const openEdit = (lead: LeadRow) => {
    if (!canEdit) {
      toast.error("You do not have permission to edit leads");
      return;
    }
    setEditingLead(lead);
    setForm(formFromLead(lead));
    setDialogOpen(true);
  };

  const hasActiveFilters =
    Boolean(searchDebounced) ||
    statusFilter !== "All" ||
    sourceFilter !== "All" ||
    crmSourceFilter !== "All" ||
    salesFilter !== "All" ||
    priorityFilter !== "All" ||
    followUpFilter !== "all";

  const baseColumns = [
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
    "Priority",
    "Next follow-up",
    "Follow-up summary",
    "Note",
    "Tags",
    "Actions",
  ];
  const columns = showCrmCols
    ? [
        "Select",
        "Company",
        "Name",
        "Email",
        "Phone",
        "Location",
        "Source",
        "CRM Source",
        "CRM ID",
        "Engage Ref",
        "CRM Created",
        "CRM Modified",
        "Requirement",
        "Sales Person",
        "Status",
        "Priority",
        "Next follow-up",
        "Follow-up summary",
        "Note",
        "Tags",
        "Actions",
      ]
    : baseColumns;

  return (
    <>
      <PageHeader
        title="Leads — Master"
        description="Single master sheet for every enquiry. Filter, page, assign, or delete — CRM sync stays on Channels; Pipeline uses the same status."
        meta={
          <div className="flex flex-wrap gap-2">
            <Pill tone="neutral">{totalLeads} leads</Pill>
            {!canEdit ? <Pill tone="warning">View / limited</Pill> : null}
          </div>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to="/channels">Channels (sync)</Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/pipeline">Pipeline</Link>
            </Button>
            {canDelete ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={() => {
                  setDeleteSource("");
                  setDeleteConfirmText("");
                  setDeleteBySourceOpen(true);
                }}
              >
                <Trash2 className="size-4" /> Delete by source
              </Button>
            ) : null}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={exportSelectedOrFiltered}>
              <Download className="size-4" /> Export CSV
            </Button>
            {canEdit ? (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setImportOpen(true)}>
                <Upload className="size-4" /> Bulk import
              </Button>
            ) : null}
            {canEdit ? (
              <Button size="sm" className="gap-1.5" onClick={openCreate}>
                <Plus className="size-4" /> Add lead
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="space-y-4 p-6">
        <Panel bodyClassName="p-0">
          <Toolbar
            placeholder="Search company, name, phone, requirement…"
            value={search}
            onChange={setSearch}
            right={
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={sourceFilter}
                  onValueChange={(v) => setSourceFilter(v as "All" | ChannelType)}
                >
                  <SelectTrigger className="h-8 w-[150px]">
                    <SelectValue placeholder="Source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All sources</SelectItem>
                    {sourceOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                        {sourceCounts.has(option.value)
                          ? ` (${sourceCounts.get(option.value)})`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={crmSourceFilter} onValueChange={setCrmSourceFilter}>
                  <SelectTrigger className="h-8 w-[150px]">
                    <SelectValue placeholder="CRM source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All CRM sources</SelectItem>
                    {crmSourceOptions.map((row) => (
                      <SelectItem key={row.value} value={row.value}>
                        {row.value} ({row.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={salesFilter} onValueChange={setSalesFilter}>
                  <SelectTrigger className="h-8 w-[150px]">
                    <SelectValue placeholder="Sales person" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All sales people</SelectItem>
                    {salesPersonOptions.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as "All" | LeadStatus)}
                >
                  <SelectTrigger className="h-8 w-[130px]">
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
                <Select
                  value={priorityFilter}
                  onValueChange={(v) => setPriorityFilter(v as "All" | PriorityLevel)}
                >
                  <SelectTrigger className="h-8 w-[120px]">
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All priorities</SelectItem>
                    {priorityOptions.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={followUpFilter}
                  onValueChange={(v) => setFollowUpFilter(v as LeadFollowUpFilter)}
                >
                  <SelectTrigger className="h-8 w-[140px]">
                    <SelectValue placeholder="Follow-up" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any follow-up</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="today">Due today</SelectItem>
                    <SelectItem value="upcoming">Upcoming</SelectItem>
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={showCrmCols}
                    onCheckedChange={(v) => setShowCrmCols(v === true)}
                  />
                  CRM columns
                </label>
              </div>
            }
          />

          {selectedIds.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/30 px-3 py-2">
              <span className="text-xs font-medium text-foreground">
                {selectedIds.size} selected
              </span>
              {canEdit ? (
                <>
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
                </>
              ) : null}
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
              {canDelete ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => setDeleteSelectedOpen(true)}
                >
                  <Trash2 className="size-3.5" /> Delete selected
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            </div>
          ) : null}

          {leadsQuery.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading master leads…</div>
          ) : pageRows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={hasActiveFilters ? "No matching leads" : "Master table is empty"}
                description={
                  hasActiveFilters
                    ? "Try a different search or filter."
                    : "Add a lead, or sync from IndiaMART / TradeIndia / Brainmine / website chat — they land here."
                }
                action={
                  !hasActiveFilters ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/channels">Open Channels to sync</Link>
                    </Button>
                  ) : undefined
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
                              aria-label="Select all on this page"
                            />
                          ) : (
                            h
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pageRows.map((lead) => {
                      const isEngageRef = String(lead.external_ref || "").startsWith("LD-");
                      return (
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
                        {showCrmCols ? (
                          <>
                            <td className="max-w-[120px] truncate px-3 py-2.5 text-xs text-muted-foreground">
                              {lead.crm_source || "—"}
                            </td>
                            <td className="max-w-[140px] truncate px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                              {isEngageRef ? "—" : lead.external_ref || "—"}
                            </td>
                            <td className="max-w-[100px] truncate px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                              {isEngageRef ? lead.external_ref : "—"}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                              {formatCrmDate(lead.crm_created_at)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                              {formatCrmDate(lead.crm_modified_at)}
                            </td>
                          </>
                        ) : null}
                        <td className="max-w-[180px] truncate px-3 py-2.5">
                          {lead.requirement || lead.product_label || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          {lead.sales_person || lead.owner_name || "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <Pill tone={statusTone(lead.status)}>{lead.status}</Pill>
                        </td>
                        <td className="px-3 py-2.5">
                          <Pill tone={priorityTone(lead.priority)}>{lead.priority}</Pill>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                          {formatFollowUp(lead.next_follow_up_at)}
                        </td>
                        <td className="max-w-[220px] px-3 py-2.5 text-xs text-muted-foreground">
                          {(() => {
                            const summary = followUpSummaryText(lead);
                            if (!summary) return "—";
                            return (
                              <span className="line-clamp-2 whitespace-normal" title={summary}>
                                {summary}
                              </span>
                            );
                          })()}
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
                            {canEdit ? (
                              <Button size="sm" variant="outline" onClick={() => openEdit(lead)}>
                                <Pencil className="size-3.5" />
                              </Button>
                            ) : null}
                            {canDelete ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setLeadToDelete(lead)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
              <TablePagination
                total={totalLeads}
                shown={pageRows.length}
                page={page}
                pageSize={LEADS_PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          )}
        </Panel>

        <p className="text-xs text-muted-foreground">
          Tip: Bulk import uses the CSV template. Export uses selected rows, or this page if none
          selected. Sync CRM leads from{" "}
          <Link to="/channels" className="underline underline-offset-2">
            Channels
          </Link>
          . Status changes still fire Automation the same way as before.
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
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={importFireAutomations}
                onCheckedChange={(v) => setImportFireAutomations(v === true)}
                className="mt-0.5"
              />
              <span>
                Fire <strong>lead_created</strong> automations for imported rows
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Keep on for normal ops. Turn off for historical backfill so WA/email campaigns don’t
                  fire. CRM sync from Channels is unchanged.
                </span>
              </span>
            </label>
            {importProgress ? (
              <p className="text-xs text-muted-foreground">
                Progress: {importProgress.done} / {importProgress.total || "…"}
              </p>
            ) : null}
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
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !canEdit}
            >
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

      <AlertDialog
        open={deleteSelectedOpen}
        onOpenChange={(open) => !open && setDeleteSelectedOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected leads?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete {selectedIds.size} selected lead
              {selectedIds.size === 1 ? "" : "s"}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                bulkDeleteMutation.mutate();
              }}
            >
              {bulkDeleteMutation.isPending ? "Deleting…" : "Delete selected"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={deleteBySourceOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteBySourceOpen(false);
            setDeleteSource("");
            setDeleteConfirmText("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete leads by source</DialogTitle>
            <DialogDescription>
              Remove every lead from one channel source (e.g. Brainmine, IndiaMART). Permanent —
              conversations stay, but the lead link is cleared. Count comes from the database, not
              just this page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-2">
              <Label>Source</Label>
              <Select
                value={deleteSource || undefined}
                onValueChange={(v: ChannelType) => {
                  setDeleteSource(v);
                  setDeleteConfirmText("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose source…" />
                </SelectTrigger>
                <SelectContent>
                  {sourceOptions.map((option) => {
                    const n = sourceCounts.get(option.value) || 0;
                    return (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                        {n > 0 ? ` (${n})` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            {deleteSource ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {deleteSourceCountQuery.isLoading
                  ? "Counting leads in database…"
                  : (
                    <>
                      Will permanently delete <strong>{deleteSourceCount}</strong> lead
                      {deleteSourceCount === 1 ? "" : "s"} with source{" "}
                      <strong>
                        {sourceOptions.find((o) => o.value === deleteSource)?.label || deleteSource}
                      </strong>
                      .
                    </>
                  )}
              </p>
            ) : null}
            {deleteSource ? (
              <div className="space-y-2">
                <Label>
                  Type{" "}
                  <strong>
                    {sourceOptions.find((o) => o.value === deleteSource)?.label || deleteSource}
                  </strong>{" "}
                  to confirm
                </Label>
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="Source label"
                  autoComplete="off"
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleteBySourceMutation.isPending}
              onClick={() => {
                setDeleteBySourceOpen(false);
                setDeleteSource("");
                setDeleteConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                !deleteSource ||
                deleteSourceCount === 0 ||
                deleteSourceCountQuery.isLoading ||
                deleteBySourceMutation.isPending ||
                deleteConfirmText.trim().toLowerCase() !==
                  (
                    sourceOptions.find((o) => o.value === deleteSource)?.label || deleteSource
                  ).toLowerCase()
              }
              onClick={() => deleteBySourceMutation.mutate()}
            >
              {deleteBySourceMutation.isPending
                ? "Deleting…"
                : `Delete ${deleteSourceCount || ""} from source`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
