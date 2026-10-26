import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const { data, error } = await createAdminClient().rpc("public_saas_plans");
  if (error) return NextResponse.json({ error: "Não foi possível carregar os planos." }, { status: 500 });
  return NextResponse.json({ plans: data || [] }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } });
}

