import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, Toolbar, TablePagination, StatCard, ChannelIcon, ScoreBar, EmptyState } from "@/components/shared/ui-kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — EnerTech Engage" },
      { name: "description", content: "Company profile, branding, AI models, channels, roles, security and audit logs." },
      { property: "og:title", content: "Settings — EnerTech Engage" },
      { property: "og:description", content: "Company profile, branding, AI models, channels, roles, security and audit logs." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Settings" description="Company profile, branding, AI models, channels, roles, security and audit logs." actions={<Button size="sm">Save changes</Button>} />
      <div className="space-y-4 p-6">
        <Tabs defaultValue="company">
          <TabsList className="flex-wrap">
            {["company", "branding", "ai", "channels", "roles", "security", "audit"].map((t) => (
              <TabsTrigger key={t} value={t} className="capitalize">{t === "ai" ? "AI models" : t}</TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="company" className="mt-4">
            <Panel title="Company Profile">
              <div className="grid gap-4 sm:grid-cols-2">
                {[["Legal name", "EnerTech UPS Pvt. Ltd."], ["GSTIN", "29AABCE1234F1Z5"], ["Support email", "support@enertechups.com"], ["Support phone", "+91 80 4718 9000"]].map(([l, v]) => (
                  <div key={l} className="space-y-1.5"><Label>{l}</Label><Input defaultValue={v} /></div>
                ))}
              </div>
            </Panel>
          </TabsContent>
          <TabsContent value="branding" className="mt-4"><Panel title="Branding"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label>Widget accent</Label><Input defaultValue="#12A87A" /></div><div className="space-y-1.5"><Label>Widget greeting</Label><Input defaultValue="Hi 👋 I'm EnerBot" /></div></div></Panel></TabsContent>
          <TabsContent value="ai" className="mt-4">
            <Panel title="AI Models" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {[["Primary chat model", "gpt-5.6-sol"], ["Fallback model", "gemini-3.6-flash"], ["Embeddings", "text-embedding-3-small"], ["Temperature", "0.3"], ["Max output tokens", "1,024"]].map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span>{k}</span><span className="num text-muted-foreground">{v}</span></li>
                ))}
              </ul>
            </Panel>
          </TabsContent>
          <TabsContent value="channels" className="mt-4"><Panel title="Channel Credentials"><p className="text-sm text-muted-foreground">WhatsApp Business API, SMTP and Meta app credentials are managed here. Keys are encrypted at rest.</p></Panel></TabsContent>
          <TabsContent value="roles" className="mt-4">
            <Panel title="Roles & Permissions" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {[["Owner", "Full access"], ["Manager", "All modules, no billing"], ["Support Executive", "Inbox, handoff, knowledge read"], ["Sales Executive", "Leads, pipeline, products"], ["Service Engineer", "Tickets, manuals"]].map(([r, p]) => (
                  <li key={r} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="font-medium">{r}</span><span className="text-muted-foreground">{p}</span></li>
                ))}
              </ul>
            </Panel>
          </TabsContent>
          <TabsContent value="security" className="mt-4">
            <Panel title="Security">
              <div className="space-y-3">
                {[["Enforce SSO", true], ["Require MFA", true], ["IP allowlist", false], ["Session timeout (30 min)", true]].map(([l, on]) => (
                  <div key={String(l)} className="flex items-center justify-between gap-3 text-sm"><span>{l}</span><Switch defaultChecked={Boolean(on)} aria-label={String(l)} /></div>
                ))}
              </div>
            </Panel>
          </TabsContent>
          <TabsContent value="audit" className="mt-4">
            <Panel title="Audit Logs" bodyClassName="p-0">
              <ul className="divide-y divide-border text-sm">
                {[["Ananya Rao", "updated AI model settings", "2h ago"], ["Vikram S.", "exported leads (218 rows)", "6h ago"], ["System", "rotated WhatsApp token", "1d ago"]].map((a) => (
                  <li key={a[1]} className="flex items-center justify-between gap-3 px-4 py-3"><span><span className="font-medium">{a[0]}</span> <span className="text-muted-foreground">{a[1]}</span></span><span className="num text-xs text-muted-foreground">{a[2]}</span></li>
                ))}
              </ul>
            </Panel>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
