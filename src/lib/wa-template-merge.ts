/**
 * Map WhatsApp template body variables → CRM columns (or fixed text).
 * Used by Broadcasting and Automations so each recipient gets their own values.
 */

export type WaCrmFieldKey =
  | "name"
  | "first_name"
  | "company"
  | "email"
  | "phone"
  | "requirement"
  | "sales_person"
  | "location"
  | "source"
  | "status"
  | "notes";

/** Per template variable: pull from a CRM field, or use fixed text for everyone. */
export type WaParamBinding = {
  source: WaCrmFieldKey | "__static__";
  staticValue?: string;
};

export type WaMergeFields = {
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

export const WA_CRM_FIELD_OPTIONS: Array<{ value: WaCrmFieldKey | "__static__"; label: string }> = [
  { value: "name", label: "Name" },
  { value: "first_name", label: "First name" },
  { value: "company", label: "Company" },
  { value: "requirement", label: "Requirement" },
  { value: "sales_person", label: "Sales person" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "location", label: "Location" },
  { value: "source", label: "Source" },
  { value: "status", label: "Status" },
  { value: "notes", label: "Notes" },
  { value: "__static__", label: "Fixed text (same for all)" },
];

function trim(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function firstName(full: string | null | undefined): string {
  const n = trim(full);
  if (!n) return "";
  return n.split(/\s+/)[0] || n;
}

/** Resolve one binding against a recipient’s CRM / merge fields. */
export function resolveWaParamValue(binding: WaParamBinding | null | undefined, fields: WaMergeFields): string {
  if (!binding) return "";
  if (binding.source === "__static__") return trim(binding.staticValue);
  switch (binding.source) {
    case "name":
      return trim(fields.name) || "Customer";
    case "first_name":
      return firstName(fields.name) || "Customer";
    case "company":
      return trim(fields.company);
    case "email":
      return trim(fields.email);
    case "phone":
      return trim(fields.phone);
    case "requirement":
      return trim(fields.requirement);
    case "sales_person":
      return trim(fields.sales_person);
    case "location":
      return trim(fields.location);
    case "source":
      return trim(fields.source);
    case "status":
      return trim(fields.status);
    case "notes":
      return trim(fields.notes);
    default:
      return "";
  }
}

export function resolveWaBodyParams(
  bindings: WaParamBinding[],
  fields: WaMergeFields,
): string[] {
  return bindings.map((b) => resolveWaParamValue(b, fields));
}

/** Guess a CRM column from Meta placeholder label (name, 1, first_name, …). */
export function guessWaBindingForLabel(label: string): WaParamBinding {
  const key = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (!key || /^\d+$/.test(key)) {
    // Positional {{1}} → name, {{2}} → requirement, {{3}} → sales_person as sensible defaults
    const n = Number(key);
    if (n === 1) return { source: "name" };
    if (n === 2) return { source: "requirement" };
    if (n === 3) return { source: "sales_person" };
    if (n === 4) return { source: "company" };
    return { source: "name" };
  }

  if (key === "first_name" || key === "firstname" || key === "fname") return { source: "first_name" };
  if (key === "name" || key === "customer" || key === "customer_name" || key === "full_name") {
    return { source: "name" };
  }
  if (key === "company" || key === "org" || key === "organization") return { source: "company" };
  if (key === "requirement" || key === "product" || key === "enquiry" || key === "inquiry") {
    return { source: "requirement" };
  }
  if (
    key === "sales_person" ||
    key === "salesperson" ||
    key === "sales" ||
    key === "owner" ||
    key === "agent"
  ) {
    return { source: "sales_person" };
  }
  if (key === "phone" || key === "mobile") return { source: "phone" };
  if (key === "email") return { source: "email" };
  if (key === "location" || key === "city" || key === "place") return { source: "location" };
  if (key === "source") return { source: "source" };
  if (key === "status") return { source: "status" };
  if (key === "notes" || key === "note") return { source: "notes" };

  return { source: "name" };
}

export function defaultBindingsForLabels(labels: string[]): WaParamBinding[] {
  return labels.map((l) => guessWaBindingForLabel(l));
}

export function bindingsAreComplete(bindings: WaParamBinding[], expectedCount: number): boolean {
  if (expectedCount <= 0) return true;
  if (bindings.length < expectedCount) return false;
  return bindings.slice(0, expectedCount).every((b) => {
    if (b.source === "__static__") return Boolean(trim(b.staticValue));
    return Boolean(b.source);
  });
}

export function parseStoredBindings(raw: unknown, fallbackLabels: string[]): WaParamBinding[] {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((item, i) => {
      if (item && typeof item === "object" && "source" in item) {
        const src = String((item as WaParamBinding).source || "");
        const staticValue =
          typeof (item as WaParamBinding).staticValue === "string"
            ? (item as WaParamBinding).staticValue
            : undefined;
        if (src === "__static__" || WA_CRM_FIELD_OPTIONS.some((o) => o.value === src)) {
          return { source: src as WaParamBinding["source"], staticValue };
        }
      }
      if (typeof item === "string") {
        // Legacy: literal "{{name}}" or fixed text stored as bodyParams
        const m = item.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
        if (m) return guessWaBindingForLabel(m[1]);
        return { source: "__static__", staticValue: item };
      }
      return guessWaBindingForLabel(fallbackLabels[i] || "name");
    });
  }
  return defaultBindingsForLabels(fallbackLabels);
}

export function mergeFieldsFromLeadRow(lead: {
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
}): WaMergeFields {
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

export function mergeFieldsFromCustomerRow(customer: {
  name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}): WaMergeFields {
  return {
    name: customer.name,
    company: customer.company,
    email: customer.email,
    phone: customer.phone,
    notes: customer.notes,
  };
}
