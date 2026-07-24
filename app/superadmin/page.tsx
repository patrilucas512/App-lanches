import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { createClient } from "@/lib/supabase/server";

export default async function SuperadminPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) notFound();
  const { data: profile } = await supabase.from("profiles").select("is_superadmin").eq("id", userId).single();
  if (!profile?.is_superadmin) notFound();
  const [{ data: stores }, { data: subscriptions }, { count: users }] = await Promise.all([
    supabase.from("establishments").select("id, name, slug, active, created_at").order("created_at", { ascending: false }),
    supabase.from("subscriptions").select("establishment_id, status"),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
  ]);
  const active = subscriptions?.filter(subscription => ["active", "trialing"].includes(subscription.status)).length ?? 0;
  return <DashboardShell><header className="dashboard-head"><div><small>PLATAFORMA</small><h1>Superadmin.</h1></div><span className="status-pill">Acesso global</span></header><div className="dashboard-cards"><article className="dash-card"><small>ESTABELECIMENTOS</small><strong>{stores?.length ?? 0}</strong></article><article className="dash-card"><small>ASSINATURAS ATIVAS</small><strong>{active}</strong></article><article className="dash-card"><small>USUÁRIOS</small><strong>{users ?? 0}</strong></article><article className="dash-card"><small>MRR</small><strong>—</strong></article></div><article className="panel" style={{marginTop:14}}><h2>Estabelecimentos</h2><table className="table"><thead><tr><th>NOME</th><th>SLUG</th><th>STATUS</th><th>CADASTRO</th></tr></thead><tbody>{stores?.map(store => <tr key={store.id}><td>{store.name}</td><td>{store.slug}</td><td>{store.active ? "Ativo" : "Suspenso"}</td><td>{new Date(store.created_at).toLocaleDateString("pt-BR")}</td></tr>)}</tbody></table></article></DashboardShell>;
}
