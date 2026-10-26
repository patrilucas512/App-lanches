import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const payload = await request.json().catch(() => ({}));
  if (typeof payload.storeId !== "string") return NextResponse.json({ error: "Unidade inválida." }, { status: 400 });
  const { data, error } = await supabase.rpc("set_active_unit", { requested_establishment_id: payload.storeId });
  if (error || !data?.id) return NextResponse.json({ error: error?.message ?? "Unidade não autorizada." }, { status: 403 });
  const response = NextResponse.json({ store: data });
  response.cookies.set("masterapp_active_store", data.id, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 365 });
  return response;
}
