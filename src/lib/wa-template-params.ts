/** Analyze WhatsApp message-template components for send-time parameters. */

export type WaHeaderFormat = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION" | null;

export type WaTemplateComponentLike = {
  type?: string;
  format?: string;
  text?: string;
  example?: Record<string, unknown>;
  buttons?: Array<Record<string, unknown>>;
};

export type WaTemplateSendSpec = {
  headerFormat: WaHeaderFormat;
  /** IMAGE / VIDEO / DOCUMENT need a public media URL at send time */
  headerNeedsMedia: boolean;
  headerTextVarLabels: string[];
  bodyParamFormat: "positional" | "named";
  bodyVarLabels: string[];
  bodyVarCount: number;
};

const MEDIA_HEADERS = new Set(["IMAGE", "VIDEO", "DOCUMENT"]);

function asComponents(raw: unknown): WaTemplateComponentLike[] {
  if (!Array.isArray(raw)) return [];
  return raw as WaTemplateComponentLike[];
}

/** Extract {{1}} / {{name}} style placeholders in order of first appearance. */
export function extractPlaceholders(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || ""))) {
    const key = m[1];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Count body variables — supports positional {{1}} and named {{first_name}}. */
export function countTemplateVars(body: string): number {
  return extractPlaceholders(body).length;
}

export function analyzeWaTemplate(options: {
  components?: unknown;
  bodyText?: string | null;
  headerText?: string | null;
}): WaTemplateSendSpec {
  const components = asComponents(options.components);
  const header = components.find((c) => String(c.type || "").toUpperCase() === "HEADER");
  const body = components.find((c) => String(c.type || "").toUpperCase() === "BODY");

  const headerFormatRaw = String(header?.format || "")
    .toUpperCase()
    .trim();
  let headerFormat: WaHeaderFormat = null;
  if (header) {
    if (
      headerFormatRaw === "TEXT" ||
      headerFormatRaw === "IMAGE" ||
      headerFormatRaw === "VIDEO" ||
      headerFormatRaw === "DOCUMENT" ||
      headerFormatRaw === "LOCATION"
    ) {
      headerFormat = headerFormatRaw;
    } else if (header.text) {
      headerFormat = "TEXT";
    }
  }

  const bodyText = options.bodyText || body?.text || "";
  const headerText = options.headerText || header?.text || "";
  const bodyPlaceholders = extractPlaceholders(bodyText);
  const headerTextVarLabels = extractPlaceholders(headerText);

  const namedBody = bodyPlaceholders.some((p) => !/^\d+$/.test(p));
  const bodyParamFormat: "positional" | "named" = namedBody ? "named" : "positional";

  // Positional: Meta wants params ordered 1..N even if some numbers skipped — use max index.
  let bodyVarLabels = bodyPlaceholders;
  if (!namedBody && bodyPlaceholders.length > 0) {
    const max = Math.max(...bodyPlaceholders.map((p) => Number(p)).filter(Boolean));
    bodyVarLabels = Array.from({ length: max }, (_, i) => String(i + 1));
  }

  return {
    headerFormat,
    headerNeedsMedia: Boolean(headerFormat && MEDIA_HEADERS.has(headerFormat)),
    headerTextVarLabels,
    bodyParamFormat,
    bodyVarLabels,
    bodyVarCount: bodyVarLabels.length,
  };
}

export function analyzeWaTemplateFromRow(tpl: {
  components?: unknown;
  body_text?: string | null;
  header_text?: string | null;
}): WaTemplateSendSpec {
  return analyzeWaTemplate({
    components: tpl.components,
    bodyText: tpl.body_text,
    headerText: tpl.header_text,
  });
}

export function isPublicHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
