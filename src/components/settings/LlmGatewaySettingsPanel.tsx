import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, Panel, Pill } from "@/components/shared/ui-kit";
import { featureNotSetUp } from "@/lib/feature-setup";
import { AGENT_MODEL_OPTIONS } from "@/lib/agent-prompts";
import {
  getLlmGatewaySettings,
  saveLlmGatewaySettings,
  type LlmGatewaySettings,
  type LlmProviderId,
} from "@/server/llm-gateway-settings";

const NONE = "__none__";
const QUERY_KEY = ["llm-gateway-settings"] as const;

const PROVIDER_OPTIONS: Array<{
  id: LlmProviderId;
  label: string;
  live: boolean;
}> = [
  { id: "openai", label: "OpenAI", live: true },
  { id: "anthropic", label: "Claude (Anthropic)", live: false },
  { id: "google", label: "Gemini (Google)", live: false },
];

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return "Not saved yet";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function LlmGatewaySettingsPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getLlmGatewaySettings(),
  });

  const [provider, setProvider] = useState<LlmProviderId>("openai");
  const [defaultChatModel, setDefaultChatModel] = useState("gpt-4o-mini");
  const [fallbackModel, setFallbackModel] = useState(NONE);
  const [summaryModel, setSummaryModel] = useState("gpt-4o-mini");
  const [embeddingModel, setEmbeddingModel] = useState("text-embedding-3-small");

  useEffect(() => {
    const row = query.data;
    if (!row) return;
    setProvider(row.provider);
    setDefaultChatModel(row.defaultChatModel);
    setFallbackModel(row.fallbackModel || NONE);
    setSummaryModel(row.summaryModel);
    setEmbeddingModel(row.embeddingModel);
  }, [query.data]);

  useEffect(() => {
    if (fallbackModel !== NONE && fallbackModel === defaultChatModel) {
      setFallbackModel(NONE);
    }
  }, [defaultChatModel, fallbackModel]);

  const saveMutation = useMutation({
    mutationFn: (payload: Omit<LlmGatewaySettings, "updatedAt" | "missingTable" | "openaiConfigured">) =>
      saveLlmGatewaySettings({
        data: {
          provider: payload.provider,
          defaultChatModel: payload.defaultChatModel,
          fallbackModel: payload.fallbackModel,
          summaryModel: payload.summaryModel,
          embeddingModel: payload.embeddingModel,
        },
      }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(QUERY_KEY, saved);
      toast.success("AI Gateway saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save"),
  });

  if (query.isLoading) {
    return (
      <Panel title="AI Gateway">
        <p className="text-sm text-muted-foreground">Loading gateway settings…</p>
      </Panel>
    );
  }

  if (query.isError) {
    return (
      <Panel title="AI Gateway">
        <EmptyState
          title="Could not load AI Gateway"
          description={query.error instanceof Error ? query.error.message : "Try again."}
          action={
            <Button size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      </Panel>
    );
  }

  if (query.data?.missingTable) {
    return (
      <Panel title="AI Gateway">
        <EmptyState
          title="AI Gateway not available yet"
          description={featureNotSetUp("The AI Gateway", "038_llm_gateway.sql")}
          action={
            <Button size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="AI Gateway"
      action={
        <div className="flex flex-wrap gap-2">
          <Pill tone={query.data?.openaiConfigured ? "success" : "warning"} dot>
            {query.data?.openaiConfigured ? "OpenAI key set" : "OPENAI_API_KEY missing"}
          </Pill>
        </div>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Org-wide OpenAI defaults. A specific model on{" "}
        <Link to="/agents" className="underline underline-offset-2">
          AI Agents
        </Link>{" "}
        still wins for that bot’s replies. Set an agent to Org default to follow this page.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Provider</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as LlmProviderId)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_OPTIONS.map((opt) => (
                <SelectItem key={opt.id} value={opt.id} disabled={!opt.live}>
                  {opt.live ? opt.label : `${opt.label} — coming soon`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Only OpenAI is wired. Claude and Gemini stay listed for later.</p>
        </div>

        <div className="space-y-1.5">
          <Label>Default chat model</Label>
          <Select value={defaultChatModel} onValueChange={setDefaultChatModel}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGENT_MODEL_OPTIONS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Used when an agent is set to Org default, and as the inspector fallback.{" "}
            <Link to="/agents" className="underline underline-offset-2">
              Open AI Agents
            </Link>
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Fallback model</Label>
          <Select value={fallbackModel} onValueChange={setFallbackModel}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None (retry same model only)</SelectItem>
              {AGENT_MODEL_OPTIONS.map((m) => (
                <SelectItem key={m} value={m} disabled={m === defaultChatModel}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            If the primary OpenAI call still fails after retries (timeout, 429, 5xx), try this model once.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Summary model</Label>
          <Select value={summaryModel} onValueChange={setSummaryModel}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGENT_MODEL_OPTIONS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Inbox / Leads conversation summaries. Independent of chat agents.</p>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label>Embedding model</Label>
          <Select value={embeddingModel} onValueChange={setEmbeddingModel} disabled>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text-embedding-3-small">text-embedding-3-small</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Knowledge Base is locked to 1536-d vectors. text-embedding-3-large would not match existing chunks.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Last saved: {formatUpdatedAt(query.data?.updatedAt ?? null)}</p>
        <Button
          size="sm"
          disabled={saveMutation.isPending}
          onClick={() =>
            saveMutation.mutate({
              provider,
              defaultChatModel,
              fallbackModel: fallbackModel === NONE ? "" : fallbackModel,
              summaryModel,
              embeddingModel,
            })
          }
        >
          {saveMutation.isPending ? "Saving…" : "Save gateway"}
        </Button>
      </div>
    </Panel>
  );
}
