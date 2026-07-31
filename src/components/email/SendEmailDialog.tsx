import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type EmailBodyFormat = "text" | "html";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTo?: string;
  defaultSubject?: string;
  defaultBody?: string;
  defaultFormat?: EmailBodyFormat;
  fromLabel?: string | null;
  sending?: boolean;
  onSend: (payload: {
    to: string;
    subject: string;
    body: string;
    format: EmailBodyFormat;
  }) => Promise<void> | void;
};

export function SendEmailDialog({
  open,
  onOpenChange,
  defaultTo = "",
  defaultSubject = "",
  defaultBody = "",
  defaultFormat = "text",
  fromLabel,
  sending,
  onSend,
}: Props) {
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [format, setFormat] = useState<EmailBodyFormat>(defaultFormat);

  useEffect(() => {
    if (!open) return;
    setTo(defaultTo);
    setSubject(defaultSubject);
    setBody(defaultBody);
    setFormat(defaultFormat);
  }, [open, defaultTo, defaultSubject, defaultBody, defaultFormat]);

  const canSend = Boolean(to.trim() && subject.trim() && body.trim() && !sending);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mail className="size-4 text-muted-foreground" />
            Send Gmail
          </DialogTitle>
          <DialogDescription>
            Compose and send from your connected Gmail account
            {fromLabel ? (
              <>
                {" "}
                (<span className="font-medium text-foreground">{fromLabel}</span>)
              </>
            ) : null}
            . Choose Text or HTML like the n8n Gmail node.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="gmail-to">To</Label>
            <Input
              id="gmail-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="customer@example.com"
              disabled={sending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gmail-subject">Subject</Label>
            <Input
              id="gmail-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              disabled={sending}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Body format</Label>
            <div className="flex gap-1 rounded-lg border border-border bg-secondary/40 p-1">
              {(["text", "html"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  disabled={sending}
                  onClick={() => setFormat(f)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-sm capitalize transition-colors",
                    format === f
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f === "html" ? "HTML" : "Text"}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gmail-body">{format === "html" ? "HTML body" : "Text body"}</Label>
            <Textarea
              id="gmail-body"
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                format === "html"
                  ? "<p>Hello {{name}},</p><p>…</p>"
                  : "Hello,\n\n…"
              }
              disabled={sending}
              className="font-mono text-xs"
            />
          </div>
          {format === "html" && body.trim() ? (
            <div className="space-y-1.5">
              <Label>Preview</Label>
              <div
                className="max-h-40 overflow-auto rounded-lg border border-border bg-background p-3 text-sm"
                dangerouslySetInnerHTML={{ __html: body }}
              />
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-4 py-3">
          <Button variant="outline" disabled={sending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSend}
            onClick={() =>
              void onSend({
                to: to.trim(),
                subject: subject.trim(),
                body,
                format,
              })
            }
          >
            {sending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Sending…
              </>
            ) : (
              "Send email"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
