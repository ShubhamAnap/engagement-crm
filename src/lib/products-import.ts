import { downloadCsv } from "@/lib/csv";
import { getBrowserSupabase } from "@/lib/supabase";
import type { StockStatus } from "@/lib/db-types";
import { createProduct, type ProductInput } from "@/lib/products-api";
import { parseCsvText } from "@/lib/leads-import";

export const PRODUCT_IMPORT_HEADERS = [
  "sku",
  "name",
  "category",
  "description",
  "stock_status",
  "quantity",
  "price_label",
  "mrp_label",
  "battery_spec",
  "runtime_spec",
] as const;

export type ProductImportHeader = (typeof PRODUCT_IMPORT_HEADERS)[number];

export const MAX_PRODUCT_IMPORT_ROWS = 500;

const STOCK_SET = new Set<StockStatus>(["In Stock", "Low Stock", "Made to Order", "Out of Stock"]);

export function downloadProductsImportTemplate() {
  const header = [...PRODUCT_IMPORT_HEADERS];
  const example = [
    "EN-3000X",
    "EnerTech Online UPS 3kVA",
    "UPS",
    "True online UPS for mid-size offices",
    "In Stock",
    "12",
    "₹45900",
    "₹52900",
    "8 x 42Ah",
    "42–48 minutes at 60% load",
  ];
  const blank = header.map(() => "");
  downloadCsv("enertech-products-import-template.csv", [header, example, blank, blank, blank]);
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

function mapHeader(h: string): ProductImportHeader | null {
  const key = normalizeHeader(h);
  const aliases: Record<string, ProductImportHeader> = {
    sku: "sku",
    product_code: "sku",
    product_sku: "sku",
    code: "sku",
    name: "name",
    product_name: "name",
    title: "name",
    category: "category",
    description: "description",
    desc: "description",
    stock_status: "stock_status",
    stock: "stock_status",
    status: "stock_status",
    quantity: "quantity",
    qty: "quantity",
    stock_qty: "quantity",
    price_label: "price_label",
    price: "price_label",
    sale_price: "price_label",
    mrp_label: "mrp_label",
    mrp: "mrp_label",
    regular_price: "mrp_label",
    battery_spec: "battery_spec",
    battery: "battery_spec",
    runtime_spec: "runtime_spec",
    runtime: "runtime_spec",
  };
  return aliases[key] || null;
}

function parseStockStatus(raw: string | undefined): StockStatus {
  const v = (raw || "").trim();
  if (!v) return "In Stock";
  const match = [...STOCK_SET].find((s) => s.toLowerCase() === v.toLowerCase());
  return match || "In Stock";
}

function parseQuantity(raw: string | undefined): number {
  const digits = (raw || "").replace(/[^\d-]/g, "");
  if (!digits) return 0;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export type ProductImportResult = {
  imported: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  errors: string[];
};

export async function importProductsFromCsv(options: {
  orgId: string;
  csvText: string;
}): Promise<ProductImportResult> {
  const table = parseCsvText(options.csvText);
  if (table.length < 2) {
    throw new Error("CSV needs a header row and at least one data row");
  }

  const headerCells = table[0];
  const colIndex = new Map<ProductImportHeader, number>();
  headerCells.forEach((h, i) => {
    const mapped = mapHeader(h);
    if (mapped && !colIndex.has(mapped)) colIndex.set(mapped, i);
  });

  if (!colIndex.has("sku") || !colIndex.has("name")) {
    throw new Error('CSV must include "sku" and "name" columns (see template)');
  }

  const dataRows = table.slice(1);
  if (dataRows.length > MAX_PRODUCT_IMPORT_ROWS) {
    throw new Error(`Max ${MAX_PRODUCT_IMPORT_ROWS} rows per upload (got ${dataRows.length})`);
  }

  const supabase = getBrowserSupabase();
  const { data: existing, error: exErr } = await supabase
    .from("products")
    .select("sku")
    .eq("org_id", options.orgId)
    .limit(5000);
  if (exErr) throw exErr;

  const existingSkus = new Set(
    (existing ?? [])
      .map((r) => String(r.sku || "").trim().toUpperCase())
      .filter(Boolean),
  );

  let imported = 0;
  let skippedDuplicate = 0;
  let skippedInvalid = 0;
  const errors: string[] = [];

  const get = (row: string[], key: ProductImportHeader) => {
    const idx = colIndex.get(key);
    if (idx == null) return "";
    return (row[idx] ?? "").trim();
  };

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNum = i + 2;
    const sku = get(row, "sku");
    const name = get(row, "name");

    if (!sku || !name) {
      skippedInvalid += 1;
      errors.push(`Row ${rowNum}: sku and name are required`);
      continue;
    }

    const skuKey = sku.toUpperCase();
    if (existingSkus.has(skuKey)) {
      skippedDuplicate += 1;
      continue;
    }

    const input: ProductInput = {
      orgId: options.orgId,
      sku,
      name,
      category: get(row, "category") || undefined,
      description: get(row, "description") || undefined,
      stockStatus: parseStockStatus(get(row, "stock_status")),
      quantity: parseQuantity(get(row, "quantity")),
      priceLabel: get(row, "price_label") || undefined,
      mrpLabel: get(row, "mrp_label") || undefined,
      batterySpec: get(row, "battery_spec") || undefined,
      runtimeSpec: get(row, "runtime_spec") || undefined,
    };

    try {
      await createProduct(input);
      imported += 1;
      existingSkus.add(skuKey);
    } catch (err) {
      skippedInvalid += 1;
      errors.push(`Row ${rowNum}: ${err instanceof Error ? err.message : "import failed"}`);
    }
  }

  return { imported, skippedDuplicate, skippedInvalid, errors: errors.slice(0, 20) };
}
