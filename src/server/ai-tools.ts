/**
 * Server-side AI tool runners (Calculator, Web search).
 * Only tools that are globally enabled AND allowed on the agent are exposed to the model.
 */
import { createServiceSupabase } from "@/lib/supabase";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";

export type OpenAiToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export async function loadEnabledToolKeys(orgId: string = ORG_ID): Promise<Set<string>> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("ai_tools")
    .select("key, is_enabled")
    .eq("org_id", orgId)
    .eq("is_enabled", true);
  if (error) {
    console.warn("loadEnabledToolKeys", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => String(r.key)));
}

/** Intersection: globally enabled ∩ agent allowed. */
export async function resolveAgentToolKeys(options: {
  orgId?: string;
  allowedOnAgent: string[];
}): Promise<string[]> {
  const enabled = await loadEnabledToolKeys(options.orgId || ORG_ID);
  return options.allowedOnAgent.filter((k) => enabled.has(k));
}

export function openAiToolDefinitions(keys: string[]): OpenAiToolDef[] {
  const defs: OpenAiToolDef[] = [];
  if (keys.includes("calculator")) {
    defs.push({
      type: "function",
      function: {
        name: "calculator",
        description:
          "Evaluate arithmetic, run a sizing formula from the Formulas page, or estimate UPS backup minutes from load and battery capacity. Prefer formula_name when the ask matches a saved formula (battery, inverter, solar, BESS).",
        parameters: {
          type: "object",
          properties: {
            expression: {
              type: "string",
              description: "Optional math expression using numbers and + - * / ( ) and decimals, e.g. (10*0.8)/0.9",
            },
            formula_name: {
              type: "string",
              description: "Optional exact name of a saved Formulas-page sizing formula",
            },
            formula_values: {
              type: "object",
              description: "Numeric values for that formula's variables (keys as defined on Formulas)",
              additionalProperties: { type: "number" },
            },
            ups_kva: { type: "number", description: "UPS rating in kVA" },
            load_fraction: {
              type: "number",
              description: "Load as fraction of rating, e.g. 0.6 for 60%",
            },
            battery_ah: { type: "number", description: "Total battery amp-hours in the string" },
            battery_voltage: { type: "number", description: "DC bus voltage, e.g. 96" },
            efficiency: {
              type: "number",
              description: "Optional inverter efficiency 0–1, default 0.9",
            },
          },
        },
      },
    });
  }
  if (keys.includes("web_search")) {
    defs.push({
      type: "function",
      function: {
        name: "web_search",
        description:
          "Search the public web for general facts. Do NOT use for product specs, prices, or warranty — use Knowledge Base instead.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      },
    });
  }
  return defs;
}

function safeEvaluate(expression: string): number {
  const cleaned = expression.replace(/\s+/g, "");
  if (!/^[\d.+\-*/()]+$/.test(cleaned)) {
    throw new Error("Expression may only contain numbers and + - * / ( )");
  }
  // eslint-disable-next-line no-new-func
  const result = Function(`"use strict"; return (${cleaned});`)();
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error("Expression did not evaluate to a finite number");
  }
  return result;
}

export async function runAiTool(
  name: string,
  argsJson: string,
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
  } catch {
    return JSON.stringify({ error: "Invalid tool arguments JSON" });
  }

  if (name === "calculator") {
    try {
      const expression = typeof args.expression === "string" ? args.expression.trim() : "";
      if (expression) {
        const value = safeEvaluate(expression);
        return JSON.stringify({ ok: true, expression, value });
      }

      const formulaName = typeof args.formula_name === "string" ? args.formula_name.trim() : "";
      const formulaValues =
        args.formula_values && typeof args.formula_values === "object" && !Array.isArray(args.formula_values)
          ? (args.formula_values as Record<string, unknown>)
          : {};
      if (formulaName) {
        const { evaluateSizingExpression } = await import("@/server/formulas");
        const supabase = createServiceSupabase();
        const { data: formulas, error } = await supabase
          .from("sizing_formulas")
          .select("name, expression, result_label, result_unit, variables, notes, is_active")
          .eq("org_id", ORG_ID)
          .eq("is_active", true);
        if (error) {
          return JSON.stringify({ ok: false, error: error.message, hint: "Run 027_sizing_formulas.sql if missing." });
        }
        const needle = formulaName.toLowerCase();
        const formula = (formulas || []).find((f) => String(f.name || "").toLowerCase() === needle)
          || (formulas || []).find((f) => String(f.name || "").toLowerCase().includes(needle));
        if (!formula) {
          const names = (formulas || []).map((f) => f.name).slice(0, 12);
          return JSON.stringify({
            ok: false,
            error: `No active formula named “${formulaName}”.`,
            available: names,
          });
        }
        const vars: Record<string, number> = {};
        const defined = Array.isArray(formula.variables) ? formula.variables : [];
        for (const v of defined as Array<{ key?: string; default_value?: number }>) {
          const key = String(v.key || "");
          if (!key) continue;
          const raw = formulaValues[key];
          const n = typeof raw === "number" ? raw : Number(raw);
          if (Number.isFinite(n)) vars[key] = n;
          else if (typeof v.default_value === "number") vars[key] = v.default_value;
        }
        for (const [k, raw] of Object.entries(formulaValues)) {
          const n = typeof raw === "number" ? raw : Number(raw);
          if (Number.isFinite(n) && !(k in vars)) vars[k] = n;
        }
        const value = evaluateSizingExpression(String(formula.expression), vars);
        return JSON.stringify({
          ok: true,
          formula: formula.name,
          expression: formula.expression,
          values: vars,
          result_label: formula.result_label,
          result_unit: formula.result_unit,
          notes: formula.notes,
          value,
        });
      }

      const upsKva = Number(args.ups_kva);
      const loadFraction = Number(args.load_fraction ?? 0.6);
      const batteryAh = Number(args.battery_ah);
      const batteryVoltage = Number(args.battery_voltage);
      const efficiency = Number(args.efficiency ?? 0.9);

      if (
        ![upsKva, loadFraction, batteryAh, batteryVoltage, efficiency].every((n) =>
          Number.isFinite(n),
        ) ||
        upsKva <= 0 ||
        batteryAh <= 0 ||
        batteryVoltage <= 0
      ) {
        return JSON.stringify({
          ok: false,
          error:
            "Provide expression, or ups_kva + battery_ah + battery_voltage (+ optional load_fraction, efficiency).",
        });
      }

      const loadKw = upsKva * Math.min(Math.max(loadFraction, 0.05), 1.2) * 0.8; // assume pf≈0.8
      const energyWh = batteryVoltage * batteryAh * Math.min(Math.max(efficiency, 0.5), 0.98);
      const minutes = (energyWh / Math.max(loadKw * 1000, 1)) * 60;

      return JSON.stringify({
        ok: true,
        assumptions: {
          power_factor: 0.8,
          load_fraction: loadFraction,
          efficiency,
          note: "Indicative only — confirm with application engineering for critical loads.",
        },
        load_kw_approx: Number(loadKw.toFixed(3)),
        battery_energy_wh_approx: Number(energyWh.toFixed(1)),
        runtime_minutes_approx: Number(minutes.toFixed(1)),
      });
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : "Calculator failed",
      });
    }
  }

  if (name === "web_search") {
    const query = String(args.query || "").trim();
    if (!query) return JSON.stringify({ ok: false, error: "query is required" });

    const apiKey = process.env.TAVILY_API_KEY || process.env.WEB_SEARCH_API_KEY || "";
    if (!apiKey) {
      return JSON.stringify({
        ok: false,
        error:
          "Web search is enabled but no API key is configured (set TAVILY_API_KEY on the server). Prefer Knowledge Base for product facts.",
      });
    }

    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: "basic",
          max_results: 5,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
        error?: string;
      };
      if (!res.ok) {
        return JSON.stringify({
          ok: false,
          error: json.error || `Search failed (${res.status})`,
        });
      }
      const results = (json.results || []).map((r) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: (r.content || "").slice(0, 400),
      }));
      return JSON.stringify({
        ok: true,
        query,
        results,
        reminder: "Do not treat web results as catalogue truth.",
      });
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : "Web search failed",
      });
    }
  }

  return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
}
