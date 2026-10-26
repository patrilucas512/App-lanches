import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {readPortalToken,secureHash} from "@/lib/customer-portal";
import {cancelMercadoPagoSubscription}from"@/lib/customer-subscriptions";

export async function POST(request:Request,{params}:{params:Promise<{slug:string}>}){
  const{slug}=await params;const token=await readPortalToken();if(!token)return NextResponse.json({error:"Sessão expirada."},{status:401});
  try{
    const body=await request.json();const admin=createAdminClient();const common={requested_session_hash:secureHash(`session:${token}`),requested_slug:slug,requested_subscription_id:String(body.subscription_id||"")};
    if((body.action==="cancel"&&body.confirm===true)||body.action==="reactivate"){
      const{data:prepared,error:prepareError}=await admin.rpc("prepare_customer_subscription_cancellation",common);if(prepareError)return NextResponse.json({error:prepareError.message},{status:400});
      if(body.action==="reactivate"&&!prepared.manual_renewal)return NextResponse.json({error:"Faça uma nova contratação segura para reativar este plano recorrente."},{status:400});
      if(body.action==="cancel"&&prepared.provider==="mercado_pago"&&!prepared.manual_renewal){
        const{data:secret,error:secretError}=await admin.rpc("get_payment_gateway_secret",{requested_account_id:prepared.gateway_account_id});
        if(secretError||!secret?.credential)return NextResponse.json({error:"Não foi possível cancelar no gateway. Nenhuma alteração foi feita."},{status:503});
        await cancelMercadoPagoSubscription(secret.credential,prepared.provider_subscription_id);
      }
    }
    const{data,error}=await admin.rpc("customer_subscription_portal_action",{...common,requested_action:String(body.action||""),requested_confirm:Boolean(body.confirm)});
    return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json({result:data});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Ação inválida."},{status:400});}
}
