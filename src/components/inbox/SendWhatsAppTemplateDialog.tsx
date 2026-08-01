import { useEffect, useMemo, useState } from "react";
import { ChevronRight, LayoutGrid, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/shared/ui-kit";
import {
  analyzeWaTemplateFromRow,
  isPublicHttpUrl,
  type DbWaTemplate,
} from "@/lib/broadcasting-api";
import { cn } from "@/lib/utils";

export type SendTemplatePayload = {
  template: DbWaTemplate;
  bodyParams: string[];
  headerMediaUrl?: string;
  headerTextParams?: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: DbWaTemplate[];
  loading?: boolean;
  contactName?: string | null;
  contactPhone?: string | null;
  sending?: boolean;
  onSend: (payload: SendTemplatePayload) => Promise<void> | void;
  onManageTemplates?: () => void;
};

function previewBody(tpl: DbWaTemplate, vars: string[], labels: string[]): string {
  let text = tpl.body_text || "";
  labels.forEach((label, i) => {
    const val = vars[i] || `{{${label}}}`;
    text = text.replace(new RegExp(`\\{\\{\\s*${label}\\s*\\}\\}`, "gi"), val);
  });
  return text || "No body preview";
}

export function SendWhatsAppTemplateDialog({
  open,
  onOpenChange,
  templates,
  loading,
  contactName,
  contactPhone,
  sending,
  onSend,
  onManageTemplates,
}: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DbWaTemplate | null>(null);
  const [vars, setVars] = useState<string[]>([]);
  const [headerMediaUrl, setHeaderMediaUrl] = useState("");
  const [headerTextParams, setHeaderTextParams] = useState<string[]>([]);

  const approved = useMemo(
    () => templates.filter((t) => String(t.status).toUpperCase() === "APPROVED"),
    [templates],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return approved;
    return approved.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.body_text || "").toLowerCase().includes(q) ||
        (t.category || "").toLowerCase().includes(q) ||
        (t.language || "").toLowerCase().includes(q),
    );
  }, [approved, query]);

  const spec = selected ? analyzeWaTemplateFromRow(selected) : null;
  const varCount = spec?.bodyVarCount ?? 0;

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelected(null);
      setVars([]);
      setHeaderMediaUrl("");
      setHeaderTextParams([]);
    }
  }, [open]);

  useEffect(() => {
    if (!selected) {
      setVars([]);
      setHeaderMediaUrl("");
      setHeaderTextParams([]);
      return;
    }
    const s = analyzeWaTemplateFromRow(selected);
    setVars(
      Array.from({ length: s.bodyVarCount }, (_, i) =>
        i === 0 && contactName ? contactName : "",
      ),
    );
    setHeaderMediaUrl("");
    setHeaderTextParams(Array.from({ length: s.headerTextVarLabels.length }, () => ""));
  }, [selected?.id, contactName]);

  async function handleSend() {
    if (!selected || !spec) return;
    if (varCount > 0 && vars.slice(0, varCount).some((v) => !v.trim())) return;
    if (spec.headerNeedsMedia && !isPublicHttpUrl(headerMediaUrl)) return;
    await onSend({
      template: selected,
      bodyParams: vars.slice(0, varCount),
      headerMediaUrl: headerMediaUrl.trim() || undefined,
      headerTextParams: headerTextParams.length ? headerTextParams : undefined,
    });
  }

  const canSend =
    Boolean(selected) &&
    !sending &&
    !(varCount > 0 && vars.slice(0, varCount).some((v) => !v.trim())) &&
    !(spec?.headerNeedsMedia && !isPublicHttpUrl(headerMediaUrl));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(88vh,640px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <LayoutGrid className="size-4 text-muted-foreground" />
            Send template
          </DialogTitle>
          <DialogDescription>
            Pick an approved WhatsApp template to send
            {contactPhone ? (
              <>
                {" "}
                to <span className="font-medium text-foreground">+{contactPhone}</span>
              </>
            ) : (
              " to this contact"
            )}
            .
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <>
            <div className="shrink-0 border-b border-border px-4 py-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-9 pl-8"
                  placeholder="Search templates…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading templates…
                </div>
              ) : filtered.length === 0 ? (
                <div className="space-y-3 px-5 py-12 text-center">
                  <p className="text-sm font-medium text-foreground">No approved templates</p>
                  <p className="text-xs text-muted-foreground">
                    Sync or create templates in Broadcasting, then return here.
                  </p>
                  {onManageTemplates ? (
                    <Button size="sm" variant="outline" onClick={onManageTemplates}>
                      Manage templates
                    </Button>
                  ) : null}
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map((t) => {
                    const s = analyzeWaTemplateFromRow(t);
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-secondary/60"
                          onClick={() => setSelected(t)}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-sm font-semibold text-foreground">
                                {t.name}
                              </span>
                              <Pill tone="info" className="capitalize">
                                {(t.category || "utility").toLowerCase()}
                              </Pill>
                              {s.headerNeedsMedia ? (
                                <Pill tone="neutral">{s.headerFormat}</Pill>
                              ) : null}
                              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                {(t.language || "en").replace(/_/g, "_")}
                              </span>
                            </div>
                            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                              {t.body_text || "No body preview"}
                            </p>
                          </div>
                          <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <DialogFooter className="shrink-0 border-t border-border px-4 py-3 sm:justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold">{selected.name}</span>
                <Pill tone="info" className="capitalize">
                  {(selected.category || "utility").toLowerCase()}
                </Pill>
                <span className="text-[11px] uppercase text-muted-foreground">
                  {selected.language}
                </span>
              </div>
              <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-sm whitespace-pre-wrap">
                {previewBody(selected, vars, spec?.bodyVarLabels || [])}
              </div>
              {spec?.headerNeedsMedia ? (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Header {String(spec.headerFormat).toLowerCase()} URL (required)
                  </Label>
                  <Input
                    className="h-9"
                    value={headerMediaUrl}
                    onChange={(e) => setHeaderMediaUrl(e.target.value)}
                    placeholder="https://… public media URL"
                    disabled={sending}
                  />
                </div>
              ) : null}
              {spec && spec.headerTextVarLabels.length > 0 ? (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Header text variables</Label>
                  {spec.headerTextVarLabels.map((label, i) => (
                    <Input
                      key={label}
                      className="h-9"
                      value={headerTextParams[i] || ""}
                      onChange={(e) => {
                        const next = [...headerTextParams];
                        next[i] = e.target.value;
                        setHeaderTextParams(next);
                      }}
                      placeholder={`{{${label}}}`}
                      disabled={sending}
                    />
                  ))}
                </div>
              ) : null}
              {varCount > 0 && spec ? (
                <div className="space-y-3">
                  <Label className="text-xs text-muted-foreground">Fill template variables</Label>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {spec.bodyVarLabels.map((label, i) => (
                      <div key={label} className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">{`{{${label}}}`}</Label>
                        <Input
                          className="h-9"
                          value={vars[i] || ""}
                          onChange={(e) => {
                            const next = [...vars];
                            next[i] = e.target.value;
                            setVars(next);
                          }}
                          placeholder={`Value for {{${label}}}`}
                          disabled={sending}
                          autoFocus={i === 0 && !spec.headerNeedsMedia}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {spec?.headerNeedsMedia
                    ? "Add the header media URL, then send."
                    : "This template has no variables — ready to send."}
                </p>
              )}
            </div>
            <DialogFooter
              className={cn(
                "shrink-0 gap-2 border-t border-border px-4 py-3 sm:justify-between",
              )}
            >
              <Button variant="ghost" disabled={sending} onClick={() => setSelected(null)}>
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" disabled={sending} onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button disabled={!canSend} onClick={() => void handleSend()}>
                  {sending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    "Send template"
                  )}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
