import { downloadCsv } from "@/lib/csv";
import type { EmailMergeFields } from "@/lib/email-merge";
import { parseCsvText } from "@/lib/leads-import";

export const EMAIL_AUDIENCE_HEADERS = [
  "email",
  "name",
  "company",
  "phone",
  "requirement",
  "sales_person",
  "location",
  "source",
  "status",
  "notes",
] as const;

export type EmailAudienceHeader = (typeof EMAIL_AUDIENCE_HEADERS)[number];

export const MAX_EMAIL_AUDIENCE_ROWS = 500;

export function downloadEmailAudienceTemplate() {
  const header = [...EMAIL_AUDIENCE_HEADERS];
  const example = [
    "rahul@example.com",
    "Rahul Sharma",
    "Acme Industries",
    "919876543210",
    "10kVA Online UPS",
    "Amit",
    "Pune",
    "exhibition",
    "New",
    "Follow up after demo",
  ];
  const blank = header.map(() => "");
  downloadCsv("enertech-email-campaign-audience.csv", [header, example, blank, blank, blank]);
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

function mapHeader(h: string): EmailAudienceHeader | null {
  const key = normalizeHeader(h);
  const aliases: Record<string, EmailAudienceHeader> = {
    email: "email",
    e_mail: "email",
    name: "name",
    full_name: "name",
    contact_name: "name",
    company: "company",
    organisation: "company",
    organization: "company",
    phone: "phone",
    mobile: "phone",
    requirement: "requirement",
    product: "requirement",
    sales_person: "sales_person",
    salesperson: "sales_person",
    sales: "sales_person",
    location: "location",
    city: "location",
    source: "source",
    status: "status",
    notes: "notes",
    note: "notes",
  };
  return aliases[key] || null;
}

function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const e = raw.trim().toLowerCase();
  return e.includes("@") ? e : null;
}

export type EmailAudienceRecipient = {
  email: string;
  name: string | null;
  mergeFields: EmailMergeFields;
};

export type EmailAudienceParseResult = {
  recipients: EmailAudienceRecipient[];
  skippedInvalid: number;
  skippedDuplicate: number;
  errors: string[];
};

/** Parse campaign audience CSV — campaign-only, does not write to leads. */
export function parseEmailAudienceCsv(csvText: string): EmailAudienceParseResult {
  const table = parseCsvText(csvText);
  if (table.length < 2) {
    throw new Error("CSV needs a header row and at least one data row");
  }

  const colIndex = new Map<EmailAudienceHeader, number>();
  table[0].forEach((h, i) => {
    const mapped = mapHeader(h);
    if (mapped && !colIndex.has(mapped)) colIndex.set(mapped, i);
  });

  if (!colIndex.has("email")) {
    throw new Error('CSV must include an "email" column (see template)');
  }

  const dataRows = table.slice(1);
  if (dataRows.length > MAX_EMAIL_AUDIENCE_ROWS) {
    throw new Error(`Max ${MAX_EMAIL_AUDIENCE_ROWS} rows per upload (got ${dataRows.length})`);
  }

  const get = (row: string[], key: EmailAudienceHeader) => {
    const idx = colIndex.get(key);
    if (idx == null) return "";
    return (row[idx] ?? "").trim();
  };

  const seen = new Set<string>();
  const recipients: EmailAudienceRecipient[] = [];
  let skippedInvalid = 0;
  let skippedDuplicate = 0;
  const errors: string[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNum = i + 2;
    const email = normalizeEmail(get(row, "email"));
    if (!email) {
      skippedInvalid += 1;
      errors.push(`Row ${rowNum}: missing or invalid email`);
      continue;
    }
    if (seen.has(email)) {
      skippedDuplicate += 1;
      continue;
    }
    seen.add(email);

    const name = get(row, "name") || null;
    const mergeFields: EmailMergeFields = {
      email,
      name,
      company: get(row, "company") || null,
      phone: get(row, "phone") || null,
      requirement: get(row, "requirement") || null,
      sales_person: get(row, "sales_person") || null,
      location: get(row, "location") || null,
      source: get(row, "source") || null,
      status: get(row, "status") || null,
      notes: get(row, "notes") || null,
    };
    recipients.push({ email, name, mergeFields });
  }

  return {
    recipients,
    skippedInvalid,
    skippedDuplicate,
    errors: errors.slice(0, 20),
  };
}
