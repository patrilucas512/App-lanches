import {redirect} from "next/navigation";
import {DashboardShell} from "@/components/dashboard-shell";
import {EnterpriseRiskCenter} from "@/components/enterprise-risk-center";
import {getDashboardContext} from "@/lib/dashboard";
import "./risk.css";
export const dynamic="force-dynamic";
export default async function EnterpriseRiskPage(){const{establishment,member,organizationMember}=await getDashboardContext();if((establishment.plan as{enterprise_risk_management_enabled?:boolean}|null)?.enterprise_risk_management_enabled===false)redirect("/painel");if(!["owner","manager"].includes(member.role)&&!["owner","admin","manager","supervisor","analyst"].includes(organizationMember?.role||""))redirect("/painel");return <DashboardShell brand={establishment} active="enterprise-risk" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head erm-head"><div><small>GOVERNANÇA · RISCO EMPRESARIAL</small><h1>Enterprise Risk Management</h1><p>Riscos inerentes e residuais, controles comprovados, tratamentos, aceites temporários, terceiros e KRIs — com decisões humanas e histórico preservado.</p><p><a href="/painel/incidentes">Incidentes</a> · <a href="/painel/operacoes/continuidade-negocio">Continuidade</a> · <a href="/painel/operacoes/confiabilidade">Confiabilidade</a></p></div></header><EnterpriseRiskCenter storeId={establishment.id}/></DashboardShell>}
