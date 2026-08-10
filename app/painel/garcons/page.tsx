import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardContext } from "@/lib/dashboard";

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function WaiterReportPage() {
  const { supabase, establishment, member } = await getDashboardContext();
  if (!["owner", "manager"].includes(member.role)) redirect("/painel/garcom");
  const [{ data: waiters }, { data: sessions }, { data: orders }, { data: payments }, { data: proofs }] = await Promise.all([
    supabase.from("waiters").select("id,user_id,name,sector,status,active_now").eq("establishment_id", establishment.id).order("name"),
    supabase.from("table_sessions").select("id,waiter_id").eq("establishment_id", establishment.id),
    supabase.from("table_orders").select("id,waiter_id").eq("establishment_id", establishment.id),
    supabase.from("table_payments").select("id,waiter_id,waiter_name,payment_method,amount_cents").eq("establishment_id", establishment.id),
    supabase.from("payment_proofs").select("id,waiter_id,image_path").eq("establishment_id", establishment.id),
  ]);
  const proofLinks = new Map<string, string>();
  await Promise.all((proofs || []).map(async proof => {
    const { data } = await supabase.storage.from("payment-proofs").createSignedUrl(proof.image_path, 900);
    if (data?.signedUrl) proofLinks.set(proof.id, data.signedUrl);
  }));
  return <DashboardShell active="waiters" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head"><div><small>OPERAÇÃO DO SALÃO</small><h1>Relatório dos garçons.</h1><p>Mesas, pedidos e pagamentos registrados no nome de quem realizou o atendimento.</p></div><span className="status-pill">{waiters?.length || 0} cadastrados</span></header>
    <article className="panel team-group">
      <div className="team-report-scroll"><table className="table waiter-report"><thead><tr><th>GARÇOM</th><th>STATUS</th><th>MESAS</th><th>PEDIDOS</th><th>VENDAS</th><th>PIX</th><th>DINHEIRO</th><th>CARTÃO</th><th>COMPROVANTES</th></tr></thead>
        <tbody>{(waiters || []).map(waiter => {
          const waiterPayments = (payments || []).filter(payment => payment.waiter_id === waiter.id);
          const waiterProofs = (proofs || []).filter(proof => proof.waiter_id === waiter.id);
          return <tr key={waiter.id}><td><b>{waiter.name}</b><small>{waiter.sector || "Sem setor"}</small></td><td>{waiter.active_now && ["active", "serving"].includes(waiter.status) ? "Ativo" : "Inativo"}</td><td>{(sessions || []).filter(item => item.waiter_id === waiter.user_id).length}</td><td>{(orders || []).filter(item => item.waiter_id === waiter.user_id).length}</td><td>{money(waiterPayments.reduce((sum, item) => sum + item.amount_cents, 0))}</td><td>{money(waiterPayments.filter(item => item.payment_method === "pix").reduce((sum, item) => sum + item.amount_cents, 0))}</td><td>{money(waiterPayments.filter(item => item.payment_method === "cash").reduce((sum, item) => sum + item.amount_cents, 0))}</td><td>{money(waiterPayments.filter(item => ["credit_card", "debit_card"].includes(item.payment_method)).reduce((sum, item) => sum + item.amount_cents, 0))}</td><td>{waiterProofs.length}{waiterProofs[0] && proofLinks.get(waiterProofs[0].id) && <a className="proof-link" href={proofLinks.get(waiterProofs[0].id)} target="_blank">Abrir foto</a>}</td></tr>;
        })}</tbody></table></div>
      {!waiters?.length && <div className="empty"><b>Nenhum garçom cadastrado.</b><span>Faça o cadastro na área Equipe.</span></div>}
    </article>
  </DashboardShell>;
}
