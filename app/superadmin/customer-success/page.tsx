import{requireSuperadmin}from"@/lib/superadmin";import{CustomerSuccessCenter}from"@/components/customer-success-center";
export const dynamic="force-dynamic";
export default async function CustomerSuccessPage(){await requireSuperadmin();return <><header className="sa-page-head"><div><small>RETENÇÃO · USO · VALOR</small><h1>Sucesso do cliente</h1><p>Carteira, saúde, primeiros passos, objetivos, renovações e expansão do MasterApp — com decisões e contatos sempre aprovados por pessoas.</p></div><a className="sa-button" href="/superadmin/vendas">Abrir CRM comercial</a></header><CustomerSuccessCenter/></>}

