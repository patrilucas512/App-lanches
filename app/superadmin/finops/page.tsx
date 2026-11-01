import { requireSuperadmin } from "@/lib/superadmin";
import { PlatformFinOpsCenter } from "@/components/platform-finops-center";
export const dynamic="force-dynamic";
export default async function PlatformFinOpsPage(){await requireSuperadmin();return <><header className="sa-page-head"><div><small>PLATFORM ECONOMICS · INTERNAL ONLY</small><h1>FinOps</h1><p>Custos técnicos, atribuição, reconciliação, margem, budgets, forecasts e otimização com lineage completo.</p></div><a className="sa-button" href="/superadmin/feature-management">Feature Management</a></header><PlatformFinOpsCenter/></>}
