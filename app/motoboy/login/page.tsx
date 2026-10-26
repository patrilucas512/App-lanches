import { Brand } from "@/components/ui";
import { DriverLoginForm } from "@/components/driver-access";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function DriverLoginPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims?.sub) {
    const { data: driver } = await supabase.from("driver_profiles").select("id,active,approval_status,custom_staff_members!inner(status)").eq("user_id", claims.claims.sub).eq("active", true).eq("approval_status", "approved").maybeSingle();
    const member = Array.isArray(driver?.custom_staff_members) ? driver.custom_staff_members[0] : driver?.custom_staff_members;
    if (driver && member?.status === "active") redirect("/motoboy");
  }
  return <main className="auth-page"><section className="auth-panel"><Brand/><div className="auth-card"><span className="kicker">ACESSO DO FUNCIONÁRIO</span><h1>Entrar como motoboy.</h1><p>Use seu nome completo e a senha cadastrada.</p><DriverLoginForm/></div></section><aside className="auth-art"><span>ENTREGAS · ROTA · RESPONSABILIDADE</span><h2>Seu trabalho,<br/><em>registrado com segurança.</em></h2></aside></main>;
}
