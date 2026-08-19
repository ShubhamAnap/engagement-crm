import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";

export const Route = createFileRoute("/api/signup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { orgName, fullName, email, password } = body as {
            orgName: string;
            fullName: string;
            email: string;
            password: string;
          };

          if (!orgName?.trim() || !fullName?.trim() || !email?.trim() || !password) {
            return Response.json({ error: "All fields are required." }, { status: 400 });
          }
          if (password.length < 6) {
            return Response.json({ error: "Password must be at least 6 characters." }, { status: 400 });
          }

          const supabase = createServiceSupabase();

          // Check if email already exists
          const { data: existingUser } = await supabase
            .from("profiles")
            .select("id")
            .eq("email", email.trim().toLowerCase())
            .maybeSingle();
          if (existingUser) {
            return Response.json({ error: "An account with this email already exists." }, { status: 409 });
          }

          const shortName = orgName.trim().split(/\s+/).slice(0, 2).join(" ");

          // Create organization
          const { data: org, error: orgErr } = await supabase
            .from("organizations")
            .insert({ name: orgName.trim(), short_name: shortName, plan: "Free" })
            .select("id")
            .single();
          if (orgErr) throw new Error(orgErr.message);

          // Create auth user via admin API
          const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
            email: email.trim().toLowerCase(),
            password,
            email_confirm: true,
            user_metadata: { full_name: fullName.trim(), org_id: org.id },
          });
          if (authErr) {
            await supabase.from("organizations").delete().eq("id", org.id);
            throw new Error(authErr.message);
          }

          // Create profile (Admin role for the org creator)
          const { error: profileErr } = await supabase.from("profiles").insert({
            id: authUser.user.id,
            org_id: org.id,
            email: email.trim().toLowerCase(),
            full_name: fullName.trim(),
            role: "Admin",
          });
          if (profileErr) {
            await supabase.auth.admin.deleteUser(authUser.user.id);
            await supabase.from("organizations").delete().eq("id", org.id);
            throw new Error(profileErr.message);
          }

          // Seed default channels for the new org
          await supabase.from("channels").insert([
            { org_id: org.id, type: "website", name: "Website Chat", status: "Connected", health: 100, detail: "embed widget", is_enabled: true },
            { org_id: org.id, type: "whatsapp", name: "WhatsApp Business", status: "Disconnected", health: 0, is_enabled: false },
            { org_id: org.id, type: "email", name: "Email", status: "Disconnected", health: 0, is_enabled: false },
            { org_id: org.id, type: "instagram", name: "Instagram", status: "Disconnected", health: 0, is_enabled: false },
            { org_id: org.id, type: "facebook", name: "Facebook Messenger", status: "Disconnected", health: 0, is_enabled: false },
          ]).throwOnError().catch((e) => console.warn("[signup] channel seed:", e));

          // Seed default AI agents
          await supabase.from("agents").insert([
            { org_id: org.id, key: "support", name: "Support Agent", description: "General support and enquiry handling", status: "Active", model: "gpt-4o-mini", memory_enabled: true },
            { org_id: org.id, key: "sales", name: "Sales Agent", description: "Product discovery, pricing guidance, lead capture", status: "Active", model: "gpt-4o-mini", memory_enabled: true },
          ]).throwOnError().catch((e) => console.warn("[signup] agent seed:", e));

          return Response.json({ ok: true, orgId: org.id });
        } catch (err) {
          console.error("[signup]", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Signup failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
