import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppText } from "@/lib/whatsapp/cloud-api";
import { createOtp, requestFingerprint, secureHash } from "@/lib/customer-portal";

const generic = () => NextResponse.json({ ok: true, message: "Se o número puder receber mensagens, o código chegará em instantes." }, { headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await request.json() as { phone?: string };
    const otp = createOtp();
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("request_customer_portal_otp", {
      requested_slug: slug,
      requested_destination: String(body.phone || ""),
      requested_otp_hash: secureHash(`otp:${otp}`),
      requested_requester_hash: requestFingerprint(request),
      requested_purpose: "login",
    });
    if (error || !data?.challenge_id) return generic();
    const { data: connection } = await admin.from("whatsapp_connections").select("id,phone_number_id,graph_api_version")
      .eq("establishment_id", data.establishment_id).eq("status", "connected").order("is_primary", { ascending: false }).limit(1).maybeSingle();
    if (connection) {
      const { data: credential } = await admin.rpc("get_whatsapp_connection_secret", { requested_connection_id: connection.id });
      if (credential?.access_token) await sendWhatsAppText({ phoneNumberId: connection.phone_number_id, accessToken: credential.access_token, graphApiVersion: connection.graph_api_version, to: data.destination, text: `Seu código MasterApp é ${otp}. Ele expira em 10 minutos. Não compartilhe este código.` });
    }
    const response = generic();
    response.cookies.set("masterapp_portal_challenge", String(data.challenge_id), { httpOnly: true, secure: true, sameSite: "lax", path: `/api/customer-portal/${slug}/auth`, maxAge: 600 });
    return response;
  } catch { return generic(); }
}

