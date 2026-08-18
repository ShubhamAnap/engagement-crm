/** Pure cost math for Dashboard / CSV. Rates come from cost_rates (or these defaults). */

export type SpendKind = "openai_chat" | "openai_embed" | "whatsapp_session" | "whatsapp_template";

export type SpendEventRow = {
  id: string;
  org_id: string;
  kind: SpendKind | string;
  vendor: string;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  units: number;
  conversation_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type CostRateRow = {
  key: string;
  amount: number;
  unit: string;
};

export type CostRateMap = Record<string, number>;

/** Public list as of 2026 — finance should update cost_rates when vendors change. */
export const DEFAULT_COST_RATES: CostRateMap = {
  "openai.gpt-4o-mini.input": 0.15,
  "openai.gpt-4o-mini.output": 0.6,
  "openai.default.input": 0.15,
  "openai.default.output": 0.6,
  "openai.text-embedding-3-small": 0.02,
  "openai.default.embed": 0.02,
  "whatsapp.in.marketing": 0.8631,
  "whatsapp.in.utility": 0.115,
  "whatsapp.in.service": 0,
  "fx.usd_inr": 87,
};

export function ratesFromRows(rows: CostRateRow[] | null | undefined): CostRateMap {
  const out = { ...DEFAULT_COST_RATES };
  for (const row of rows || []) {
    const n = Number(row.amount);
    if (row.key && Number.isFinite(n)) out[row.key] = n;
  }
  return out;
}

function modelBase(model: string | null | undefined): string {
  const raw = (model || "gpt-4o-mini").trim().toLowerCase();
  return raw.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

function openaiTokenRates(model: string | null | undefined, rates: CostRateMap): { input: number; output: number } {
  const base = modelBase(model);
  const exact = (model || "").trim().toLowerCase();
  const input =
    rates[`openai.${exact}.input`] ?? rates[`openai.${base}.input`] ?? rates["openai.default.input"] ?? 0.15;
  const output =
    rates[`openai.${exact}.output`] ?? rates[`openai.${base}.output`] ?? rates["openai.default.output"] ?? 0.6;
  return { input, output };
}

function embedRate(model: string | null | undefined, rates: CostRateMap): number {
  const exact = (model || "text-embedding-3-small").trim().toLowerCase();
  const base = modelBase(exact);
  return rates[`openai.${exact}`] ?? rates[`openai.${base}`] ?? rates["openai.default.embed"] ?? 0.02;
}

export function eventCost(event: SpendEventRow, rates: CostRateMap): { usd: number; inr: number } {
  const fx = Number(rates["fx.usd_inr"]) || DEFAULT_COST_RATES["fx.usd_inr"];

  if (event.kind === "openai_chat") {
    const { input, output } = openaiTokenRates(event.model, rates);
    const usd = (Number(event.prompt_tokens) / 1_000_000) * input + (Number(event.completion_tokens) / 1_000_000) * output;
    return { usd, inr: usd * fx };
  }

  if (event.kind === "openai_embed") {
    const tokens = Number(event.total_tokens) || Number(event.prompt_tokens) || 0;
    const usd = (tokens / 1_000_000) * embedRate(event.model, rates);
    return { usd, inr: usd * fx };
  }

  const units = Number(event.units);
  const qty = Number.isFinite(units) && units > 0 ? units : 1;
  const category = String(event.metadata?.category || event.metadata?.template_category || "MARKETING").toUpperCase();
  let inrEach = Number(rates["whatsapp.in.service"]) || 0;
  if (event.kind === "whatsapp_template") {
    inrEach =
      category === "UTILITY" || category === "AUTHENTICATION"
        ? Number(rates["whatsapp.in.utility"]) || 0
        : Number(rates["whatsapp.in.marketing"]) || 0;
  }
  const inr = qty * inrEach;
  return { inr, usd: fx > 0 ? inr / fx : 0 };
}

export function formatInr(amount: number): string {
  if (!Number.isFinite(amount)) return "₹0.00";
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return "$0.0000";
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

const IST = "Asia/Kolkata";

export function istDateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** IST calendar month start as an ISO timestamptz. */
export function istMonthStartIso(ref = new Date(), monthsAgo = 0): string {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ref);
  const [yRaw, mRaw] = key.split("-").map(Number);
  let y = yRaw;
  let m = mRaw - monthsAgo;
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, "0")}-01T00:00:00+05:30`;
}

export function istMonthLabel(isoStart: string): string {
  const d = new Date(isoStart);
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: IST });
}
