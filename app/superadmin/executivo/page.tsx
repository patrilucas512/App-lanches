import{requireSuperadmin}from"@/lib/superadmin";import{RevenueOperationsCenter}from"@/components/revenue-operations-center";
export const dynamic="force-dynamic";
export default async function ExecutivePage(){await requireSuperadmin();return <><header className="sa-page-head"><div><small>REVENUE OPERATIONS · GOVERNANÇA</small><h1>Executivo</h1><p>Receita, crescimento, vendas, retenção, unit economics, planejamento e riscos do próprio MasterApp.</p></div><a className="sa-button" href="/api/revenue-ops?format=csv">Exportar CSV</a></header><RevenueOperationsCenter/></>}
