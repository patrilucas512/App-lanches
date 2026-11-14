import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperadmin } from "@/lib/superadmin";
import { PerformanceCenter } from "@/components/performance-center";

export const dynamic = "force-dynamic";
export default async function PerformancePage() {
  await requireSuperadmin(); const admin = createAdminClient();
  const [{ data: summary }, { data: slos }, { data: dlq }, { data: releases }] = await Promise.all([
    admin.rpc("get_performance_summary"), admin.from("performance_slos").select("*").eq("enabled", true).order("service_key"),
    admin.from("operational_dead_letters").select("*").is("reprocessed_at", null).order("failed_at", { ascending: false }).limit(50),
    admin.from("release_performance_snapshots").select("*").order("created_at", { ascending: false }).limit(10),
  ]);
  return <><header className="sa-page-head"><div><small>CENTRO DE COMANDO DE DESEMPENHO</small><h1>Desempenho</h1><p>Desempenho e resiliência: metas de serviço, filas, falhas pendentes, dependências, custos e funcionamento reduzido controlado, em uma visão interna.</p></div><a className="sa-button" href="/api/health" target="_blank" rel="noreferrer">Abrir verificação de saúde</a></header><PerformanceCenter summary={summary||{}} slos={slos||[]} dlq={dlq||[]} releases={releases||[]}/></>;
}
