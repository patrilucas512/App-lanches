import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { GatewayEnvironment, GatewayProvider } from "@/lib/order-payments/providers";

type Checkout = { subscriptionId:string; planName:string; amountCents:number; billingInterval:"weekly"|"monthly"|"quarterly"|"yearly"; customerName:string; customerEmail:string; storeSlug:string };
type CheckoutResult = { externalId:string; checkoutUrl:string; manualRenewal:boolean };

const pagarmeBase=(environment:GatewayEnvironment)=>environment==="test"?"https://sdx-api.pagar.me/core/v5":"https://api.pagar.me/core/v5";
async function json(response:Response){const body=await response.json().catch(()=>({})) as Record<string,any>;if(!response.ok)throw new Error(String(body.message||`Gateway respondeu HTTP ${response.status}.`));return body;}

export async function createCustomerSubscriptionCheckout(input:{provider:GatewayProvider;environment:GatewayEnvironment;credential:string;origin:string;accountId:string;checkout:Checkout}):Promise<CheckoutResult>{
  const {provider,environment,credential,origin,accountId,checkout}=input;
  const returnUrl=`${origin}/conta/${checkout.storeSlug}?assinatura=${checkout.subscriptionId}`;
  if(provider==="mercado_pago"){
    const frequency=checkout.billingInterval==="weekly"?7:checkout.billingInterval==="quarterly"?3:checkout.billingInterval==="yearly"?12:1;
    const frequencyType=checkout.billingInterval==="weekly"?"days":"months";
    const body=await json(await fetch("https://api.mercadopago.com/preapproval",{method:"POST",headers:{Authorization:`Bearer ${credential}`,"Content-Type":"application/json","X-Idempotency-Key":`masterapp-customer-sub-${checkout.subscriptionId}`},body:JSON.stringify({reason:checkout.planName,external_reference:checkout.subscriptionId,payer_email:checkout.customerEmail,auto_recurring:{frequency,frequency_type:frequencyType,transaction_amount:checkout.amountCents/100,currency_id:"BRL"},back_url:returnUrl,notification_url:`${origin}/api/customer-subscriptions/webhook/mercado-pago?account=${accountId}`,status:"pending"})}));
    const url=String(body.init_point||"");if(!body.id||!url)throw new Error("Mercado Pago não retornou o checkout recorrente.");
    return{externalId:String(body.id),checkoutUrl:url,manualRenewal:false};
  }
  const body=await json(await fetch(`${pagarmeBase(environment)}/paymentlinks`,{method:"POST",headers:{Authorization:`Basic ${Buffer.from(`${credential}:`).toString("base64")}`,"Content-Type":"application/json","Idempotency-Key":`masterapp-customer-sub-${checkout.subscriptionId}`},body:JSON.stringify({is_building:false,type:"order",name:`Renovação ${checkout.planName}`,order_code:checkout.subscriptionId,max_paid_sessions:1,payment_settings:{accepted_payment_methods:["credit_card","pix"],credit_card_settings:{operation_type:"auth_and_capture",installments:[{number:1,total:checkout.amountCents}]},pix_settings:{expires_in:86400}},customer_settings:{name:checkout.customerName,email:checkout.customerEmail},cart_settings:{items:[{amount:checkout.amountCents,name:checkout.planName,default_quantity:1}]},success_url:returnUrl,skip_checkout_success_page:false})}));
  const url=String(body.url||body.payment_url||"");if(!body.id||!url)throw new Error("Pagar.me não retornou o link de renovação.");
  return{externalId:String(body.id),checkoutUrl:url,manualRenewal:true};
}

export async function fetchMercadoPagoSubscription(credential:string,id:string){return json(await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${credential}`},cache:"no-store"}));}
export async function cancelMercadoPagoSubscription(credential:string,id:string){return json(await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(id)}`,{method:"PUT",headers:{Authorization:`Bearer ${credential}`,"Content-Type":"application/json"},body:JSON.stringify({status:"cancelled"})}));}
export async function fetchPagarmeSubscriptionPayment(environment:GatewayEnvironment,credential:string,id:string){return json(await fetch(`${pagarmeBase(environment)}/orders/${encodeURIComponent(id)}`,{headers:{Authorization:`Basic ${Buffer.from(`${credential}:`).toString("base64")}`},cache:"no-store"}));}
export function payloadHash(raw:string){return createHash("sha256").update(raw).digest("hex");}
export function verifyPagarmeWebhook(raw:string,signature:string|null,secret?:string|null){if(!secret)return false;const received=String(signature||"").replace(/^sha256=/,"");const expected=createHmac("sha256",secret).update(raw).digest("hex");return received.length===expected.length&&timingSafeEqual(Buffer.from(received),Buffer.from(expected));}

