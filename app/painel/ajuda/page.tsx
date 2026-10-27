import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardContext } from "@/lib/dashboard";
const articles=[
 ["Configure sua primeira unidade","Dados, endereço, fuso e horários da operação.","/onboarding"],
 ["Crie ou importe o cardápio","Cadastre manualmente, use uma estrutura inicial ou importe CSV/XLSX.","/painel/importacao"],
 ["Faça um pedido de teste","Simule o fluxo sem afetar caixa, fiscal, estoque ou cobrança.","/onboarding"],
 ["Conecte WhatsApp e IA","Use apenas recursos incluídos no plano e valide antes de publicar.","/painel/configuracoes#whatsapp"],
 ["Cadastre sua equipe","Envie convites e associe permissões reais por unidade.","/painel/equipe"],
] as const;
export default async function HelpPage(){const{establishment,member}=await getDashboardContext();return <DashboardShell brand={establishment} active="help" storeSlug={establishment.slug} role={member.role}><header className="admin-page-heading"><div><small>CENTRAL DE AJUDA</small><h1>Primeiros passos.</h1><p>Guias curtos para colocar sua operação no ar.</p></div></header><section className="help-grid">{articles.map(([title,text,href])=><article key={title}><span>→</span><h2>{title}</h2><p>{text}</p><Link href={href}>Abrir orientação</Link></article>)}</section></DashboardShell>}
