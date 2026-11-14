import{requireSuperadmin}from"@/lib/superadmin";
import{AIGovernanceCenter}from"@/components/ai-governance-center";
export const dynamic="force-dynamic";
export default async function AIGovernancePage(){await requireSuperadmin();return <><header className="sa-page-head"><div><small>GOVERNANÇA DE IA · CENTRAL DE CONTROLE</small><h1>IA e Agentes</h1><p>Registro, ferramentas, autonomia, memória, avaliações, custos e liberações graduais dos agentes existentes.</p></div><a className="sa-button" href="/superadmin/politicas">Abrir Motor de regras</a></header><AIGovernanceCenter/></>}
