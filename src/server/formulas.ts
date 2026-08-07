import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";

export const FORMULA_CATEGORIES = [
  "solar_home",
  "solar_industry",
  "inverter",
  "battery",
  "bess",
  "hybrid",
] as const;

export type FormulaCategory = (typeof FORMULA_CATEGORIES)[number];

export const LOAD_CATEGORIES = ["home", "industry", "both"] as const;
export type LoadCategory = (typeof LOAD_CATEGORIES)[number];

export type FormulaVariable = {
  key: string;
  label: string;
  unit?: string;
  default_value?: number;
};

export type SizingFormula = {
  id: string;
  org_id: string;
  name: string;
  category: FormulaCategory;
  description: string | null;
  expression: string;
  result_label: string;
  result_unit: string;
  variables: FormulaVariable[];
  notes: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type LoadApplication = {
  id: string;
  org_id: string;
  name: string;
  watts: number;
  surge_watts: number | null;
  category: LoadCategory;
  default_qty: number;
  notes: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const variableSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/i, "Variable key must be letters/numbers/underscore"),
  label: z.string().min(1).max(80),
  unit: z.string().max(20).optional(),
  default_value: z.number().finite().optional(),
});

function parseVariables(raw: unknown): FormulaVariable[] {
  if (!Array.isArray(raw)) return [];
  const out: FormulaVariable[] = [];
  for (const item of raw) {
    const parsed = variableSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function mapFormula(row: Record<string, unknown>): SizingFormula {
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    name: String(row.name),
    category: row.category as FormulaCategory,
    description: (row.description as string | null) ?? null,
    expression: String(row.expression),
    result_label: String(row.result_label || "Result"),
    result_unit: String(row.result_unit || ""),
    variables: parseVariables(row.variables),
    notes: (row.notes as string | null) ?? null,
    sort_order: Number(row.sort_order) || 0,
    is_active: Boolean(row.is_active),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapLoad(row: Record<string, unknown>): LoadApplication {
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    name: String(row.name),
    watts: Number(row.watts),
    surge_watts: row.surge_watts == null ? null : Number(row.surge_watts),
    category: row.category as LoadCategory,
    default_qty: Number(row.default_qty) || 0,
    notes: (row.notes as string | null) ?? null,
    sort_order: Number(row.sort_order) || 0,
    is_active: Boolean(row.is_active),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function migrationHint(err: string): string {
  if (/does not exist|schema cache|sizing_formulas|load_applications/i.test(err)) {
    return `${err} — run supabase/migrations/027_sizing_formulas.sql in Supabase.`;
  }
  return err;
}

/** Safe arithmetic after substituting numeric variables. */
export function evaluateSizingExpression(
  expression: string,
  vars: Record<string, number>,
): number {
  let expr = expression.trim().replace(/\s+/g, "");
  if (!expr) throw new Error("Expression is empty");

  const keys = Object.keys(vars).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const val = vars[key];
    if (!Number.isFinite(val)) throw new Error(`Invalid value for ${key}`);
    expr = expr.replace(new RegExp(`\\b${key}\\b`, "gi"), String(val));
  }

  if (/[a-z_]/i.test(expr)) {
    throw new Error(
      "Expression still has unknown variables. Use only defined variable keys and + - * / ( ).",
    );
  }
  if (!/^[\d.+\-*/()]+$/.test(expr)) {
    throw new Error("Expression may only contain numbers and + - * / ( )");
  }

  // eslint-disable-next-line no-new-func
  const result = Function(`"use strict"; return (${expr});`)();
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error("Expression did not produce a finite number");
  }
  return result;
}

export const listSizingFormulas = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("sizing_formulas")
    .select("*")
    .eq("org_id", ORG_ID)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(migrationHint(error.message));
  return (data ?? []).map((r) => mapFormula(r as Record<string, unknown>));
});

export const listLoadApplications = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("load_applications")
    .select("*")
    .eq("org_id", ORG_ID)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(migrationHint(error.message));
  return (data ?? []).map((r) => mapLoad(r as Record<string, unknown>));
});

const formulaInput = z.object({
  name: z.string().min(1).max(120),
  category: z.enum(FORMULA_CATEGORIES),
  description: z.string().max(500).optional().nullable(),
  expression: z.string().min(1).max(500),
  result_label: z.string().min(1).max(80).default("Result"),
  result_unit: z.string().max(40).default(""),
  variables: z.array(variableSchema).max(20).default([]),
  notes: z.string().max(1000).optional().nullable(),
  sort_order: z.number().int().min(0).max(9999).default(0),
  is_active: z.boolean().default(true),
});

export const createSizingFormula = createServerFn({ method: "POST" })
  .validator(formulaInput)
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const { data: row, error } = await supabase
      .from("sizing_formulas")
      .insert({
        org_id: ORG_ID,
        name: data.name.trim(),
        category: data.category,
        description: data.description?.trim() || null,
        expression: data.expression.trim(),
        result_label: data.result_label.trim() || "Result",
        result_unit: data.result_unit.trim(),
        variables: data.variables,
        notes: data.notes?.trim() || null,
        sort_order: data.sort_order,
        is_active: data.is_active,
      })
      .select("*")
      .single();
    if (error) throw new Error(migrationHint(error.message));
    return mapFormula(row as Record<string, unknown>);
  });

export const updateSizingFormula = createServerFn({ method: "POST" })
  .validator(formulaInput.extend({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const { id, ...rest } = data;
    const { data: row, error } = await supabase
      .from("sizing_formulas")
      .update({
        name: rest.name.trim(),
        category: rest.category,
        description: rest.description?.trim() || null,
        expression: rest.expression.trim(),
        result_label: rest.result_label.trim() || "Result",
        result_unit: rest.result_unit.trim(),
        variables: rest.variables,
        notes: rest.notes?.trim() || null,
        sort_order: rest.sort_order,
        is_active: rest.is_active,
      })
      .eq("id", id)
      .eq("org_id", ORG_ID)
      .select("*")
      .single();
    if (error) throw new Error(migrationHint(error.message));
    return mapFormula(row as Record<string, unknown>);
  });

export const deleteSizingFormula = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const { error } = await supabase
      .from("sizing_formulas")
      .delete()
      .eq("id", data.id)
      .eq("org_id", ORG_ID);
    if (error) throw new Error(migrationHint(error.message));
    return { ok: true };
  });

export const duplicateSizingFormula = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const { data: src, error } = await supabase
      .from("sizing_formulas")
      .select("*")
      .eq("id", data.id)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (error) throw new Error(migrationHint(error.message));
    if (!src) throw new Error("Formula not found");
    const { data: row, error: insErr } = await supabase
      .from("sizing_formulas")
      .insert({
        org_id: ORG_ID,
        name: `${src.name} (copy)`,
        category: src.category,
        description: src.description,
        expression: src.expression,
        result_label: src.result_label,
        result_unit: src.result_unit,
        variables: src.variables,
        notes: src.notes,
        sort_order: Number(src.sort_order) + 1,
        is_active: src.is_active,
      })
      .select("*")
      .single();
    if (insErr) throw new Error(migrationHint(insErr.message));
    return mapFormula(row as Record<string, unknown>);
  });

const loadInput = z.object({
  name: z.string().min(1).max(120),
  watts: z.number().positive().max(1_000_000),
  surge_watts: z.number().positive().max(1_000_000).optional().nullable(),
  category: z.enum(LOAD_CATEGORIES).default("home"),
  default_qty: z.number().int().min(0).max(9999).default(1),
  notes: z.string().max(500).optional().nullable(),
  sort_order: z.number().int().min(0).max(9999).default(0),
  is_active: z.boolean().default(true),
});

export const createLoadApplication = createServerFn({ method: "POST" })
  .validator(loadInput)
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const { data: row, error } = await supabase
      .from("load_applications")
      .insert({
        org_id: ORG_ID,
        name: data.name.trim(),
        watts: data.watts,
        surge_watts: data.surge_watts ?? null,
        category: data.category,
        default_qty: data.default_qty,
        notes: data.notes?.trim() || null,
        sort_order: data.sort_order,
        is_active: data.is_active,
      })
      .select("*")
      .single();
    if (error) throw new Error(migrationHint(error.message));
    return mapLoad(row as Record<string, unknown>);
  });

export const updateLoadApplication = createServerFn({ method: "POST" })
  .validator(loadInput.extend({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const { id, ...rest } = data;
    const { data: row, error } = await supabase
      .from("load_applications")
      .update({
        name: rest.name.trim(),
        watts: rest.watts,
        surge_watts: rest.surge_watts ?? null,
        category: rest.category,
        default_qty: rest.default_qty,
        notes: rest.notes?.trim() || null,
        sort_order: rest.sort_order,
        is_active: rest.is_active,
      })
      .eq("id", id)
      .eq("org_id", ORG_ID)
      .select("*")
      .single();
    if (error) throw new Error(migrationHint(error.message));
    return mapLoad(row as Record<string, unknown>);
  });

export const deleteLoadApplication = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const { error } = await supabase
      .from("load_applications")
      .delete()
      .eq("id", data.id)
      .eq("org_id", ORG_ID);
    if (error) throw new Error(migrationHint(error.message));
    return { ok: true };
  });

export const runSizingFormula = createServerFn({ method: "POST" })
  .validator(
    z.object({
      formulaId: z.string().uuid(),
      values: z.record(z.string(), z.number()),
    }),
  )
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const { data: row, error } = await supabase
      .from("sizing_formulas")
      .select("*")
      .eq("id", data.formulaId)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (error) throw new Error(migrationHint(error.message));
    if (!row) throw new Error("Formula not found");
    const formula = mapFormula(row as Record<string, unknown>);
    const merged: Record<string, number> = {};
    for (const v of formula.variables) {
      const raw = data.values[v.key];
      const n =
        typeof raw === "number" && Number.isFinite(raw)
          ? raw
          : typeof v.default_value === "number"
            ? v.default_value
            : NaN;
      if (!Number.isFinite(n)) {
        throw new Error(`Missing value for ${v.label || v.key}`);
      }
      merged[v.key] = n;
    }
    // Allow extra keys (total_kw helpers) if present in expression
    for (const [k, v] of Object.entries(data.values)) {
      if (Number.isFinite(v) && !(k in merged)) merged[k] = v;
    }
    const result = evaluateSizingExpression(formula.expression, merged);
    return {
      result,
      resultLabel: formula.result_label,
      resultUnit: formula.result_unit,
      expression: formula.expression,
      values: merged,
      name: formula.name,
    };
  });
