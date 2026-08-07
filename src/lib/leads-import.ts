import { downloadCsv } from "@/lib/csv";
import { getBrowserSupabase } from "@/lib/supabase";
import type { ChannelType, LeadStatus, PriorityLevel } from "@/lib/db-types";
import { createLead, type LeadInput } from "@/lib/leads-api";
import { normalizeLeadPhone } from "@/lib/whatsapp-window";

export const LEAD_IMPORT_HEADERS = [
  "name",
  "email",
  "phone",
  "company",
  "location",
  "source",
  "requirement",
  "sales_person",
  "status",
  "priority",
  "notes",
  "tags",
] as const;

export type LeadImportHeader = (typeof LEAD_IMPORT_HEADERS)[number];

const MAX_IMPORT_ROWS = 500;

const STATUS_SET = new Set<LeadStatus>([
  "New",
  "Contacted",
  "Qualified",
  "Proposal",
  "Negotiation",
  "Won",
  "Lost",
]);

const PRIORITY_SET = new Set<PriorityLevel>(["High", "Medium", "Low"]);

const SOURCE_SET = new Set<ChannelType>([
  "website",
  "whatsapp",
  "email",
  "instagram",
  "facebook",
  "indiamart",
  "tradeindia",
  "brainmine",
  "api",
  "webhook",
]);

export function downloadLeadsImportTemplate() {
  const header = [...LEAD_IMPORT_HEADERS];
  const example = [
    "Rahul Sharma",
    "rahul@example.com",
    "919876543210",
    "Acme Industries",
    "Pune",
    "api",
    "10kVA Online UPS",
    "Amit",
    "New",
    "Medium",
    "Called from exhibition",
    "remarketing,hot",
  ];
  const blank = header.map(() => "");
  downloadCsv("enertech-leads-import-template.csv", [header, example, blank, blank, blank]);
}

/** Minimal RFC4180-ish CSV parse (handles quotes). */
export function parseCsvText(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

function mapHeader(h: string): LeadImportHeader | null {
  const key = normalizeHeader(h);
  const aliases: Record<string, LeadImportHeader> = {
    name: "name",
    full_name: "name",
    contact_name: "name",
    email: "email",
    e_mail: "email",
    phone: "phone",
    mobile: "phone",
    mobile_no: "phone",
    company: "company",
    organisation: "company",
    organization: "company",
    location: "location",
    city: "location",
    source: "source",
    requirement: "requirement",
    product: "requirement",
    product_label: "requirement",
    sales_person: "sales_person",
    salesperson: "sales_person",
    sales: "sales_person",
    assigned_to: "sales_person",
    status: "status",
    priority: "priority",
    notes: "notes",
    note: "notes",
    tags: "tags",
    tag: "tags",
  };
  return aliases[key] || null;
}

function parseSource(raw: string | undefined): ChannelType {
  const v = (raw || "").trim().toLowerCase();
  if (!v) return "api";
  if (SOURCE_SET.has(v as ChannelType)) return v as ChannelType;
  if (v === "csv" || v === "csv_import" || v === "manual" || v === "import") return "api";
  return "api";
}

function parseStatus(raw: string | undefined): LeadStatus {
  const v = (raw || "").trim();
  if (!v) return "New";
  const match = [...STATUS_SET].find((s) => s.toLowerCase() === v.toLowerCase());
  return match || "New";
}

function parsePriority(raw: string | undefined): PriorityLevel {
  const v = (raw || "").trim();
  if (!v) return "Medium";
  const match = [...PRIORITY_SET].find((s) => s.toLowerCase() === v.toLowerCase());
  return match || "Medium";
}

function normalizePhone(raw: string | null | undefined): string | null {
  return normalizeLeadPhone(raw);
}

function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const e = raw.trim().toLowerCase();
  return e.includes("@") ? e : null;
}

export type LeadImportResult = {
  imported: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  errors: string[];
};

export async function importLeadsFromCsv(options: {
  orgId: string;
  csvText: string;
  ownerId?: string | null;
}): Promise<LeadImportResult> {
  const table = parseCsvText(options.csvText);
  if (table.length < 2) {
    throw new Error("CSV needs a header row and at least one data row");
  }

  const headerCells = table[0];
  const colIndex = new Map<LeadImportHeader, number>();
  headerCells.forEach((h, i) => {
    const mapped = mapHeader(h);
    if (mapped && !colIndex.has(mapped)) colIndex.set(mapped, i);
  });

  if (!colIndex.has("name")) {
    throw new Error('CSV must include a "name" column (see template)');
  }

  const dataRows = table.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Max ${MAX_IMPORT_ROWS} rows per upload (got ${dataRows.length})`);
  }

  const supabase = getBrowserSupabase();
  const { data: existing, error: exErr } = await supabase
    .from("leads")
    .select("email, phone")
    .eq("org_id", options.orgId)
    .limit(5000);
  if (exErr) throw exErr;

  const existingEmails = new Set<string>();
  const existingPhones = new Set<string>();
  for (const row of existing ?? []) {
    const e = normalizeEmail(row.email as string);
    const p = normalizePhone(row.phone as string);
    if (e) existingEmails.add(e);
    if (p) existingPhones.add(p);
  }

  let imported = 0;
  let skippedDuplicate = 0;
  let skippedInvalid = 0;
  const errors: string[] = [];

  const get = (row: string[], key: LeadImportHeader) => {
    const idx = colIndex.get(key);
    if (idx == null) return "";
    return (row[idx] ?? "").trim();
  };

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNum = i + 2; // 1-based + header
    const name = get(row, "name");
    const email = normalizeEmail(get(row, "email"));
    const phone = normalizePhone(get(row, "phone"));

    if (!name) {
      skippedInvalid += 1;
      errors.push(`Row ${rowNum}: missing name`);
      continue;
    }
    if (!email && !phone) {
      skippedInvalid += 1;
      errors.push(`Row ${rowNum}: need email or phone`);
      continue;
    }

    if ((email && existingEmails.has(email)) || (phone && existingPhones.has(phone))) {
      skippedDuplicate += 1;
      continue;
    }

    const input: LeadInput = {
      orgId: options.orgId,
      ownerId: options.ownerId ?? null,
      name,
      email: email || undefined,
      phone: phone || undefined,
      company: get(row, "company") || undefined,
      location: get(row, "location") || undefined,
      source: parseSource(get(row, "source")),
      requirement: get(row, "requirement") || undefined,
      salesPerson: get(row, "sales_person") || undefined,
      status: parseStatus(get(row, "status")),
      priority: parsePriority(get(row, "priority")),
      notes: get(row, "notes") || undefined,
      tags: get(row, "tags")
        ? get(row, "tags")
            .split(/[,;]+/)
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
      score: 50,
    };

    try {
      await createLead(input);
      imported += 1;
      if (email) existingEmails.add(email);
      if (phone) existingPhones.add(phone);
    } catch (err) {
      skippedInvalid += 1;
      errors.push(`Row ${rowNum}: ${err instanceof Error ? err.message : "import failed"}`);
    }
  }

  return { imported, skippedDuplicate, skippedInvalid, errors: errors.slice(0, 20) };
}

export { MAX_IMPORT_ROWS };
