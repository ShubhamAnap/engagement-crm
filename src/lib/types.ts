export type AppRole = "Admin" | "Manager" | "Agent" | "Sales";

export type Organization = {
  id: string;
  name: string;
  short_name: string;
  plan: string;
  created_at: string;
};

export type Profile = {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  role: AppRole;
  phone?: string | null;
  job_title?: string | null;
  avatar_url?: string | null;
  created_at: string;
  updated_at: string;
};

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  initials: string;
  phone?: string | null;
  jobTitle?: string | null;
  avatarUrl?: string | null;
  org: {
    id: string;
    name: string;
    short: string;
    plan: string;
  };
};

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
