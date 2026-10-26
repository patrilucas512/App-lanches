import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { WorkforcePhase18Console } from "@/components/workforce-phase18-console";
import { getDashboardContext } from "@/lib/dashboard";
import { createClient } from "@/lib/supabase/server";

export default async function WorkforcePage(){
 const {establishment,member}=await getDashboardContext();if(!["owner","manager"].includes(member.role))redirect("/painel");
 const db=await createClient();const {data:staff}=await db.from("custom_staff_members").select("id,name,status,organization_id,primary_store_id,staff_roles(name,system_key)").eq("organization_id",establishment.organization_id).eq("status","active").order("name");
 return <DashboardShell brand={establishment} active="workforce" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head"><div><small>FASE 18 · OPERAÇÃO E PESSOAS</small><h1>Gestão de Pessoas</h1><p>Escalas, ponto, cobertura, produtividade e custos gerenciais integrados às unidades do MasterApp.</p></div></header><WorkforcePhase18Console establishmentId={establishment.id} staff={staff||[]}/></DashboardShell>;
}
