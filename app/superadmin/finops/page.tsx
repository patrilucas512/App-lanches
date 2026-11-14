import { requireSuperadmin } from "@/lib/superadmin";
import { PlatformFinOpsCenter } from "@/components/platform-finops-center";
export const dynamic="force-dynamic";
export default async function PlatformFinOpsPage(){await requireSuperadmin();return <><header className="sa-page-head"><div><small>CUSTOS DA PLATAFORMA · SOMENTE USO INTERNO</small><h1>Custos da plataforma</h1><p>Custos técnicos, atribuição, conciliação, margem, orçamentos, previsões e otimização com a origem dos dados completa.</p></div><a className="sa-button" href="/superadmin/feature-management">Gestão de funções</a></header><PlatformFinOpsCenter/></>}
