import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardContext } from "@/lib/dashboard";

export default async function TeamPage() {
  const { supabase, establishment } = await getDashboardContext();
  const { data: members } = await supabase.from("establishment_members").select("id, user_id, role, created_at").eq("establishment_id", establishment.id);
  return <DashboardShell active="team" storeSlug={establishment.slug}><header className="dashboard-head"><div><small>ACESSOS</small><h1>Sua equipe.</h1></div><span className="status-pill">{members?.length ?? 0} membros</span></header><article className="panel"><h2>Permissões por função</h2><p>Proprietário, gerente, atendente e editor de catálogo têm acessos separados e validados pelo banco.</p><table className="table"><thead><tr><th>IDENTIFICADOR</th><th>FUNÇÃO</th><th>DESDE</th></tr></thead><tbody>{members?.map(member => <tr key={member.id}><td>{member.user_id.slice(0, 8)}…</td><td>{member.role}</td><td>{new Date(member.created_at).toLocaleDateString("pt-BR")}</td></tr>)}</tbody></table></article></DashboardShell>;
}
