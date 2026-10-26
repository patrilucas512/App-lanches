import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPortalToken, requestFingerprint, secureHash } from "@/lib/customer-portal";
import { createCustomerSubscriptionCheckout } from "@/lib/customer-subscriptions";
import type { GatewayEnvironment,GatewayProvider } from "@/lib/order-payments/providers";

export async function POST(request:Request,{params}:{params:Promise<{slug:string}>}){try{
  const {slug}=await params;const token=await readPortalToken();if(!token)return NextResponse.json({error:"Sessão expirada."},{status:401});
  const body=await request.json() as Record<string,unknown>;if(body.consent!==true)return NextResponse.json({error:"Confirme a cobrança recorrente e os termos."},{status:400});
  const provider=String(body.provider||"mercado_pago") as GatewayProvider;if(!["mercado_pago","pagarme"].includes(provider))return NextResponse.json({error:"Provedor inválido."},{status:400});
  const admin=createAdminClient();const consent=`Estou de acordo com a cobrança recorrente, o preço, a periodicidade, a renovação e os termos do plano. Provedor: ${provider}.`;
  const {data:pending,error}=await admin.rpc("begin_customer_subscription_checkout",{requested_session_hash:secureHash(`session:${token}`),requested_slug:slug,requested_plan_version_id:String(body.plan_version_id||""),requested_provider:provider,requested_consent_text:consent,requested_ip_hash:requestFingerprint(request)});
  if(error)return NextResponse.json({error:error.message},{status:400});
  const [{data:secret,error:secretError},{data:customer},{data:store}]=await Promise.all([admin.rpc("get_payment_gateway_secret",{requested_account_id:pending.account_id}),admin.from("customers").select("name,email").eq("id",pending.customer_id).single(),admin.from("establishments").select("slug").eq("id",(await admin.from("payment_gateway_accounts").select("establishment_id").eq("id",pending.account_id).single()).data?.establishment_id).single()]);
  if(secretError||!secret?.credential)return NextResponse.json({error:"Gateway não configurado."},{status:503});if(!customer?.email)return NextResponse.json({error:"Cadastre um e-mail no perfil para concluir a assinatura."},{status:400});
  const origin=new URL(request.url).origin;const checkout=await createCustomerSubscriptionCheckout({provider,environment:pending.environment as GatewayEnvironment,credential:secret.credential,origin,accountId:pending.account_id,checkout:{subscriptionId:pending.subscription_id,planName:pending.plan_name,amountCents:pending.price_cents,billingInterval:pending.billing_interval,customerName:customer.name,customerEmail:customer.email,storeSlug:store?.slug||slug}});
  await admin.rpc("record_customer_subscription_checkout",{requested_subscription_id:pending.subscription_id,requested_external_id:checkout.externalId,requested_checkout_url:checkout.checkoutUrl,requested_manual_renewal:checkout.manualRenewal});
  return NextResponse.json({url:checkout.checkoutUrl,manual_renewal:checkout.manualRenewal});
}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível iniciar a assinatura."},{status:400});}}

