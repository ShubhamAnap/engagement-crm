/** Merge tokens for Gmail campaigns — filled per recipient from CRM. */

export type EmailMergeFields = {
  name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  requirement?: string | null;
  sales_person?: string | null;
  location?: string | null;
  source?: string | null;
  status?: string | null;
  notes?: string | null;
};

export const EMAIL_MERGE_TOKEN_HELP = [
  "{{name}}",
  "{{company}}",
  "{{email}}",
  "{{phone}}",
  "{{requirement}}",
  "{{sales_person}}",
  "{{location}}",
  "{{source}}",
  "{{status}}",
  "{{notes}}",
] as const;

function val(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/** Replace {{token}} placeholders (case-insensitive). Unknown tokens → empty. */
export function applyEmailMerge(template: string, fields: EmailMergeFields): string {
  const map: Record<string, string> = {
    name: val(fields.name),
    company: val(fields.company),
    email: val(fields.email),
    phone: val(fields.phone),
    requirement: val(fields.requirement),
    sales_person: val(fields.sales_person),
    salesperson: val(fields.sales_person),
    sales: val(fields.sales_person),
    location: val(fields.location),
    source: val(fields.source),
    status: val(fields.status),
    notes: val(fields.notes),
    note: val(fields.notes),
    "1": val(fields.name),
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/gi, (_full, raw: string) => {
    const key = String(raw || "").toLowerCase();
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : "";
  });
}

export function mergeFieldsFromLead(lead: {
  name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  requirement?: string | null;
  sales_person?: string | null;
  location?: string | null;
  source?: string | null;
  status?: string | null;
  notes?: string | null;
}): EmailMergeFields {
  return {
    name: lead.name,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    requirement: lead.requirement,
    sales_person: lead.sales_person,
    location: lead.location,
    source: lead.source != null ? String(lead.source) : null,
    status: lead.status != null ? String(lead.status) : null,
    notes: lead.notes,
  };
}

export function mergeFieldsFromCustomer(customer: {
  name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}): EmailMergeFields {
  return {
    name: customer.name,
    company: customer.company,
    email: customer.email,
    phone: customer.phone,
    notes: customer.notes,
  };
}
