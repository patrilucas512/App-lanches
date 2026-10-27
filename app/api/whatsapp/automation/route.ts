import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request:Request) {
  try {
    const body=await request.json() as Record<string,unknown>;
    const establishmentId=String(body.establishment_id||"");
    if (!/^[0-9a-f-]{36}$/i.test(establishmentId)) return NextResponse.json({error:"Estabelecimento inválido."},{status:400});
    const attendantName=String(body.ai_attendant_name||"").trim().slice(0,60);
    const welcome=String(body.ai_welcome_message||"").trim().slice(0,1000);
    const fallback=String(body.ai_fallback_message||"").trim().slice(0,1000);
    if (attendantName.length<2||!welcome||!fallback) return NextResponse.json({error:"Preencha o nome e as mensagens do atendente."},{status:400});
    const supabase=await createClient();
    const {data,error}=await supabase.rpc("configure_whatsapp_automation",{
      requested_establishment_id:establishmentId,
      requested_ai_enabled:Boolean(body.ai_enabled),
      requested_automatic_replies_enabled:Boolean(body.automatic_replies_enabled),
      requested_human_handoff_enabled:Boolean(body.human_handoff_enabled),
      requested_outside_hours_enabled:Boolean(body.ai_outside_business_hours),
      requested_attendant_name:attendantName,
      requested_welcome_message:welcome,
      requested_fallback_message:fallback,
    });
    if (error) return NextResponse.json({error:error.message},{status:403});
    const recoveryDelay=Math.min(1440,Math.max(15,Math.trunc(Number(body.cart_recovery_delay_minutes||30))));
    const pixExpiration=Math.min(1440,Math.max(30,Math.trunc(Number(body.pix_expiration_minutes||30))));
    const {data:commerce,error:commerceError}=await supabase.rpc("configure_whatsapp_commerce",{
      requested_establishment_id:establishmentId,
      requested_recovery_enabled:Boolean(body.cart_recovery_enabled),
      requested_recovery_delay_minutes:recoveryDelay,
      requested_upsell_enabled:Boolean(body.upsell_enabled),
      requested_pix_expiration_minutes:pixExpiration,
      requested_notify_payment:Boolean(body.notify_payment_confirmed),
      requested_notify_preparing:Boolean(body.notify_order_preparing),
      requested_notify_ready:Boolean(body.notify_order_ready),
      requested_notify_out_for_delivery:Boolean(body.notify_order_out_for_delivery),
      requested_notify_delivered:Boolean(body.notify_order_delivered),
    });
    if(commerceError) return NextResponse.json({error:commerceError.message},{status:403});
    return NextResponse.json({automation:{...data,...commerce}});
  } catch { return NextResponse.json({error:"Não foi possível salvar o atendente automático."},{status:500}); }
}

