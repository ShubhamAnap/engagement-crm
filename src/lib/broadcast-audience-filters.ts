/** Optional AND filters for lead-based broadcast audiences. */

export type BroadcastLeadFilterField = "sales_person" | "status" | "source" | "location";

export type BroadcastLeadFilter = {
  field: BroadcastLeadFilterField;
  /** Case-insensitive equality (trimmed). Empty value = ignore this row. */
  value: string;
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

/** True if lead matches all filters (AND). Empty filter list = match all. */
export function leadMatchesBroadcastFilters(
  lead: Record<string, unknown>,
  filters: BroadcastLeadFilter[] | null | undefined,
): boolean {
  const active = normalizeBroadcastLeadFilters(filters);
  if (!active.length) return true;
  return active.every((f) => fieldValue(lead, f.field).toLowerCase() === f.value.toLowerCase());
}

export function audienceSupportsLeadFilters(kind: string): boolean {
  return kind === "leads_with_phone" || kind === "indiamart_leads" || kind === "leads_with_email";
}
