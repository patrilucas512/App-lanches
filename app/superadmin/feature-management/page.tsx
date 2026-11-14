import { requireSuperadmin } from "@/lib/superadmin";
import { FeatureManagementCenter } from "@/components/feature-management-center";
export const dynamic="force-dynamic";
export default async function FeatureManagementPage(){await requireSuperadmin();return <><header className="sa-page-head"><div><small>CENTRAL DE CONTROLE DA PLATAFORMA</small><h1>Gestão de funções</h1><p>Chaves de função, configurações tipadas, liberação gradual, liberação de teste, exceções e desligamentos de emergência com decisão auditável.</p></div><a className="sa-button" href="/superadmin/qualidade">Qualidade e versões</a></header><FeatureManagementCenter/></>}
