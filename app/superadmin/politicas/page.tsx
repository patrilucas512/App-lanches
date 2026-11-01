import {requireSuperadmin} from "@/lib/superadmin";
import {PolicyEngineCenter} from "@/components/policy-engine-center";
export const dynamic="force-dynamic";
export default async function PolicyEnginePage(){await requireSuperadmin();return <><header className="sa-page-head"><div><small>DECISION MANAGEMENT · INTERNAL CONTROL PLANE</small><h1>Políticas e Regras</h1><p>Políticas versionadas, regras tipadas, simulação, exceções, decisões e publicação governada.</p></div><a className="sa-button" href="/superadmin/operacoes-internas">Approval Engine</a></header><PolicyEngineCenter/></>}
