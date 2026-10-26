import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppText } from "@/lib/whatsapp/cloud-api";
import { CUSTOMER_PORTAL_COOKIE, createOtp, createPortalToken, getPortalContext, readPortalToken, requestFingerprint, secureHash } from "@/lib/customer-portal";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const context = await getPortalContext(slug);
  if (!context) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  const raw = await readPortalToken();
  const admin=createAdminClient();
  const [{ data: subscriptions },{data:reservationContext}]=await Promise.all([
    admin.rpc("get_customer_subscription_portal", { requested_session_hash: secureHash(`session:${raw}`), requested_slug: slug }),
    admin.rpc("get_reservation_portal_context",{requested_session_hash:secureHash(`session:${raw}`),requested_slug:slug}),
  ]);
  return NextResponse.json({ ...context, subscriptions: subscriptions?.subscriptions || [], available_subscription_plans: subscriptions?.available_plans || [], reservations:reservationContext?.reservations||[], waitlist:reservationContext?.waitlist||[], reservation_settings:reservationContext?.settings||null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const raw = await readPortalToken();
    if (!raw) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const body = await request.json() as { action?: string; payload?: Record<string, unknown> };
    if (!body.action) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    if (body.action === "reorder") {
      const { data, error } = await createAdminClient().rpc("prepare_customer_reorder", { requested_session_hash: secureHash(`session:${raw}`), requested_slug: slug, requested_order_id: String(body.payload?.order_id || "") });
      return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ result: data });
    }
    if (body.action === "magic_link") {
      const token = createPortalToken();
      const { data, error } = await createAdminClient().rpc("create_customer_magic_order_link", { requested_session_hash: secureHash(`session:${raw}`), requested_slug: slug, requested_order_id: String(body.payload?.order_id || ""), requested_token_hash: secureHash(`magic:${token}`) });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ result: { ...(data as Record<string,unknown>), url: `${new URL(request.url).origin}/conta/${slug}/acesso/${token}` } });
    }
    if (body.action === "request_phone_change") {
      const otp=createOtp(); const admin=createAdminClient();
      const {data,error}=await admin.rpc("request_customer_phone_change",{requested_session_hash:secureHash(`session:${raw}`),requested_slug:slug,requested_destination:String(body.payload?.phone||""),requested_otp_hash:secureHash(`otp:${otp}`),requested_requester_hash:requestFingerprint(request)});
      if(error||!data?.challenge_id)return NextResponse.json({error:error?.message||"Não foi possível enviar o código."},{status:400});
      const {data:connection}=await admin.from("whatsapp_connections").select("id,phone_number_id,graph_api_version").eq("establishment_id",data.establishment_id).eq("status","connected").order("is_primary",{ascending:false}).limit(1).maybeSingle();
      if(connection){const {data:credential}=await admin.rpc("get_whatsapp_connection_secret",{requested_connection_id:connection.id});if(credential?.access_token)await sendWhatsAppText({phoneNumberId:connection.phone_number_id,accessToken:credential.access_token,graphApiVersion:connection.graph_api_version,to:data.destination,text:`Seu código para confirmar o novo telefone é ${otp}. Ele expira em 10 minutos.`});}
      return NextResponse.json({result:{challenge_id:data.challenge_id,message:"Código enviado para o novo telefone."}});
    }
    if(body.action==="confirm_phone_change"){
      const {data,error}=await createAdminClient().rpc("verify_customer_phone_change",{requested_session_hash:secureHash(`session:${raw}`),requested_slug:slug,requested_challenge_id:String(body.payload?.challenge_id||""),requested_otp_hash:secureHash(`otp:${String(body.payload?.code||"")}`)});
      return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json({result:data});
    }
    if(body.action==="reservation_availability"){
      const admin=createAdminClient();const{data:store}=await admin.from("establishments").select("id").eq("slug",slug).eq("active",true).maybeSingle();
      if(!store)return NextResponse.json({error:"Unidade indisponível."},{status:404});
      const{data,error}=await admin.rpc("get_reservation_availability",{requested_establishment_id:store.id,requested_start:String(body.payload?.starts_at||""),requested_party_size:Number(body.payload?.party_size||0),requested_duration_minutes:Number(body.payload?.duration_minutes||90),requested_area_id:null});
      return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json({result:data});
    }
    if(body.action==="create_reservation"){
      const idempotency=secureHash(`reservation:${raw}:${String(body.payload?.client_request_id||"")}`);
      const{data,error}=await createAdminClient().rpc("create_portal_reservation",{requested_session_hash:secureHash(`session:${raw}`),requested_slug:slug,requested_start:String(body.payload?.starts_at||""),requested_party_size:Number(body.payload?.party_size||0),requested_duration_minutes:Number(body.payload?.duration_minutes||90),requested_notes:String(body.payload?.notes||""),requested_idempotency_key:idempotency});
      return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json({result:data});
    }
    if(body.action==="reservation_action"){
      const{data,error}=await createAdminClient().rpc("portal_reservation_action",{requested_session_hash:secureHash(`session:${raw}`),requested_slug:slug,requested_reservation_id:String(body.payload?.reservation_id||""),requested_action:String(body.payload?.reservation_action||""),requested_payload:body.payload||{}});
      return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json({result:data});
    }
    if(body.action==="join_waitlist"){
      const idempotency=secureHash(`waitlist:${raw}:${String(body.payload?.client_request_id||"")}`);
      const{data,error}=await createAdminClient().rpc("join_portal_waitlist",{requested_session_hash:secureHash(`session:${raw}`),requested_slug:slug,requested_party_size:Number(body.payload?.party_size||0),requested_notes:String(body.payload?.notes||""),requested_idempotency_key:idempotency});
      return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json({result:data});
    }
    if (body.action === "logout") {
      await createAdminClient().rpc("logout_customer_portal", { requested_session_hash: secureHash(`session:${raw}`), requested_all: Boolean(body.payload?.all) });
      const response = NextResponse.json({ ok: true }); response.cookies.delete(CUSTOMER_PORTAL_COOKIE); return response;
    }
    const { data, error } = await createAdminClient().rpc("customer_portal_action", { requested_session_hash: secureHash(`session:${raw}`), requested_slug: slug, requested_action: body.action, requested_payload: body.payload || {} });
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ result: data });
  } catch { return NextResponse.json({ error: "Não foi possível concluir esta ação." }, { status: 400 }); }
}
