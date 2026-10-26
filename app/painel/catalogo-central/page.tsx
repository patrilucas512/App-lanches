import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { CatalogGovernanceCenter } from "@/components/catalog-governance-center";
import { getDashboardContext } from "@/lib/dashboard";
import "./catalog.css";

export default async function CentralCatalogPage() {
  const { establishment, member, organizationMember } = await getDashboardContext();
  if (establishment.plan?.central_catalog_enabled === false) redirect("/painel/cardapio");
  if (!["owner", "manager", "catalog_editor"].includes(member.role) && !["owner", "admin", "manager", "supervisor"].includes(organizationMember?.role || "")) redirect("/painel");
  return <DashboardShell brand={establishment} active="central-catalog" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head catalog-head"><div><small>FASE 62 · PIM E GOVERNANÇA</small><h1>Catálogo central</h1><p>Produtos, preços, disponibilidade e distribuição multiunidade com publicação segura.</p></div><span>Fonte operacional: produtos atuais</span></header>
    <CatalogGovernanceCenter storeId={establishment.id} />
  </DashboardShell>;
}
