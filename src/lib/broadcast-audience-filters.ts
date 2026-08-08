/** Optional AND filters for lead-based broadcast audiences. */

export type BroadcastLeadFilterField = "sales_person" | "status" | "source" | "location";

export type BroadcastLeadFilter = {
  field: BroadcastLeadFilterField;
  /** Case-insensitive equality (trimmed). Empty value = ignore this row. */
  value: string;
};

/** Minimal directory row for sales_person filter matching (email ↔ display name). */
export type BroadcastSalesPersonDirectoryEntry = {
  email: string;
  display_name: string;
  is_active?: boolean;
};

export const BROADCAST_LEAD_FILTER_FIELDS: Array<{
  value: BroadcastLeadFilterField;
  label: string;
}> = [
  { value: "sales_person", label: "Sales person" },
  { value: "status", label: "Status" },
  { value: "source", label: "Source" },
  { value: "location", label: "Location" },
];

export function normalizeBroadcastLeadFilters(
  filters: BroadcastLeadFilter[] | null | undefined,
): BroadcastLeadFilter[] {
  if (!Array.isArray(filters)) return [];
  return filters
    .map((f) => ({
      field: f.field,
      value: String(f.value || "").trim(),
    }))
    .filter((f) => f.value.length > 0 && BROADCAST_LEAD_FILTER_FIELDS.some((o) => o.value === f.field));
}

function fieldValue(
  lead: Record<string, unknown>,
  field: BroadcastLeadFilterField,
): string {
  const raw = lead[field];
  return raw == null ? "" : String(raw).trim();
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Match lead.sales_person against filter value using directory.
 * Leads often store email; UI filter stores email; also match display name either way.
 */
export function salesPersonMatchesFilter(
  leadSalesPerson: string,
  filterValue: string,
  directory?: BroadcastSalesPersonDirectoryEntry[] | null,
): boolean {
  const lead = normalizeKey(leadSalesPerson);
  const filter = normalizeKey(filterValue);
  if (!lead || !filter) return false;
  if (lead === filter) return true;

  const active = (directory || []).filter((d) => d.is_active !== false);
  const entry = active.find(
    (d) =>
      normalizeKey(d.email) === filter ||
      normalizeKey(d.display_name) === filter ||
      normalizeKey(d.email) === lead ||
      normalizeKey(d.display_name) === lead,
  );
  if (!entry) return false;

  const emails = normalizeKey(entry.email);
  const name = normalizeKey(entry.display_name);
  return (
    (lead === emails || lead === name) &&
    (filter === emails || filter === name)
  );
}

/** True if lead matches all filters (AND). Empty filter list = match all. */
export function leadMatchesBroadcastFilters(
  lead: Record<string, unknown>,
  filters: BroadcastLeadFilter[] | null | undefined,
  directory?: BroadcastSalesPersonDirectoryEntry[] | null,
): boolean {
  const active = normalizeBroadcastLeadFilters(filters);
  if (!active.length) return true;
  return active.every((f) => {
    const lv = fieldValue(lead, f.field);
    if (f.field === "sales_person") {
      return salesPersonMatchesFilter(lv, f.value, directory);
    }
    return normalizeKey(lv) === normalizeKey(f.value);
  });
}

export function audienceSupportsLeadFilters(kind: string): boolean {
  return kind === "leads_with_phone" || kind === "indiamart_leads" || kind === "leads_with_email";
}
