import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, Panel, Pill } from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import { ENERTECH_NAVY_HEX } from "@/lib/brand";
import {
  removeMyAvatar,
  removeOrgLogo,
  updateMyEmail,
  updateMyOrganization,
  updateMyPassword,
  updateMyProfile,
  uploadMyAvatar,
  uploadOrgLogo,
} from "@/lib/profile-api";
import { TeamSettingsPanel } from "@/components/settings/TeamSettingsPanel";
import { AuditLogPanel } from "@/components/settings/AuditLogPanel";
import { AccountDangerZonePanel } from "@/components/settings/AccountDangerZonePanel";
import { OrgDangerZonePanel } from "@/components/settings/OrgDangerZonePanel";
import { BillingSettingsPanel } from "@/components/settings/BillingSettingsPanel";
import { LlmGatewaySettingsPanel } from "@/components/settings/LlmGatewaySettingsPanel";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings" },
      {
        name: "description",
        content: "Your profile, company details, password, team, and AI Gateway.",
      },
      { property: "og:title", content: "Settings" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: Page,
});

function Page() {
  const { profile, refreshProfile, loading, session } = useAuth();
  const search = Route.useSearch();
  const isAdmin = profile?.role === "Admin";
  const requestedTab =
    search.tab === "ai" || search.tab === "ai-gateway" ? "gateway" : search.tab;
  const defaultTab =
    requestedTab === "company" ||
    requestedTab === "security" ||
    requestedTab === "channels" ||
    (isAdmin && requestedTab === "team") ||
    (isAdmin && requestedTab === "billing") ||
    (isAdmin && requestedTab === "gateway")
      ? requestedTab
      : "profile";

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [email, setEmail] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgShort, setOrgShort] = useState("");
  const [brandPrimary, setBrandPrimary] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.fullName || "");
    setPhone(profile.phone || "");
    setJobTitle(profile.jobTitle || "");
    setEmail(profile.email || "");
    setOrgName(profile.org.name || "");
    setOrgShort(profile.org.short || "");
    setBrandPrimary(profile.org.brandPrimary || "");
  }, [profile]);

  const profileMutation = useMutation({
    mutationFn: () =>
      updateMyProfile({
        fullName,
        phone,
        jobTitle,
      }),
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Profile saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save profile"),
  });

  const emailMutation = useMutation({
    mutationFn: () => updateMyEmail(email),
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Email updated", {
        description: "If confirmation is required, check your inbox for the new address.",
      });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update email"),
  });

  const orgMutation = useMutation({
    mutationFn: () =>
      updateMyOrganization({
        name: orgName,
        shortName: orgShort,
        brandPrimary: brandPrimary.trim() || null,
      }),
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Company profile saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save company"),
  });

  const logoMutation = useMutation({
    mutationFn: (file: File) => uploadOrgLogo(file),
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Logo uploaded");
      if (logoInputRef.current) logoInputRef.current.value = "";
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Logo upload failed"),
  });

  const removeLogoMutation = useMutation({
    mutationFn: () => removeOrgLogo(),
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Logo removed");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not remove logo"),
  });

  const avatarMutation = useMutation({
    mutationFn: (file: File) => uploadMyAvatar(file),
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Profile photo updated");
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Photo upload failed"),
  });

  const removeAvatarMutation = useMutation({
    mutationFn: () => removeMyAvatar(),
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Profile photo removed");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not remove photo"),
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirmPassword) throw new Error("Passwords do not match");
      return updateMyPassword(newPassword);
    },
    onSuccess: () => {
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update password"),
  });

  return (
    <>
      <PageHeader
        title="Settings"
        meta={
          profile ? (
            <div className="flex flex-wrap gap-2">
              <Pill tone="success" dot>
                {profile.fullName}
              </Pill>
              <Pill tone="neutral">{profile.role}</Pill>
            </div>
          ) : null
        }
      />

      <div className="space-y-4 p-6">
        {loading && !profile ? (
          <Panel>
            <p className="text-sm text-muted-foreground">Loading profile…</p>
          </Panel>
        ) : !profile ? (
          <Panel>
            <p className="mb-3 text-sm text-muted-foreground">
              {session
                ? "Could not load your profile. Try refreshing, or run pending Supabase migrations if branding columns were added."
                : "Sign in to manage your profile."}
            </p>
            {session ? (
              <Button size="sm" onClick={() => void refreshProfile()}>
                Retry
              </Button>
            ) : null}
          </Panel>
        ) : (
          <Tabs defaultValue={defaultTab}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="company">Company</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="channels">Channels</TabsTrigger>
              {isAdmin ? <TabsTrigger value="team">Team</TabsTrigger> : null}
              {isAdmin ? <TabsTrigger value="billing">Billing</TabsTrigger> : null}
              {isAdmin ? <TabsTrigger value="gateway">AI Gateway</TabsTrigger> : null}
            </TabsList>

            <TabsContent value="profile" className="mt-4 space-y-4">
              <Panel title="Your profile">
                <div className="mb-4 flex flex-wrap items-center gap-4">
                  <div className="relative">
                    {profile.avatarUrl ? (
                      <img
                        src={profile.avatarUrl}
                        alt=""
                        className="size-14 rounded-full object-cover ring-2 ring-border"
                      />
                    ) : (
                      <div className="grid size-14 place-items-center rounded-full bg-primary/15 text-lg font-semibold text-primary">
                        {profile.initials}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{profile.fullName}</p>
                    <p className="text-xs text-muted-foreground">
                      {profile.role} · {profile.org.short}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) avatarMutation.mutate(file);
                        }}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={avatarMutation.isPending}
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        {avatarMutation.isPending ? "Uploading…" : "Upload photo"}
                      </Button>
                      {profile.avatarUrl ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={removeAvatarMutation.isPending}
                          onClick={() => removeAvatarMutation.mutate()}
                        >
                          {removeAvatarMutation.isPending ? "Removing…" : "Remove"}
                        </Button>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      PNG, JPG, or WebP — max 2 MB. Shown in the top bar.
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="full-name">Full name</Label>
                    <Input
                      id="full-name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Your name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="job-title">Job title</Label>
                    <Input
                      id="job-title"
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      placeholder="e.g. Support Manager"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 …"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Input value={profile.role} disabled />
                    <p className="text-xs text-muted-foreground">Role is managed by an Admin.</p>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button
                    size="sm"
                    disabled={profileMutation.isPending || !fullName.trim()}
                    onClick={() => profileMutation.mutate()}
                  >
                    {profileMutation.isPending ? "Saving…" : "Save profile"}
                  </Button>
                </div>
              </Panel>

              <Panel title="Login email">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="mt-4 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={emailMutation.isPending || email.trim() === profile.email}
                    onClick={() => emailMutation.mutate()}
                  >
                    {emailMutation.isPending ? "Updating…" : "Update email"}
                  </Button>
                </div>
              </Panel>
            </TabsContent>

            <TabsContent value="company" className="mt-4 space-y-4">
              <Panel title="Company profile">
                {!isAdmin ? (
                  <p className="mb-4 text-sm text-muted-foreground">
                    Only Admins can edit company details. You can view the current values below.
                  </p>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="org-name">Legal / company name</Label>
                    <Input
                      id="org-name"
                      value={orgName}
                      disabled={!isAdmin}
                      onChange={(e) => setOrgName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="org-short">Short name</Label>
                    <Input
                      id="org-short"
                      value={orgShort}
                      disabled={!isAdmin}
                      onChange={(e) => setOrgShort(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Plan</Label>
                    <Input value={profile.org.plan} disabled />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="brand-primary">Brand accent (optional)</Label>
                    <div className="flex gap-2">
                      <Input
                        id="brand-primary"
                        value={brandPrimary}
                        disabled={!isAdmin}
                        onChange={(e) => setBrandPrimary(e.target.value)}
                        placeholder={ENERTECH_NAVY_HEX}
                      />
                      <input
                        type="color"
                        aria-label="Pick brand color"
                        className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent p-1 disabled:opacity-50"
                        disabled={!isAdmin}
                        value={/^#[0-9A-Fa-f]{6}$/.test(brandPrimary) ? brandPrimary : ENERTECH_NAVY_HEX}
                        onChange={(e) => setBrandPrimary(e.target.value.toUpperCase())}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Optional. When set, this is the only primary accent (EnerTech navy is the default).
                    </p>
                  </div>
                </div>
                {isAdmin ? (
                  <div className="mt-4 flex justify-end">
                    <Button
                      size="sm"
                      disabled={orgMutation.isPending || !orgName.trim() || !orgShort.trim()}
                      onClick={() => orgMutation.mutate()}
                    >
                      {orgMutation.isPending ? "Saving…" : "Save company"}
                    </Button>
                  </div>
                ) : null}
              </Panel>

              <Panel title="Company logo">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="grid size-16 place-items-center overflow-hidden rounded-lg border border-border bg-secondary/40">
                    {profile.org.logoUrl ? (
                      <img
                        src={profile.org.logoUrl}
                        alt={`${profile.org.short} logo`}
                        className="size-full object-contain p-1"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">No logo</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Shown in the sidebar. PNG, JPG, WebP, or SVG — max 2 MB.
                    </p>
                    {isAdmin ? (
                      <div className="flex flex-wrap gap-2">
                        <input
                          ref={logoInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) logoMutation.mutate(file);
                          }}
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={logoMutation.isPending}
                          onClick={() => logoInputRef.current?.click()}
                        >
                          {logoMutation.isPending ? "Uploading…" : "Upload logo"}
                        </Button>
                        {profile.org.logoUrl ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={removeLogoMutation.isPending}
                            onClick={() => removeLogoMutation.mutate()}
                          >
                            {removeLogoMutation.isPending ? "Removing…" : "Remove"}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </Panel>
            </TabsContent>

            <TabsContent value="security" className="mt-4">
              <Panel title="Change password">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-pass">New password</Label>
                    <Input
                      id="new-pass"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="At least 8 characters"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="confirm-pass">Confirm password</Label>
                    <Input
                      id="confirm-pass"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button
                    size="sm"
                    disabled={passwordMutation.isPending || newPassword.length < 8}
                    onClick={() => passwordMutation.mutate()}
                  >
                    {passwordMutation.isPending ? "Updating…" : "Update password"}
                  </Button>
                </div>
              </Panel>
              <div className="mt-4">
                <AccountDangerZonePanel />
              </div>
            </TabsContent>

            <TabsContent value="channels" className="mt-4">
              <Panel title="Channel credentials">
                <p className="mb-3 text-sm text-muted-foreground">
                  WhatsApp, Email, Facebook, and Instagram credentials are configured on the Channels page
                  (not duplicated here).
                </p>
                <Button size="sm" asChild>
                  <Link to="/channels">Open Channels</Link>
                </Button>
              </Panel>
            </TabsContent>

            {isAdmin ? (
              <TabsContent value="billing" className="mt-4 space-y-4">
                <BillingSettingsPanel />
              </TabsContent>
            ) : null}

            {isAdmin ? (
              <TabsContent value="team" className="mt-4 space-y-4">
                <TeamSettingsPanel />
                <AuditLogPanel />
                <OrgDangerZonePanel />
              </TabsContent>
            ) : null}

            {isAdmin ? (
              <TabsContent value="gateway" className="mt-4 space-y-4">
                <LlmGatewaySettingsPanel />
              </TabsContent>
            ) : null}
          </Tabs>
        )}
      </div>
    </>
  );
}
