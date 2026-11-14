import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperadmin } from "@/lib/superadmin";
import { QualityCenter } from "@/components/quality-center";

export const dynamic = "force-dynamic";
export default async function QualityPage() {
  await requireSuperadmin(); const admin = createAdminClient();
  const [{ data: summary }, { data: flags }, { data: releases }, { data: suites }, { data: regressions }] = await Promise.all([
    admin.rpc("get_quality_summary"), admin.from("quality_feature_flags").select("*").order("flag_key"),
    admin.from("platform_releases").select("*").order("created_at", { ascending: false }).limit(20),
    admin.from("qa_suite_runs").select("*").order("created_at", { ascending: false }).limit(30),
    admin.from("qa_regressions").select("*").order("detected_at", { ascending: false }).limit(30),
  ]);
  return <><header className="sa-page-head"><div><small>CENTRO DE COMANDO DE QUALIDADE</small><h1>Qualidade</h1><p>Qualidade e versões: etapas de entrega, fluxos principais, ambientes, chaves de função, regressões e volta à versão anterior com auditoria.</p></div><a className="sa-button" href="/api/health" target="_blank" rel="noreferrer">Verificação de saúde</a></header><QualityCenter summary={summary || {}} flags={flags || []} releases={releases || []} suites={suites || []} regressions={regressions || []}/></>;
}
