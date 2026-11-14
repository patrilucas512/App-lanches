import {requireSuperadmin} from "@/lib/superadmin";
import {PolicyEngineCenter} from "@/components/policy-engine-center";
export const dynamic="force-dynamic";
export default async function PolicyEnginePage(){await requireSuperadmin();return <><header className="sa-page-head"><div><small>GESTÃO DE DECISÕES · CENTRAL DE CONTROLE INTERNA</small><h1>Políticas e regras</h1><p>Políticas com histórico de versões, regras tipadas, simulação, exceções, decisões e publicação controlada.</p></div><a className="sa-button" href="/superadmin/operacoes-internas">Aprovações</a></header><PolicyEngineCenter/></>}
