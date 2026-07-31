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
import { countTemplateVars, type DbWaTemplate } from "@/lib/broadcasting-api";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: DbWaTemplate[];
  loading?: boolean;
  contactName?: string | null;
  contactPhone?: string | null;
  sending?: boolean;
  onSend: (template: DbWaTemplate, bodyParams: string[]) => Promise<void> | void;
  onManageTemplates?: () => void;
};

function previewBody(tpl: DbWaTemplate, vars: string[]): string {
  let text = tpl.body_text || "";
  vars.forEach((val, i) => {
    text = text.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, "g"), val || `{{${i + 1}}}`);
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

  const varCount = selected ? countTemplateVars(selected.body_text) : 0;

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelected(null);
      setVars([]);
    }
  }, [open]);

  useEffect(() => {
    if (!selected) {
      setVars([]);
      return;
    }
    const n = countTemplateVars(selected.body_text);
    setVars(Array.from({ length: n }, (_, i) => (i === 0 && contactName ? contactName : "")));
  }, [selected?.id, contactName]);

  async function handleSend() {
    if (!selected) return;
    if (varCount > 0 && vars.slice(0, varCount).some((v) => !v.trim())) return;
    await onSend(selected, vars.slice(0, varCount));
  }

  const canSend =
    Boolean(selected) &&
    !sending &&
    !(varCount > 0 && vars.slice(0, varCount).some((v) => !v.trim()));

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
                  {filtered.map((t) => (
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
                  ))}
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
                {previewBody(selected, vars)}
              </div>
              {varCount > 0 ? (
                <div className="space-y-3">
                  <Label className="text-xs text-muted-foreground">
                    Fill template variables
                  </Label>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {Array.from({ length: varCount }, (_, i) => (
                      <div key={i} className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">{`{{${i + 1}}}`}</Label>
                        <Input
                          className="h-9"
                          value={vars[i] || ""}
                          onChange={(e) => {
                            const next = [...vars];
                            next[i] = e.target.value;
                            setVars(next);
                          }}
                          placeholder={`Value for {{${i + 1}}}`}
                          disabled={sending}
                          autoFocus={i === 0}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  This template has no variables — ready to send.
                </p>
              )}
            </div>
            <DialogFooter
              className={cn(
                "shrink-0 gap-2 border-t border-border px-4 py-3 sm:justify-between",
              )}
            >
              <Button
                variant="ghost"
                disabled={sending}
                onClick={() => setSelected(null)}
              >
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
