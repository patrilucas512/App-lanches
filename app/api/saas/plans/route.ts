import { NextResponse } from "next/server";
import { createAdminClient, withAdminCredentials } from "@/lib/supabase/admin";

export const GET = withAdminCredentials(async () => {
  const { data, error } = await createAdminClient().rpc("public_saas_plans");
  if (error) return NextResponse.json({ error: "Não foi possível carregar os planos." }, { status: 500 });
  return NextResponse.json({ plans: data || [] }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } });
});

