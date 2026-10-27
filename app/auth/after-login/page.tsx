import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AfterLogin() {
  const supabase = await createClient(); const { data: claims } = await supabase.auth.getClaims(); const userId = claims?.claims?.sub; if (!userId) redirect("/login");
  const [{ data: profile }, { data: member }] = await Promise.all([supabase.from("profiles").select("is_superadmin").eq("id", userId).single(), supabase.from("establishment_members").select("role").eq("user_id", userId).limit(1).maybeSingle()]);
  await supabase.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", userId);
  if (profile?.is_superadmin) redirect("/superadmin/dashboard");
  if (member?.role === "attendant") redirect("/garcom/app");
  if (member?.role === "kitchen") redirect("/cozinha");
  redirect("/home");
}
