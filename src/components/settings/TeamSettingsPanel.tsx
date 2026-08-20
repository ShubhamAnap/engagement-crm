import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Mail, Pencil, Plus, UserX, UserCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, Panel, Pill } from "@/components/shared/ui-kit";
import {
  APP_SECTION_GROUPS,
  APP_SECTION_KEYS,
  DEFAULT_NEW_USER_PERMISSIONS,
  allPermissionKeys,
  permissionSummary,
  type PermissionKey,
} from "@/lib/permissions";
import {
  copyTeamMemberAccess,
  listTeamMembers,
  resetTeamMemberPassword,
  updateTeamMember,
  type TeamMemberRow,
} from "@/server/team";
import {
  inviteTeamMember,
  listOrgInvites,
  revokeOrgInvite,
  type PendingInvite,
} from "@/server/org-invites";

function PermissionChecklist({
  value,
  onChange,
  disabled,
}: {
  value: PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  disabled?: boolean;
}) {
  const selected = new Set(value);
  const leadsOpen = selected.has("leads");

  function commit(next: Set<PermissionKey>) {
    // Keep stable order: sections then actions
    const ordered = allPermissionKeys().filter((k) => next.has(k));
    onChange(ordered);
  }

  function toggleSection(key: (typeof APP_SECTION_KEYS)[number], checked: boolean) {
    const next = new Set(selected);
    if (checked) {
      next.add(key);
    } else {
      next.delete(key);
      if (key === "leads") {
        next.delete("leads_create");
        next.delete("leads_delete");
      }
    }
    commit(next);
  }

  function toggleAction(key: "leads_create" | "leads_delete", checked: boolean) {
    if (!leadsOpen) return;
    const next = new Set(selected);
    if (checked) next.add(key);
    else next.delete(key);
    commit(next);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onChange(allPermissionKeys())}
        >
          Select all
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onChange([])}
        >
          Clear
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onChange([...DEFAULT_NEW_USER_PERMISSIONS])}
        >
          Dashboard + Inbox
        </Button>
      </div>
      {APP_SECTION_GROUPS.map((group) => (
        <div key={group.label} className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {group.label}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.sections.map((section) => {
              const checked = selected.has(section.key);
              return (
                <div key={section.key} className="space-y-1.5">
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary/40">
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(v) => toggleSection(section.key, v === true)}
                    />
                    <span>{section.label}</span>
                  </label>
                  {section.key === "leads" ? (
                    <div className="ml-4 space-y-1 rounded-md border border-dashed border-border bg-secondary/20 px-3 py-2">
                      <p className="text-[11px] text-muted-foreground">
                        Button access (off until ticked)
                      </p>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox
                          checked={selected.has("leads_create")}
                          disabled={disabled || !leadsOpen}
                          onCheckedChange={(v) => toggleAction("leads_create", v === true)}
                        />
                        <span>Add / Edit / bulk assign &amp; status</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox
                          checked={selected.has("leads_delete")}
                          disabled={disabled || !leadsOpen}
                          onCheckedChange={(v) => toggleAction("leads_delete", v === true)}
                        />
                        <span>Delete lead</span>
                      </label>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TeamSettingsPanel() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editMember, setEditMember] = useState<TeamMemberRow | null>(null);
  const [passwordMember, setPasswordMember] = useState<TeamMemberRow | null>(null);
  const [copyMember, setCopyMember] = useState<TeamMemberRow | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [permissions, setPermissions] = useState<PermissionKey[]>([
    ...DEFAULT_NEW_USER_PERMISSIONS,
  ]);
  const [editName, setEditName] = useState("");
  const [editPermissions, setEditPermissions] = useState<PermissionKey[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [copyFromId, setCopyFromId] = useState("");

  const teamQuery = useQuery({
    queryKey: ["team-members"],
    queryFn: () => listTeamMembers(),
  });

  const invitesQuery = useQuery({
    queryKey: ["org-invites"],
    queryFn: () => listOrgInvites(),
  });

  const members = teamQuery.data ?? [];
  const invites = (invitesQuery.data ?? []).filter((i) => i.status === "pending") as PendingInvite[];

  const inviteMutation = useMutation({
    mutationFn: () =>
      inviteTeamMember({
        data: {
          fullName,
          email,
          permissions,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["org-invites"] });
      setCreateOpen(false);
      setFullName("");
      setEmail("");
      setPermissions([...DEFAULT_NEW_USER_PERMISSIONS]);
      toast.success("Invite sent by email");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Invite failed"),
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId: string) => revokeOrgInvite({ data: { inviteId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["org-invites"] });
      toast.success("Invite revoked");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not revoke invite"),
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editMember) throw new Error("No user selected");
      return updateTeamMember({
        data: {
          userId: editMember.id,
          fullName: editName,
          permissions: editMember.role === "Admin" ? undefined : editPermissions,
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["team-members"] });
      setEditMember(null);
      toast.success("User updated");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Update failed"),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (member: TeamMemberRow) =>
      updateTeamMember({
        data: { userId: member.id, isActive: !member.is_active },
      }),
    onSuccess: async (_data, member) => {
      await queryClient.invalidateQueries({ queryKey: ["team-members"] });
      toast.success(member.is_active ? "User disabled" : "User enabled");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update status"),
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (!passwordMember) throw new Error("No user selected");
      if (newPassword !== confirmPassword) throw new Error("Passwords do not match");
      return resetTeamMemberPassword({
        data: { userId: passwordMember.id, password: newPassword },
      });
    },
    onSuccess: () => {
      setPasswordMember(null);
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password reset");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Reset failed"),
  });

  const copyMutation = useMutation({
    mutationFn: async () => {
      if (!copyMember || !copyFromId) throw new Error("Pick a source user");
      return copyTeamMemberAccess({
        data: { targetUserId: copyMember.id, sourceUserId: copyFromId },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["team-members"] });
      setCopyMember(null);
      setCopyFromId("");
      toast.success("Access copied");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Copy failed"),
  });

  const copySources = useMemo(
    () => members.filter((m) => m.id !== copyMember?.id),
    [members, copyMember?.id],
  );

  function openCreate() {
    setFullName("");
    setEmail("");
    setPermissions([...DEFAULT_NEW_USER_PERMISSIONS]);
    setCreateOpen(true);
  }

  function openEdit(member: TeamMemberRow) {
    setEditMember(member);
    setEditName(member.full_name);
    setEditPermissions([...member.permissions]);
  }

  return (
    <>
      <Panel
        title="Team"
        description="Invite users by email and choose which sections they can open. New users default to Dashboard + Inbox."
        action={
          <Button size="sm" className="gap-1.5" onClick={openCreate}>
            <Plus className="size-3.5" /> Invite user
          </Button>
        }
      >
        {teamQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading team…</p>
        ) : members.length === 0 ? (
          <EmptyState title="No users" description="Create the first team member." />
        ) : (
          <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border bg-secondary/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Access</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((m) => (
                  <tr key={m.id} className="align-top">
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-foreground">{m.full_name}</p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Pill tone={m.role === "Admin" ? "success" : "neutral"}>{m.role}</Pill>
                        {m.is_self ? <Pill tone="info">You</Pill> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {m.role === "Admin" ? "Full access (Admin)" : permissionSummary(m.permissions)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill tone={m.is_active ? "success" : "danger"} dot>
                        {m.is_active ? "Active" : "Disabled"}
                      </Pill>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          title="Edit"
                          onClick={() => openEdit(m)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        {m.role !== "Admin" ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            title="Copy access from…"
                            onClick={() => {
                              setCopyMember(m);
                              setCopyFromId("");
                            }}
                          >
                            <Copy className="size-3.5" />
                          </Button>
                        ) : null}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          title="Reset password"
                          onClick={() => {
                            setPasswordMember(m);
                            setNewPassword("");
                            setConfirmPassword("");
                          }}
                        >
                          <KeyRound className="size-3.5" />
                        </Button>
                        {!m.is_self ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            title={m.is_active ? "Disable" : "Enable"}
                            disabled={toggleActiveMutation.isPending}
                            onClick={() => {
                              const action = m.is_active ? "disable" : "enable";
                              if (confirm(`${action[0].toUpperCase()}${action.slice(1)} ${m.full_name}?`)) {
                                toggleActiveMutation.mutate(m);
                              }
                            }}
                          >
                            {m.is_active ? (
                              <UserX className="size-3.5 text-destructive" />
                            ) : (
                              <UserCheck className="size-3.5" />
                            )}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {invites.length > 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-border bg-secondary/20 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                <Mail className="size-4" /> Pending invites
              </p>
              <ul className="space-y-2">
                {invites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">{invite.full_name || invite.email}</p>
                      <p className="text-xs text-muted-foreground">{invite.email}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={revokeInviteMutation.isPending}
                      onClick={() => revokeInviteMutation.mutate(invite.id)}
                    >
                      <X className="mr-1 size-3.5" /> Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          </>
        )}
      </Panel>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Invite user</DialogTitle>
            <DialogDescription>
              They will receive an email to set a password and join your workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="team-name">Full name</Label>
              <Input id="team-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-email">Email</Label>
              <Input
                id="team-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Section access</Label>
              <PermissionChecklist value={permissions} onChange={setPermissions} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !fullName.trim() ||
                !email.trim() ||
                inviteMutation.isPending
              }
              onClick={() => inviteMutation.mutate()}
            >
              {inviteMutation.isPending ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editMember)}
        onOpenChange={(open) => {
          if (!open) setEditMember(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>{editMember?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Full name</Label>
              <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            {editMember?.role === "Admin" ? (
              <p className="text-sm text-muted-foreground">
                Admin accounts always have full section access.
              </p>
            ) : (
              <div className="space-y-2">
                <Label>Section access</Label>
                <PermissionChecklist value={editPermissions} onChange={setEditPermissions} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMember(null)}>
              Cancel
            </Button>
            <Button
              disabled={!editName.trim() || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              {updateMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(passwordMember)}
        onOpenChange={(open) => {
          if (!open) setPasswordMember(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Set a new password for {passwordMember?.full_name} ({passwordMember?.email}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="reset-pass">New password</Label>
              <Input
                id="reset-pass"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-pass2">Confirm</Label>
              <Input
                id="reset-pass2"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordMember(null)}>
              Cancel
            </Button>
            <Button
              disabled={newPassword.length < 8 || passwordMutation.isPending}
              onClick={() => passwordMutation.mutate()}
            >
              {passwordMutation.isPending ? "Saving…" : "Reset password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(copyMember)}
        onOpenChange={(open) => {
          if (!open) setCopyMember(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy access</DialogTitle>
            <DialogDescription>
              Copy section ticks onto {copyMember?.full_name} from another user.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Copy from</Label>
            <Select value={copyFromId} onValueChange={setCopyFromId}>
              <SelectTrigger>
                <SelectValue placeholder="Select user…" />
              </SelectTrigger>
              <SelectContent>
                {copySources.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.full_name} ({m.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyMember(null)}>
              Cancel
            </Button>
            <Button
              disabled={!copyFromId || copyMutation.isPending}
              onClick={() => copyMutation.mutate()}
            >
              {copyMutation.isPending ? "Copying…" : "Copy access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
