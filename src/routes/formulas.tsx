import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Copy, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ListSkeleton, PageHeader, Panel, Pill } from "@/components/shared/ui-kit";
import {
  FORMULA_CATEGORIES,
  LOAD_CATEGORIES,
  createLoadApplication,
  createSizingFormula,
  deleteLoadApplication,
  deleteSizingFormula,
  duplicateSizingFormula,
  listLoadApplications,
  listSizingFormulas,
  runSizingFormula,
  updateLoadApplication,
  updateSizingFormula,
  type FormulaCategory,
  type FormulaVariable,
  type LoadApplication,
  type LoadCategory,
  type SizingFormula,
} from "@/server/formulas";

export const Route = createFileRoute("/formulas")({
  head: () => ({
    meta: [
      { title: "Formulas — EnerTech Engage" },
      {
        name: "description",
        content: "Solar, inverter, battery and BESS sizing formulas plus appliance load wattages.",
      },
      { property: "og:title", content: "Formulas — EnerTech Engage" },
    ],
  }),
  component: Page,
});

const CATEGORY_LABEL: Record<FormulaCategory, string> = {
  solar_home: "Solar (home)",
  solar_industry: "Solar (industry)",
  inverter: "Inverter",
  battery: "Battery",
  bess: "BESS",
  hybrid: "Hybrid",
};

const LOAD_LABEL: Record<LoadCategory, string> = {
  home: "Home",
  industry: "Industry",
  both: "Both",
};

function emptyFormula(): {
  name: string;
  category: FormulaCategory;
  description: string;
  expression: string;
  result_label: string;
  result_unit: string;
  variablesJson: string;
  notes: string;
  sort_order: number;
  is_active: boolean;
} {
  return {
    name: "",
    category: "battery",
    description: "",
    expression: "(total_w * backup_hours) / (system_voltage * dod * efficiency)",
    result_label: "Result",
    result_unit: "Ah",
    variablesJson: JSON.stringify(
      [
        { key: "total_w", label: "Total load", unit: "W", default_value: 1000 },
        { key: "backup_hours", label: "Backup time", unit: "h", default_value: 4 },
        { key: "system_voltage", label: "DC voltage", unit: "V", default_value: 48 },
        { key: "dod", label: "DoD", unit: "0–1", default_value: 0.5 },
        { key: "efficiency", label: "Efficiency", unit: "0–1", default_value: 0.9 },
      ] satisfies FormulaVariable[],
      null,
      2,
    ),
    notes: "",
    sort_order: 100,
    is_active: true,
  };
}

function emptyLoad(): {
  name: string;
  watts: string;
  surge_watts: string;
  category: LoadCategory;
  default_qty: string;
  notes: string;
  sort_order: number;
  is_active: boolean;
} {
  return {
    name: "",
    watts: "100",
    surge_watts: "",
    category: "home",
    default_qty: "1",
    notes: "",
    sort_order: 100,
    is_active: true,
  };
}

function Page() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("calculator");

  const formulasQuery = useQuery({
    queryKey: ["sizing-formulas"],
    queryFn: () => listSizingFormulas(),
  });
  const loadsQuery = useQuery({
    queryKey: ["load-applications"],
    queryFn: () => listLoadApplications(),
  });

  const formulas = formulasQuery.data ?? [];
  const loads = loadsQuery.data ?? [];
  const activeFormulas = formulas.filter((f) => f.is_active);
  const activeLoads = loads.filter((l) => l.is_active);

  // Calculator state
  const [qtyByLoad, setQtyByLoad] = useState<Record<string, number>>({});
  const [selectedFormulaId, setSelectedFormulaId] = useState<string>("");
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [calcResult, setCalcResult] = useState<{
    result: number;
    resultLabel: string;
    resultUnit: string;
    name: string;
  } | null>(null);

  // Formula dialog
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [editingFormula, setEditingFormula] = useState<SizingFormula | null>(null);
  const [formulaForm, setFormulaForm] = useState(emptyFormula());

  // Load dialog
  const [loadOpen, setLoadOpen] = useState(false);
  const [editingLoad, setEditingLoad] = useState<LoadApplication | null>(null);
  const [loadForm, setLoadForm] = useState(emptyLoad());

  const loadTotals = useMemo(() => {
    let watts = 0;
    let surge = 0;
    for (const load of activeLoads) {
      const qty = qtyByLoad[load.id] ?? 0;
      if (qty <= 0) continue;
      watts += load.watts * qty;
      surge += (load.surge_watts ?? load.watts) * qty;
    }
    return { watts, surge, kw: watts / 1000 };
  }, [activeLoads, qtyByLoad]);

  const selectedFormula = activeFormulas.find((f) => f.id === selectedFormulaId) || null;

  useEffect(() => {
    if (!selectedFormulaId && activeFormulas[0]) {
      setSelectedFormulaId(activeFormulas[0].id);
    }
  }, [activeFormulas, selectedFormulaId]);

  useEffect(() => {
    if (!selectedFormula) return;
    const next: Record<string, string> = {};
    for (const v of selectedFormula.variables) {
      if (v.key === "total_w") next[v.key] = String(Math.round(loadTotals.watts) || v.default_value || 0);
      else if (v.key === "total_kw")
        next[v.key] = String(Number(loadTotals.kw.toFixed(3)) || v.default_value || 0);
      else next[v.key] = String(varValues[v.key] ?? v.default_value ?? "");
    }
    setVarValues(next);
    setCalcResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when formula or load totals change
  }, [selectedFormulaId, loadTotals.watts, loadTotals.kw]);

  async function invalidateAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sizing-formulas"] }),
      queryClient.invalidateQueries({ queryKey: ["load-applications"] }),
    ]);
  }

  const saveFormulaMutation = useMutation({
    mutationFn: async () => {
      let variables: FormulaVariable[] = [];
      try {
        variables = JSON.parse(formulaForm.variablesJson || "[]");
        if (!Array.isArray(variables)) throw new Error("Variables must be a JSON array");
      } catch {
        throw new Error("Variables JSON is invalid");
      }
      const payload = {
        name: formulaForm.name,
        category: formulaForm.category,
        description: formulaForm.description || null,
        expression: formulaForm.expression,
        result_label: formulaForm.result_label,
        result_unit: formulaForm.result_unit,
        variables,
        notes: formulaForm.notes || null,
        sort_order: formulaForm.sort_order,
        is_active: formulaForm.is_active,
      };
      if (editingFormula) {
        return updateSizingFormula({ data: { id: editingFormula.id, ...payload } });
      }
      return createSizingFormula({ data: payload });
    },
    onSuccess: async () => {
      await invalidateAll();
      setFormulaOpen(false);
      setEditingFormula(null);
      toast.success(editingFormula ? "Formula updated" : "Formula added");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const deleteFormulaMutation = useMutation({
    mutationFn: (id: string) => deleteSizingFormula({ data: { id } }),
    onSuccess: async () => {
      await invalidateAll();
      toast.success("Formula deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const dupFormulaMutation = useMutation({
    mutationFn: (id: string) => duplicateSizingFormula({ data: { id } }),
    onSuccess: async () => {
      await invalidateAll();
      toast.success("Formula duplicated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Duplicate failed"),
  });

  const saveLoadMutation = useMutation({
    mutationFn: async () => {
      const watts = Number(loadForm.watts);
      if (!Number.isFinite(watts) || watts <= 0) throw new Error("Watts must be > 0");
      const surgeRaw = loadForm.surge_watts.trim();
      const surge = surgeRaw ? Number(surgeRaw) : null;
      if (surgeRaw && (!Number.isFinite(surge) || (surge as number) <= 0)) {
        throw new Error("Surge watts must be > 0");
      }
      const payload = {
        name: loadForm.name,
        watts,
        surge_watts: surge,
        category: loadForm.category,
        default_qty: Math.max(0, Math.floor(Number(loadForm.default_qty) || 0)),
        notes: loadForm.notes || null,
        sort_order: loadForm.sort_order,
        is_active: loadForm.is_active,
      };
      if (editingLoad) return updateLoadApplication({ data: { id: editingLoad.id, ...payload } });
      return createLoadApplication({ data: payload });
    },
    onSuccess: async () => {
      await invalidateAll();
      setLoadOpen(false);
      setEditingLoad(null);
      toast.success(editingLoad ? "Load updated" : "Load added");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const deleteLoadMutation = useMutation({
    mutationFn: (id: string) => deleteLoadApplication({ data: { id } }),
    onSuccess: async () => {
      await invalidateAll();
      toast.success("Load deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFormulaId) throw new Error("Select a formula");
      const values: Record<string, number> = {
        total_w: loadTotals.watts,
        total_kw: loadTotals.kw,
      };
      for (const [k, raw] of Object.entries(varValues)) {
        const n = Number(raw);
        if (Number.isFinite(n)) values[k] = n;
      }
      return runSizingFormula({ data: { formulaId: selectedFormulaId, values } });
    },
    onSuccess: (r) => {
      setCalcResult({
        result: r.result,
        resultLabel: r.resultLabel,
        resultUnit: r.resultUnit,
        name: r.name,
      });
      toast.success("Calculated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Calculation failed"),
  });

  function openCreateFormula() {
    setEditingFormula(null);
    setFormulaForm(emptyFormula());
    setFormulaOpen(true);
  }

  function openEditFormula(f: SizingFormula) {
    setEditingFormula(f);
    setFormulaForm({
      name: f.name,
      category: f.category,
      description: f.description || "",
      expression: f.expression,
      result_label: f.result_label,
      result_unit: f.result_unit,
      variablesJson: JSON.stringify(f.variables, null, 2),
      notes: f.notes || "",
      sort_order: f.sort_order,
      is_active: f.is_active,
    });
    setFormulaOpen(true);
  }

  function openCreateLoad() {
    setEditingLoad(null);
    setLoadForm(emptyLoad());
    setLoadOpen(true);
  }

  function openEditLoad(l: LoadApplication) {
    setEditingLoad(l);
    setLoadForm({
      name: l.name,
      watts: String(l.watts),
      surge_watts: l.surge_watts != null ? String(l.surge_watts) : "",
      category: l.category,
      default_qty: String(l.default_qty),
      notes: l.notes || "",
      sort_order: l.sort_order,
      is_active: l.is_active,
    });
    setLoadOpen(true);
  }

  const migrationError =
    formulasQuery.error instanceof Error
      ? formulasQuery.error.message
      : loadsQuery.error instanceof Error
        ? loadsQuery.error.message
        : null;

  return (
    <>
      <PageHeader
        title="Formulas"
        description="Sizing library for solar, inverter, battery and BESS — plus appliance wattages for load-based calculations."
      />

      {migrationError ? (
        <Panel className="mb-4 border-destructive/40">
          <p className="text-sm text-destructive">{migrationError}</p>
        </Panel>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="calculator">Calculator</TabsTrigger>
          <TabsTrigger value="formulas">Formulas ({formulas.length})</TabsTrigger>
          <TabsTrigger value="loads">Load applications ({loads.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="calculator" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Customer loads" description="Set qty for each appliance. Totals feed formulas that use total_w / total_kw.">
              {loadsQuery.isLoading ? (
                <ListSkeleton rows={6} />
              ) : activeLoads.length === 0 ? (
                <EmptyState
                  title="No active loads"
                  description="Add appliances under Load applications, then return here."
                  action={
                    <Button size="sm" onClick={() => setTab("loads")}>
                      Open loads
                    </Button>
                  }
                />
              ) : (
                <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                  {activeLoads.map((l) => (
                    <div
                      key={l.id}
                      className="flex items-center gap-3 rounded-md border border-border/70 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{l.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {l.watts} W
                          {l.surge_watts ? ` · surge ${l.surge_watts} W` : ""} · {LOAD_LABEL[l.category]}
                        </p>
                      </div>
                      <Input
                        type="number"
                        min={0}
                        className="h-8 w-20"
                        value={qtyByLoad[l.id] ?? 0}
                        onChange={(e) =>
                          setQtyByLoad((prev) => ({
                            ...prev,
                            [l.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <Pill tone="info">Total {Math.round(loadTotals.watts)} W</Pill>
                <Pill tone="info">{loadTotals.kw.toFixed(2)} kW</Pill>
                <Pill tone="warning">Surge ~{Math.round(loadTotals.surge)} W</Pill>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const next: Record<string, number> = {};
                    for (const l of activeLoads) next[l.id] = l.default_qty || 0;
                    setQtyByLoad(next);
                  }}
                >
                  Use default qtys
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setQtyByLoad({})}>
                  Clear
                </Button>
              </div>
            </Panel>

            <Panel title="Run formula" description="Pick a sizing formula and adjust variables, then calculate.">
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Formula</Label>
                  <Select value={selectedFormulaId} onValueChange={setSelectedFormulaId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select formula" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeFormulas.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {CATEGORY_LABEL[f.category]} — {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedFormula ? (
                  <>
                    <p className="rounded-md bg-secondary/50 px-3 py-2 font-mono text-xs">
                      {selectedFormula.expression}
                    </p>
                    {selectedFormula.variables.map((v) => (
                      <div key={v.key} className="space-y-1">
                        <Label>
                          {v.label}
                          {v.unit ? ` (${v.unit})` : ""}
                        </Label>
                        <Input
                          type="number"
                          step="any"
                          value={varValues[v.key] ?? ""}
                          onChange={(e) =>
                            setVarValues((prev) => ({ ...prev, [v.key]: e.target.value }))
                          }
                        />
                      </div>
                    ))}
                    <Button
                      className="gap-1.5"
                      disabled={runMutation.isPending || !selectedFormulaId}
                      onClick={() => runMutation.mutate()}
                    >
                      <Calculator className="size-3.5" />
                      {runMutation.isPending ? "Calculating…" : "Calculate"}
                    </Button>
                    {calcResult ? (
                      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                        <p className="text-xs text-muted-foreground">{calcResult.name}</p>
                        <p className="text-2xl font-semibold tracking-tight">
                          {Number.isInteger(calcResult.result)
                            ? calcResult.result
                            : calcResult.result.toFixed(2)}{" "}
                          <span className="text-base font-normal text-muted-foreground">
                            {calcResult.resultUnit}
                          </span>
                        </p>
                        <p className="text-sm text-muted-foreground">{calcResult.resultLabel}</p>
                      </div>
                    ) : null}
                    {selectedFormula.notes ? (
                      <p className="text-xs text-muted-foreground">{selectedFormula.notes}</p>
                    ) : null}
                  </>
                ) : (
                  <EmptyState
                    title="No formulas yet"
                    description="Add formulas under the Formulas tab (or run migration 027)."
                  />
                )}
              </div>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="formulas" className="space-y-4">
          <div className="flex justify-end">
            <Button className="gap-1.5" onClick={openCreateFormula}>
              <Plus className="size-3.5" /> Add formula
            </Button>
          </div>
          {formulasQuery.isLoading ? (
            <ListSkeleton rows={5} />
          ) : formulas.length === 0 ? (
            <EmptyState
              title="No formulas"
              description="Run migration 027 or add your first sizing formula."
              action={
                <Button onClick={openCreateFormula}>
                  <Plus className="size-3.5" /> Add formula
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {formulas.map((f) => (
                <div
                  key={f.id}
                  className="flex flex-wrap items-start gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{f.name}</p>
                      <Pill tone={f.is_active ? "success" : "warning"}>
                        {f.is_active ? "Active" : "Off"}
                      </Pill>
                      <Pill>{CATEGORY_LABEL[f.category]}</Pill>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">{f.expression}</p>
                    {f.description ? (
                      <p className="text-sm text-muted-foreground">{f.description}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => openEditFormula(f)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      onClick={() => dupFormulaMutation.mutate(f.id)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-destructive"
                      onClick={() => {
                        if (confirm(`Delete formula “${f.name}”?`)) deleteFormulaMutation.mutate(f.id);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="loads" className="space-y-4">
          <div className="flex justify-end">
            <Button className="gap-1.5" onClick={openCreateLoad}>
              <Plus className="size-3.5" /> Add load
            </Button>
          </div>
          {loadsQuery.isLoading ? (
            <ListSkeleton rows={5} />
          ) : loads.length === 0 ? (
            <EmptyState
              title="No load applications"
              description="Run migration 027 or add appliances with wattages."
              action={
                <Button onClick={openCreateLoad}>
                  <Plus className="size-3.5" /> Add load
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-border bg-secondary/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Watts</th>
                    <th className="px-3 py-2 font-medium">Surge</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Default qty</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {loads.map((l) => (
                    <tr key={l.id} className="border-b border-border/60">
                      <td className="px-3 py-2 font-medium">{l.name}</td>
                      <td className="px-3 py-2 tabular-nums">{l.watts}</td>
                      <td className="px-3 py-2 tabular-nums">{l.surge_watts ?? "—"}</td>
                      <td className="px-3 py-2">{LOAD_LABEL[l.category]}</td>
                      <td className="px-3 py-2 tabular-nums">{l.default_qty}</td>
                      <td className="px-3 py-2">
                        <Pill tone={l.is_active ? "success" : "warning"}>
                          {l.is_active ? "Active" : "Off"}
                        </Pill>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="size-8" onClick={() => openEditLoad(l)}>
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 text-destructive"
                            onClick={() => {
                              if (confirm(`Delete “${l.name}”?`)) deleteLoadMutation.mutate(l.id);
                            }}
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
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={formulaOpen} onOpenChange={setFormulaOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingFormula ? "Edit formula" : "Add formula"}</DialogTitle>
            <DialogDescription>
              Expression may use variable keys and + − × ÷ ( ). Example: (total_w * backup_hours) /
              (system_voltage * dod * efficiency)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={formulaForm.name}
                onChange={(e) => setFormulaForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select
                value={formulaForm.category}
                onValueChange={(v: FormulaCategory) => setFormulaForm((p) => ({ ...p, category: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMULA_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Expression</Label>
              <Input
                className="font-mono text-xs"
                value={formulaForm.expression}
                onChange={(e) => setFormulaForm((p) => ({ ...p, expression: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Result label</Label>
                <Input
                  value={formulaForm.result_label}
                  onChange={(e) => setFormulaForm((p) => ({ ...p, result_label: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Result unit</Label>
                <Input
                  value={formulaForm.result_unit}
                  onChange={(e) => setFormulaForm((p) => ({ ...p, result_unit: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Variables (JSON)</Label>
              <Textarea
                className="min-h-[140px] font-mono text-xs"
                value={formulaForm.variablesJson}
                onChange={(e) => setFormulaForm((p) => ({ ...p, variablesJson: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea
                value={formulaForm.description}
                onChange={(e) => setFormulaForm((p) => ({ ...p, description: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                value={formulaForm.notes}
                onChange={(e) => setFormulaForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <Label>Sort order</Label>
                <Input
                  type="number"
                  className="w-24"
                  value={formulaForm.sort_order}
                  onChange={(e) =>
                    setFormulaForm((p) => ({ ...p, sort_order: Math.floor(Number(e.target.value) || 0) }))
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <Label>Active</Label>
                <Switch
                  checked={formulaForm.is_active}
                  onCheckedChange={(v) => setFormulaForm((p) => ({ ...p, is_active: v }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormulaOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!formulaForm.name.trim() || saveFormulaMutation.isPending}
              onClick={() => saveFormulaMutation.mutate()}
            >
              {saveFormulaMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={loadOpen} onOpenChange={setLoadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLoad ? "Edit load" : "Add load application"}</DialogTitle>
            <DialogDescription>Appliance wattage used in the load calculator.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={loadForm.name}
                onChange={(e) => setLoadForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Ceiling fan"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Watts</Label>
                <Input
                  type="number"
                  value={loadForm.watts}
                  onChange={(e) => setLoadForm((p) => ({ ...p, watts: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Surge watts (optional)</Label>
                <Input
                  type="number"
                  value={loadForm.surge_watts}
                  onChange={(e) => setLoadForm((p) => ({ ...p, surge_watts: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select
                value={loadForm.category}
                onValueChange={(v: LoadCategory) => setLoadForm((p) => ({ ...p, category: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOAD_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {LOAD_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Default qty</Label>
                <Input
                  type="number"
                  value={loadForm.default_qty}
                  onChange={(e) => setLoadForm((p) => ({ ...p, default_qty: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Sort order</Label>
                <Input
                  type="number"
                  value={loadForm.sort_order}
                  onChange={(e) =>
                    setLoadForm((p) => ({ ...p, sort_order: Math.floor(Number(e.target.value) || 0) }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                value={loadForm.notes}
                onChange={(e) => setLoadForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label>Active</Label>
              <Switch
                checked={loadForm.is_active}
                onCheckedChange={(v) => setLoadForm((p) => ({ ...p, is_active: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoadOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!loadForm.name.trim() || saveLoadMutation.isPending}
              onClick={() => saveLoadMutation.mutate()}
            >
              {saveLoadMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
