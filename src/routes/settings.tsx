import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, Panel, Pill } from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import {
  updateMyEmail,
  updateMyOrganization,
  updateMyPassword,
  updateMyProfile,
} from "@/lib/profile-api";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — EnerTech Engage" },
      {
        name: "description",
        content: "Your profile, company details, password, and workspace links.",
      },
      { property: "og:title", content: "Settings — EnerTech Engage" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: Page,
});

function Page() {
  const { profile, refreshProfile, loading } = useAuth();
  const search = Route.useSearch();
  const defaultTab =
    search.tab === "company" || search.tab === "security" || search.tab === "channels"
      ? search.tab
      : "profile";

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [email, setEmail] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgShort, setOrgShort] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.fullName || "");
    setPhone(profile.phone || "");
    setJobTitle(profile.jobTitle || "");
    setEmail(profile.email || "");
    setOrgName(profile.org.name || "");
    setOrgShort(profile.org.short || "");
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
    mutationFn: () => updateMyOrganization({ name: orgName, shortName: orgShort }),
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Company profile saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save company"),
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

  const isAdmin = profile?.role === "Admin";

  return (
    <>
      <PageHeader
        title="Settings"
        description="Update your profile, company details, and security. Channel credentials live under Channels."
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
            <p className="text-sm text-muted-foreground">Sign in to manage your profile.</p>
          </Panel>
        ) : (
          <Tabs defaultValue={defaultTab}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="company">Company</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="channels">Channels</TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="mt-4 space-y-4">
              <Panel title="Your profile">
                <div className="mb-4 flex items-center gap-3">
                  <div className="grid size-14 place-items-center rounded-full bg-primary/15 text-lg font-semibold text-primary">
                    {profile.initials}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{profile.fullName}</p>
                    <p className="text-xs text-muted-foreground">
                      {profile.role} · {profile.org.short}
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

            <TabsContent value="company" className="mt-4">
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
          </Tabs>
        )}
      </div>
    </>
  );
}
