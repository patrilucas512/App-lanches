import { createPixPayment, readPixPayment } from "@/lib/order-payments/pix";
import { createHostedCheckout, fetchMercadoPagoPayment, normalizePaymentStatus, type GatewayEnvironment, type GatewayProvider } from "@/lib/order-payments/providers";
import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;
type CreatedOrder = { order_id:string; order_number:number; tracking_token:string; total_cents:number };
type PaymentContext = { payment_kind?:string; payer_email?:string; payer_cpf?:string; gateway_provider?:GatewayProvider };

export async function hasActiveGateway(admin:Admin, establishmentId:string, provider?:GatewayProvider) {
  let query=admin.from("payment_gateway_accounts").select("id,provider,environment").eq("establishment_id",establishmentId).eq("active",true).not("secret_id","is",null);
  if(provider) query=query.eq("provider",provider);
  const {data}=await query.order("provider").limit(1).maybeSingle();
  return data as {id:string;provider:GatewayProvider;environment:GatewayEnvironment}|null;
}

export async function prepareWhatsAppPayment(admin:Admin, establishmentId:string, order:CreatedOrder, context:PaymentContext) {
  const {data:record}=await admin.from("orders").select("id,order_number,total_cents,customer_name,tracking_token,payment_method,online_payment_status,created_at").eq("id",order.order_id).eq("establishment_id",establishmentId).single();
  if(!record || !String(record.payment_method).endsWith("_online")) return null;
  const provider=(context.gateway_provider || String(record.payment_method).replace("_online", "")) as GatewayProvider;
  const account=await hasActiveGateway(admin,establishmentId,provider);
  if(!account) throw new Error("O pagamento online ficou indisponível. Fale com a equipe para escolher outra forma de pagamento.");
  const idempotencyKey=`${provider}:${record.id}`;
  const paymentKind=context.payment_kind==="pix"?"pix":"hosted";
  const {error:reserveError}=await admin.from("order_payment_transactions").upsert({
    establishment_id:establishmentId,order_id:record.id,gateway_account_id:account.id,provider,
    amount_cents:record.total_cents,idempotency_key:idempotencyKey,payment_kind:paymentKind,
  },{onConflict:"establishment_id,idempotency_key",ignoreDuplicates:true});
  if(reserveError) throw new Error("Não foi possível reservar o pagamento.");
  const {data:transaction}=await admin.from("order_payment_transactions").select("id,external_id,checkout_url,payment_kind,created_at,expires_at").eq("establishment_id",establishmentId).eq("idempotency_key",idempotencyKey).single();
  if(!transaction || transaction.payment_kind!==paymentKind) throw new Error("Este pedido já possui outra forma de pagamento em andamento.");
  const {data:secrets,error:secretError}=await admin.rpc("get_payment_gateway_secret",{requested_account_id:account.id});
  if(secretError||!secrets?.credential) throw new Error("Pagamento temporariamente indisponível.");
  const origin=(process.env.NEXT_PUBLIC_SITE_URL||"").replace(/\/$/,"");
  const {data:establishment}=await admin.from("establishments").select("slug").eq("id",establishmentId).single();

  if(paymentKind==="pix") {
    if(provider!=="mercado_pago") throw new Error("O Pix automático requer uma conta Mercado Pago ativa.");
    let pix;
    if(transaction.external_id) pix=readPixPayment(await fetchMercadoPagoPayment(String(secrets.credential),transaction.external_id),record.id,record.total_cents);
    else {
      const {data:connection}=await admin.from("whatsapp_connections").select("pix_expiration_minutes").eq("establishment_id",establishmentId).single();
      pix=await createPixPayment({credential:String(secrets.credential),accountId:account.id,origin,orderId:record.id,orderNumber:record.order_number,amountCents:record.total_cents,email:String(context.payer_email||""),cpf:String(context.payer_cpf||""),createdAt:transaction.created_at,expiresInMinutes:Number(connection?.pix_expiration_minutes||30)});
      const {error}=await admin.from("order_payment_transactions").update({external_id:pix.id,expires_at:pix.expiresAt}).eq("id",transaction.id).eq("gateway_account_id",account.id);
      if(error) throw new Error("Pix gerado. Envie a confirmação novamente para recuperar a mesma cobrança.");
    }
    if(pix.status!=="pending") await admin.rpc("confirm_online_order_payment",{requested_gateway_account_id:account.id,requested_external_id:pix.id,requested_status:normalizePaymentStatus(pix.status),requested_raw_status:pix.status,requested_amount_cents:pix.amountCents,requested_order_id:record.id});
    return {kind:"pix" as const,code:pix.qrCode,expiresAt:pix.expiresAt};
  }

  if(transaction.checkout_url) return {kind:"hosted" as const,url:transaction.checkout_url};
  const checkout=await createHostedCheckout({provider,environment:account.environment,credential:String(secrets.credential),origin,accountId:account.id,order:{id:record.id,orderNumber:record.order_number,amountCents:record.total_cents,customerName:record.customer_name,trackingToken:record.tracking_token,establishmentSlug:establishment!.slug}});
  const {error}=await admin.rpc("record_online_payment_session",{requested_order_id:record.id,requested_gateway_account_id:account.id,requested_external_id:checkout.externalId,requested_checkout_url:checkout.checkoutUrl,requested_idempotency_key:idempotencyKey});
  if(error) throw error;
  return {kind:"hosted" as const,url:checkout.checkoutUrl};
}
