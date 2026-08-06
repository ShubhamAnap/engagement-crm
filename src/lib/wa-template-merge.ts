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
  | "sales_person_mobile"
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
  sales_person_mobile?: string | null;
  location?: string | null;
  source?: string | null;
  status?: string | null;
  notes?: string | null;
};

export type SalesPersonDirectoryEntry = {
  email: string;
  display_name: string;
  mobile?: string | null;
  is_active?: boolean;
};

export const WA_CRM_FIELD_OPTIONS: Array<{ value: WaCrmFieldKey | "__static__"; label: string }> = [
  { value: "name", label: "Name" },
  { value: "first_name", label: "First name" },
  { value: "company", label: "Company" },
  { value: "requirement", label: "Requirement" },
  { value: "sales_person", label: "Sales person (name from directory)" },
  { value: "sales_person_mobile", label: "Sales person mobile (from directory)" },
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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** If sales_person looks like an email, map to directory display name. */
export function applySalesPersonDirectory(
  fields: WaMergeFields,
  directory: SalesPersonDirectoryEntry[] | null | undefined,
): WaMergeFields {
  if (!directory?.length) return fields;
  const raw = trim(fields.sales_person);
  if (!raw) return fields;

  let display = raw;
  let mobile = trim(fields.sales_person_mobile);

  if (raw.includes("@")) {
    const email = normalizeEmail(raw);
    const hit = directory.find(
      (d) => normalizeEmail(d.email) === email && d.is_active !== false,
    );
    if (hit) {
      display = trim(hit.display_name) || raw;
      if (!mobile) mobile = trim(hit.mobile);
    }
  } else {
    const byName = directory.find(
      (d) =>
        d.is_active !== false &&
        trim(d.display_name).toLowerCase() === raw.toLowerCase(),
    );
    if (byName && !mobile) mobile = trim(byName.mobile);
  }

  return {
    ...fields,
    sales_person: display,
    sales_person_mobile: mobile || fields.sales_person_mobile || null,
  };
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
    case "sales_person_mobile":
      return trim(fields.sales_person_mobile);
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
  directory?: SalesPersonDirectoryEntry[] | null,
): string[] {
  const merged = applySalesPersonDirectory(fields, directory);
  return bindings.map((b) => resolveWaParamValue(b, merged));
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
  if (
    key === "sales_person_mobile" ||
    key === "salesperson_mobile" ||
    key === "sales_mobile" ||
    key === "agent_mobile"
  ) {
    return { source: "sales_person_mobile" };
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
