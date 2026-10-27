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
  return <><header className="sa-page-head"><div><small>PERFORMANCE COMMAND CENTER</small><h1>Performance e resiliência</h1><p>Baseline, SLOs, filas, DLQ, dependências, custos e degradação controlada em uma visão interna.</p></div><a className="sa-button" href="/api/health" target="_blank" rel="noreferrer">Abrir health check</a></header><PerformanceCenter summary={summary||{}} slos={slos||[]} dlq={dlq||[]} releases={releases||[]}/></>;
}
