/**
 * Shared-thread documents (PDF / catalogue / inbox attachment).
 * Used so AI knows we already sent a file — never claims it “cannot access files”.
 */
import { isAckOnlyMessage } from "@/lib/enertech-scope";
import type { SessionLang } from "@/lib/session-language";

export type ThreadHistoryRow = {
  sender: string;
  body: string;
  created_at?: string;
  metadata?: Record<string, unknown> | null;
};

export type SharedDocument = {
  fileName: string;
  url: string | null;
  mime: string | null;
  sender: string;
};

function asMeta(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

export function extractSharedDocument(row: ThreadHistoryRow): SharedDocument | null {
  const meta = asMeta(row.metadata);
  const body = String(row.body || "").trim();
  const fileFromMeta =
    (typeof meta?.file_name === "string" && meta.file_name.trim()) ||
    (typeof meta?.filename === "string" && meta.filename.trim()) ||
    "";
  const urlFromMeta =
    (typeof meta?.url === "string" && meta.url.trim()) ||
    (typeof meta?.public_url === "string" && meta.public_url.trim()) ||
    "";
  const mime =
    (typeof meta?.mime_type === "string" && meta.mime_type) ||
    (typeof meta?.mime === "string" && meta.mime) ||
    null;
  const flagged =
    meta?.attachment === true ||
    meta?.catalogue === true ||
    /pdf|document|msword|spreadsheet/i.test(mime || "");

  const sharedLabel = body.match(
    /(?:Shared a file|Catalogue PDF|Proforma|Invoice):\s*([^\n]+)/i,
  );
  const pdfInBody = body.match(/([^\s/]+\.pdf)\b/i);
  const fileName = fileFromMeta || sharedLabel?.[1]?.trim() || pdfInBody?.[1] || "";
  const urlInBody = body.match(/https:\/\/\S+/i)?.[0] || null;

  if (!flagged && !fileName && !urlFromMeta && !/Shared a file:|Catalogue PDF:/i.test(body)) {
    return null;
  }
  if (!fileName && !urlFromMeta && !urlInBody) return null;

  return {
    fileName: fileName || "document.pdf",
    url: urlFromMeta || urlInBody,
    mime,
    sender: row.sender,
  };
}

export function listSharedDocuments(history: ThreadHistoryRow[]): SharedDocument[] {
  const out: SharedDocument[] = [];
  for (const row of history) {
    const doc = extractSharedDocument(row);
    if (doc) out.push(doc);
  }
  return out;
}

/** Outbound (AI/agent) PDF in the last N messages. */
export function hasRecentOutboundDocument(history: ThreadHistoryRow[], lookback = 8): boolean {
  const slice = history.slice(-lookback);
  return slice.some((row) => {
    const sender = String(row.sender || "").toLowerCase();
    if (sender !== "ai" && sender !== "agent") return false;
    return Boolean(extractSharedDocument(row));
  });
}

export function lastOutboundDocument(history: ThreadHistoryRow[]): SharedDocument | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const row = history[i];
    const sender = String(row.sender || "").toLowerCase();
    if (sender !== "ai" && sender !== "agent") continue;
    const doc = extractSharedDocument(row);
    if (doc) return doc;
  }
  return null;
}

/** Customer pointing at the file we just shared, or soft ack after it. */
export function isSharedDocumentFollowUp(text: string): boolean {
  const q = String(text || "").trim();
  if (!q || q.length > 180) return false;
  if (isAckOnlyMessage(q)) return true;
  if (/^(ok|okay|oke)\s+sir[\s!.🙏]*$/i.test(q)) return true;
  if (/^(yes|haan|han|ji)\s+sir[\s!.🙏]*$/i.test(q)) return true;
  if (
    /\b(details?|mentioned|mention|in this|in the (pdf|file|document|proforma|invoice)|this (pdf|file|document|proforma|invoice)|that (pdf|file)|above|dekho|dekha|check (this|it|the (pdf|file|document)))\b/i.test(
      q,
    )
  ) {
    return true;
  }
  return false;
}

export function shouldShortAckSharedDocument(
  text: string,
  history: ThreadHistoryRow[],
): boolean {
  return hasRecentOutboundDocument(history) && isSharedDocumentFollowUp(text);
}

export function enrichHistoryBody(row: ThreadHistoryRow): string {
  const body = String(row.body || "").trim();
  const doc = extractSharedDocument(row);
  if (!doc) return body;
  const bits = [`[Document shared with customer] title="${doc.fileName}"`];
  if (doc.url) bits.push(`url=${doc.url}`);
  if (doc.mime) bits.push(`mime=${doc.mime}`);
  if (body && !body.includes(doc.fileName) && !/Document shared/i.test(body)) {
    return `${body}\n${bits.join(" ")}`;
  }
  if (/Document shared/i.test(body)) return body;
  return `${body || doc.fileName}\n${bits.join(" ")}`.trim();
}

export function lastDocumentsSystemBlock(history: ThreadHistoryRow[]): string | null {
  const docs = listSharedDocuments(history).slice(-4);
  if (!docs.length) return null;
  const lines = docs.map(
    (d) => `- ${d.fileName}${d.url ? ` (${d.url})` : ""} · sent by ${d.sender}`,
  );
  return [
    "Documents already shared in this thread (the customer can see them in WhatsApp/chat):",
    ...lines,
    "If the customer refers to “this”, “the PDF”, “details mentioned”, or “proforma”, they mean the latest document above.",
    "Acknowledge commercially. Never say you cannot access, view, open, or retrieve files.",
  ].join("\n");
}

export function documentAckReplyForLang(
  lang: SessionLang,
  fileName?: string | null,
): string {
  const shortName = String(fileName || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
  const named = Boolean(shortName);
  switch (lang) {
    case "hi":
      return named
        ? `Theek hai sir — ${shortName} check karke jaldi update karta hoon.`
        : "Theek hai sir — document check karke jaldi update karta hoon.";
    case "mr":
      return named
        ? `Theek aahe sir — ${shortName} check karun lavkar update karto.`
        : "Theek aahe sir — document check karun lavkar update karto.";
    case "mixed":
      return named
        ? `Theek hai sir — ${shortName} check karke jaldi update karta hoon.`
        : "Theek hai sir — file check karke jaldi update karta hoon.";
    default:
      return named
        ? `Okay sir, I will check the ${shortName} and get back to you shortly.`
        : "Okay sir, I will check the document and get back to you shortly.";
  }
}
