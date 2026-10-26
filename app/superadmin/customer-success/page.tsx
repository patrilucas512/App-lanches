import{requireSuperadmin}from"@/lib/superadmin";import{CustomerSuccessCenter}from"@/components/customer-success-center";
export const dynamic="force-dynamic";
export default async function CustomerSuccessPage(){await requireSuperadmin();return <><header className="sa-page-head"><div><small>RETENÇÃO · ADOÇÃO · VALOR</small><h1>Customer Success</h1><p>Carteira, saúde, onboarding, objetivos, renovações e expansão do MasterApp — com decisões e contatos sempre aprovados por pessoas.</p></div><a className="sa-button" href="/superadmin/vendas">Abrir CRM comercial</a></header><CustomerSuccessCenter/></>}

