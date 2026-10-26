import {redirect} from "next/navigation";
import {DashboardShell} from "@/components/dashboard-shell";
import {LogisticsCommandCenter} from "@/components/logistics-command-center";
import {getDashboardContext} from "@/lib/dashboard";
import "./logistics.css";
export default async function LogisticsPage(){const{establishment,member}=await getDashboardContext();if(!["owner","manager"].includes(member.role))redirect("/painel");return <DashboardShell brand={establishment} active="logistics" storeSlug={establishment.slug} role={member.role}><header className="admin-page-heading logistics-heading"><div><small>DELIVERY → OPERAÇÃO</small><h1>Central de Despacho.</h1><p>Pedidos, motoboys, rotas, zonas, ETA, incidentes e capacidade em uma única operação.</p></div><span className="logistics-live">● Tempo real</span></header><LogisticsCommandCenter storeId={establishment.id}/></DashboardShell>}
