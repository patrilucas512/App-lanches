import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { VendorManagementCenter } from "@/components/vendor-management-center";
import { getDashboardContext } from "@/lib/dashboard";
import "./vendor.css";
export const dynamic="force-dynamic";
export default async function VendorManagementPage(){
  const {establishment,member,organizationMember}=await getDashboardContext();
  if((establishment.plan as {vendor_management_enabled?:boolean}|null)?.vendor_management_enabled===false)redirect("/painel");
  if(!["owner","manager"].includes(member.role)&&!["owner","admin","manager","supervisor","analyst"].includes(organizationMember?.role||""))redirect("/painel");
  return <DashboardShell brand={establishment} active="vendor-management" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head vm-head"><div><small>GOVERNANÇA · TERCEIROS</small><h1>Terceiros & Fornecedores</h1><p>Relações, evidências, desempenho, custos, riscos, renovações e saída em uma visão governada.</p></div></header><VendorManagementCenter storeId={establishment.id}/></DashboardShell>;
}
