import {redirect} from "next/navigation";
import {DashboardShell} from "@/components/dashboard-shell";
import {ProcurementIntelligenceCenter} from "@/components/procurement-intelligence-center";
import {getDashboardContext} from "@/lib/dashboard";
import "./procurement.css";
export default async function ProcurementPage(){const{establishment,member}=await getDashboardContext();if(["attendant","kitchen","catalog_editor"].includes(member.role))redirect("/painel");return <DashboardShell brand={establishment} active="procurement" storeSlug={establishment.slug} role={member.role}><header className="admin-page-heading pi-heading"><div><small>GESTÃO → COMPRAS</small><h1>Compras Inteligentes.</h1><p>Planejamento de reposição, cotações, fornecedores, recebimento e abastecimento multiunidade.</p></div><span className="manager-safety-pill">Controle humano obrigatório</span></header><ProcurementIntelligenceCenter storeId={establishment.id} storeName={establishment.name}/></DashboardShell>}
