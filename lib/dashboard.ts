import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function getDashboardContext() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");
  const { data: member } = await supabase.from("establishment_members").select("establishment_id, role").eq("user_id", userId).limit(1).maybeSingle();
  if (!member) redirect("/onboarding");
  const { data: establishment } = await supabase.from("establishments").select("id, name, slug, onboarding_completed").eq("id", member.establishment_id).single();
  if (!establishment) redirect("/onboarding");
  return { supabase, userId, member, establishment };
}
