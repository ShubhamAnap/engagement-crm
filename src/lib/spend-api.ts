import { getBrowserSupabase } from "@/lib/supabase";
import {
  eventCost,
  formatInr,
  formatUsd,
  istDateKey,
  istMonthLabel,
  istMonthStartIso,
  ratesFromRows,
  type SpendEventRow,
  type CostRateRow,
} from "@/lib/spend-math";

export type SpendKpi = {
  label: string;
  value: string;
  hint?: string;
  delta?: string;
  trend?: "up" | "down";
};

export type SpendTableRow = {
  date: string;
  vendor: string;
  units: string;
  inr: number;
  usd: number;
  inrLabel: string;
  usdLabel: string;
};

export type SpendSnapshot = {
  monthLabel: string;
  kpis: SpendKpi[];
  rows: SpendTableRow[];
  csvRows: string[][];
  missingTables: boolean;
};

const PAGE = 1000;

function vsLastMonth(curr: number, prev: number): { delta?: string; trend?: "up" | "down" } {
  if (prev <= 0 && curr <= 0) return {};
  if (prev <= 0) return {};
  const pct = ((curr - prev) / prev) * 100;
  const abs = Math.abs(pct).toFixed(0);
  if (pct > 0.5) return { delta: `+${abs}% vs last mo`, trend: "down" };
  if (pct < -0.5) return { delta: `−${abs}% vs last mo`, trend: "up" };
  return { delta: "flat vs last mo" };
}

function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message || "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    msg.includes("api_spend_events") ||
    msg.includes("cost_rates") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

async function fetchAllEvents(
  supabase: ReturnType<typeof getBrowserSupabase>,
  orgId: string,
  fromIso: string,
): Promise<{ rows: SpendEventRow[]; missingTables: boolean }> {
  const all: SpendEventRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("api_spend_events")
      .select(
        "id, org_id, kind, vendor, model, prompt_tokens, completion_tokens, total_tokens, units, conversation_id, metadata, created_at",
      )
      .eq("org_id", orgId)
      .gte("created_at", fromIso)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return { rows: [], missingTables: true };
      throw new Error(error.message);
    }
    const chunk = (data || []) as SpendEventRow[];
    all.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return { rows: all, missingTables: false };
}

function unitsLabel(kind: string, events: SpendEventRow[]): string {
  if (kind.startsWith("openai")) {
    const tokens = events.reduce(
      (s, e) => s + (Number(e.total_tokens) || Number(e.prompt_tokens) + Number(e.completion_tokens)),
      0,
    );
    return `${tokens.toLocaleString("en-IN")} tok`;
  }
  const templates = events.filter((e) => e.kind === "whatsapp_template").reduce((s, e) => s + Number(e.units || 1), 0);
  const session = events.filter((e) => e.kind === "whatsapp_session").reduce((s, e) => s + Number(e.units || 1), 0);
  const parts: string[] = [];
  if (templates) parts.push(`${templates.toLocaleString("en-IN")} tmpl`);
  if (session) parts.push(`${session.toLocaleString("en-IN")} session`);
  return parts.join(" · ") || "0";
}

export async function getSpendSnapshot(orgId: string): Promise<SpendSnapshot> {
  const supabase = getBrowserSupabase();
  const thisStart = istMonthStartIso(new Date(), 0);
  const lastStart = istMonthStartIso(new Date(), 1);
  const nextStart = istMonthStartIso(new Date(), -1);

  const ratesRes = await supabase.from("cost_rates").select("key, amount, unit").eq("org_id", orgId);
  if (ratesRes.error && isMissingTable(ratesRes.error)) {
    return emptySnapshot(true);
  }
  if (ratesRes.error) throw new Error(ratesRes.error.message);
  const rates = ratesFromRows((ratesRes.data || []) as CostRateRow[]);

  const fetched = await fetchAllEvents(supabase, orgId, lastStart);
  if (fetched.missingTables) return emptySnapshot(true);

  const thisStartMs = new Date(thisStart).getTime();
  const lastStartMs = new Date(lastStart).getTime();
  const nextStartMs = new Date(nextStart).getTime();

  const thisEvents = fetched.rows.filter((e) => {
    const t = new Date(e.created_at).getTime();
    return t >= thisStartMs && t < nextStartMs;
  });
  const lastEvents = fetched.rows.filter((e) => {
    const t = new Date(e.created_at).getTime();
    return t >= lastStartMs && t < thisStartMs;
  });

  const sumVendor = (events: SpendEventRow[], vendor: "openai" | "meta") => {
    let inr = 0;
    let usd = 0;
    for (const e of events) {
      if (e.vendor !== vendor && !(vendor === "meta" && e.vendor === "whatsapp")) continue;
      const c = eventCost(e, rates);
      inr += c.inr;
      usd += c.usd;
    }
    return { inr, usd };
  };

  const thisOa = sumVendor(thisEvents, "openai");
  const thisWa = sumVendor(thisEvents, "meta");
  const lastOa = sumVendor(lastEvents, "openai");
  const lastWa = sumVendor(lastEvents, "meta");
  const thisTotal = thisOa.inr + thisWa.inr;
  const lastTotal = lastOa.inr + lastWa.inr;

  const totalDelta = vsLastMonth(thisTotal, lastTotal);
  const oaDelta = vsLastMonth(thisOa.inr, lastOa.inr);
  const waDelta = vsLastMonth(thisWa.inr, lastWa.inr);

  const kpis: SpendKpi[] = [
    {
      label: "OpenAI (this month)",
      value: formatInr(thisOa.inr),
      hint: `${formatUsd(thisOa.usd)} · billed tokens × rate card`,
      ...oaDelta,
    },
    {
      label: "WhatsApp (this month)",
      value: formatInr(thisWa.inr),
      hint: "Outbound × India rate card (not Inbox bubbles)",
      ...waDelta,
    },
    {
      label: "Total API spend",
      value: formatInr(thisTotal),
      hint: `IST month · FX ${rates["fx.usd_inr"]} ₹/USD`,
      ...totalDelta,
    },
    {
      label: "vs last month",
      value: lastTotal <= 0 && thisTotal <= 0 ? "—" : formatInr(thisTotal - lastTotal),
      hint: lastTotal <= 0 ? "No prior-month log yet" : `Last month ${formatInr(lastTotal)}`,
      ...totalDelta,
    },
  ];

  type Bucket = { date: string; vendor: string; events: SpendEventRow[] };
  const buckets = new Map<string, Bucket>();
  for (const e of thisEvents) {
    const vendor = e.vendor === "openai" ? "OpenAI" : "WhatsApp";
    const date = istDateKey(e.created_at);
    const key = `${date}|${vendor}`;
    const existing = buckets.get(key);
    if (existing) existing.events.push(e);
    else buckets.set(key, { date, vendor, events: [e] });
  }

  const rows: SpendTableRow[] = [...buckets.values()]
    .sort((a, b) => (a.date === b.date ? a.vendor.localeCompare(b.vendor) : a.date.localeCompare(b.date)))
    .map((b) => {
      let inr = 0;
      let usd = 0;
      for (const e of b.events) {
        const c = eventCost(e, rates);
        inr += c.inr;
        usd += c.usd;
      }
      const kindHint = b.vendor === "OpenAI" ? "openai_chat" : "whatsapp_template";
      return {
        date: b.date,
        vendor: b.vendor,
        units: unitsLabel(kindHint, b.events),
        inr,
        usd,
        inrLabel: formatInr(inr),
        usdLabel: formatUsd(usd),
      };
    });

  const csvRows: string[][] = [
    ["Date (IST)", "Vendor", "Units", "Estimated INR", "Estimated USD"],
    ...rows.map((r) => [r.date, r.vendor, r.units, r.inr.toFixed(4), r.usd.toFixed(6)]),
    [],
    ["This month OpenAI INR", thisOa.inr.toFixed(4)],
    ["This month WhatsApp INR", thisWa.inr.toFixed(4)],
    ["This month total INR", thisTotal.toFixed(4)],
    ["Last month total INR", lastTotal.toFixed(4)],
    ["FX INR per USD", String(rates["fx.usd_inr"])],
  ];

  return {
    monthLabel: istMonthLabel(thisStart),
    kpis,
    rows,
    csvRows,
    missingTables: false,
  };
}

function emptySnapshot(missingTables: boolean): SpendSnapshot {
  return {
    monthLabel: istMonthLabel(istMonthStartIso()),
    kpis: [
      { label: "OpenAI (this month)", value: "₹0.00", hint: missingTables ? "Run 037_api_spend.sql" : undefined },
      { label: "WhatsApp (this month)", value: "₹0.00" },
      { label: "Total API spend", value: "₹0.00" },
      { label: "vs last month", value: "—" },
    ],
    rows: [],
    csvRows: [["Date (IST)", "Vendor", "Units", "Estimated INR", "Estimated USD"]],
    missingTables,
  };
}
