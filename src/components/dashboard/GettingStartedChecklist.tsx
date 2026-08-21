import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/shared/ui-kit";
import { ONBOARDING_CHECKLIST } from "@/lib/public-site";

const STORAGE_KEY = "engage_getting_started_v1";

type Progress = {
  dismissed: boolean;
  done: Record<string, boolean>;
};

function loadProgress(orgId: string): Progress {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${orgId}`);
    if (!raw) return { dismissed: false, done: {} };
    const parsed = JSON.parse(raw) as Progress;
    return {
      dismissed: Boolean(parsed.dismissed),
      done: parsed.done && typeof parsed.done === "object" ? parsed.done : {},
    };
  } catch {
    return { dismissed: false, done: {} };
  }
}

function saveProgress(orgId: string, progress: Progress) {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${orgId}`, JSON.stringify(progress));
  } catch {
    /* ignore quota */
  }
}

export function GettingStartedChecklist({ orgId }: { orgId: string }) {
  const [progress, setProgress] = useState<Progress>({ dismissed: true, done: {} });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setProgress(loadProgress(orgId));
    setReady(true);
  }, [orgId]);

  if (!ready || progress.dismissed) return null;

  const completed = ONBOARDING_CHECKLIST.filter((s) => progress.done[s.id]).length;
  const total = ONBOARDING_CHECKLIST.length;

  function toggle(id: string) {
    setProgress((prev) => {
      const next = {
        ...prev,
        done: { ...prev.done, [id]: !prev.done[id] },
      };
      saveProgress(orgId, next);
      return next;
    });
  }

  function dismiss() {
    const next = { ...progress, dismissed: true };
    saveProgress(orgId, next);
    setProgress(next);
  }

  return (
    <Panel
      title="Getting started"
      description={`${completed} of ${total} steps — connect channels, invite the team, go live.`}
      action={
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={dismiss}>
          <X className="size-3.5" /> Dismiss
        </Button>
      }
    >
      <ul className="space-y-2">
        {ONBOARDING_CHECKLIST.map((step) => {
          const done = Boolean(progress.done[step.id]);
          return (
            <li
              key={step.id}
              className="flex items-start gap-3 rounded-lg border border-border/70 bg-background/60 px-3 py-2.5"
            >
              <button
                type="button"
                className="mt-0.5 shrink-0 text-primary"
                aria-label={done ? `Mark ${step.title} incomplete` : `Mark ${step.title} done`}
                onClick={() => toggle(step.id)}
              >
                {done ? <CheckCircle2 className="size-5" /> : <Circle className="size-5 text-muted-foreground" />}
              </button>
              <div className="min-w-0 flex-1">
                <Link
                  to={step.href}
                  className={`text-sm font-medium hover:underline ${done ? "text-muted-foreground line-through" : "text-foreground"}`}
                >
                  {step.title}
                </Link>
                <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
