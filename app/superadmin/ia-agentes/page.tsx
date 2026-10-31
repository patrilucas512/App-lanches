import{requireSuperadmin}from"@/lib/superadmin";
import{AIGovernanceCenter}from"@/components/ai-governance-center";
export const dynamic="force-dynamic";
export default async function AIGovernancePage(){await requireSuperadmin();return <><header className="sa-page-head"><div><small>AI GOVERNANCE · CONTROL PLANE</small><h1>IA e Agentes</h1><p>Registro, ferramentas, autonomia, memória, avaliações, custos e rollouts dos agentes existentes.</p></div><a className="sa-button" href="/superadmin/politicas">Abrir Policy Engine</a></header><AIGovernanceCenter/></>}
