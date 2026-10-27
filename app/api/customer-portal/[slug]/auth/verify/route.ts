import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { CUSTOMER_PORTAL_COOKIE, createPortalToken, requestFingerprint, secureHash, userAgentFingerprint } from "@/lib/customer-portal";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const body = await request.json() as { code?: string };
    const cookieStore = await cookies();
    const challenge = cookieStore.get("masterapp_portal_challenge")?.value || "";
    if (!/^[0-9a-f-]{36}$/i.test(challenge) || !/^\d{6}$/.test(String(body.code || ""))) return NextResponse.json({ error: "Código inválido ou expirado." }, { status: 400 });
    const rawToken = createPortalToken();
    const { data, error } = await createAdminClient().rpc("verify_customer_portal_otp", {
      requested_challenge_id: challenge,
      requested_otp_hash: secureHash(`otp:${body.code}`),
      requested_session_hash: secureHash(`session:${rawToken}`),
      requested_user_agent_hash: userAgentFingerprint(request),
      requested_requester_hash: requestFingerprint(request),
    });
    if (error || !data?.session_id) return NextResponse.json({ error: "Código inválido ou expirado." }, { status: 400 });
    const response = NextResponse.json({ ok: true, redirect: `/conta/${slug}` }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(CUSTOMER_PORTAL_COOKIE, rawToken, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    response.cookies.delete("masterapp_portal_challenge");
    return response;
  } catch { return NextResponse.json({ error: "Não foi possível validar o acesso." }, { status: 400 }); }
}

