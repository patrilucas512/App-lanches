import{requireSuperadmin}from"@/lib/superadmin";import{ExecutiveCommandCenter}from"@/components/executive-command-center";
export const dynamic="force-dynamic";
export default async function ExecutiveCommandPage(){await requireSuperadmin();return <><header className="sa-page-head"><div><small>MASTERAPP · VISÃO CONSOLIDADA</small><h1>Centro de Comando</h1><p>Prioridades, riscos e decisões executivas com fontes oficiais, fatores transparentes e controle humano.</p></div></header><ExecutiveCommandCenter/></>}
