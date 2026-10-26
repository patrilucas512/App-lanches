import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {fetchMercadoPagoSubscription,payloadHash} from "@/lib/customer-subscriptions";
import {verifyMercadoPagoSignature} from "@/lib/order-payments/providers";

export async function POST(request:Request){
  const raw=await request.text();
  try{
    const url=new URL(request.url);const accountId=String(url.searchParams.get("account")||"");const body=JSON.parse(raw||"{}") as Record<string,any>;const dataId=String(body.data?.id||body.id||"");
    if(!accountId||!dataId)return NextResponse.json({error:"Evento inválido."},{status:400});
    const admin=createAdminClient();const[{data:account},{data:secret}]=await Promise.all([admin.from("payment_gateway_accounts").select("id,environment").eq("id",accountId).eq("provider","mercado_pago").single(),admin.rpc("get_payment_gateway_secret",{requested_account_id:accountId})]);
    if(!account||!secret?.credential)return NextResponse.json({error:"Conta inválida."},{status:404});
    const signatureValid=Boolean(secret.webhook_secret)&&verifyMercadoPagoSignature({signature:request.headers.get("x-signature"),requestId:request.headers.get("x-request-id"),dataId,secret:secret.webhook_secret});
    if(!signatureValid)return NextResponse.json({error:"Assinatura inválida."},{status:401});
    const canonical=await fetchMercadoPagoSubscription(secret.credential,dataId);const status=String(canonical.status||"pending");const eventType=status==="authorized"?"subscription_activated":status==="paused"?"subscription_paused":status==="cancelled"?"subscription_cancelled":"subscription_created";
    const{error}=await admin.rpc("process_customer_subscription_event",{requested_gateway_account_id:accountId,requested_external_event_id:String(body.id||request.headers.get("x-request-id")||`${dataId}:${status}`),requested_external_subscription_id:String(canonical.id),requested_event_type:eventType,requested_status:status,requested_amount_cents:Math.round(Number(canonical.auto_recurring?.transaction_amount||0)*100),requested_period_start:canonical.date_created||null,requested_period_end:canonical.next_payment_date||null,requested_payload_hash:payloadHash(raw),requested_signature_valid:true,requested_metadata:{live_mode:canonical.live_mode}});
    return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json({ok:true});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Webhook inválido."},{status:400});}
}
