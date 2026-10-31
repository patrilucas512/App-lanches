import { requireSuperadmin } from "@/lib/superadmin";
import { FeatureManagementCenter } from "@/components/feature-management-center";
export const dynamic="force-dynamic";
export default async function FeatureManagementPage(){await requireSuperadmin();return <><header className="sa-page-head"><div><small>PLATFORM CONTROL PLANE</small><h1>Feature Management</h1><p>Flags, configurações tipadas, rollouts graduais, canary, overrides e kill switches com decisão auditável.</p></div><a className="sa-button" href="/superadmin/qualidade">Qualidade e releases</a></header><FeatureManagementCenter/></>}
