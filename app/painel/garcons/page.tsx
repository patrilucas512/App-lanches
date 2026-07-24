import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardContext } from "@/lib/dashboard";

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export default async function WaiterReportPage() {
  const { supabase, establishment, member } = await getDashboardContext();
  if (!["owner", "manager"].includes(member.role)) redirect("/painel/garcom");
  const [{ data: waiters }, { data: sessions }, { data: orders }, { data: payments }, { data: proofs }] = await Promise.all([
    supabase.from("waiters").select("*").eq("establishment_id", establishment.id).order("name"),
    supabase.from("table_sessions").select("id,waiter_id,total_cents,opened_at,closed_at").eq("establishment_id", establishment.id),
    supabase.from("table_orders").select("id,waiter_id").eq("establishment_id", establishment.id),
    supabase.from("table_payments").select("id,waiter_id,payment_method,amount_cents,confirmed_at,table_number").eq("establishment_id", establishment.id),
    supabase.from("payment_proofs").select("id,waiter_id,image_path,created_at").eq("establishment_id", establishment.id),
  ]);
  const proofLinks = new Map<string, string>();
  await Promise.all((proofs || []).map(async proof => {
    const { data } = await supabase.storage.from("payment-proofs").createSignedUrl(proof.image_path, 900);
    if (data?.signedUrl) proofLinks.set(proof.id, data.signedUrl);
  }));
  return <DashboardShell active="waiters" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head"><div><small>DESEMPENHO E RESPONSABILIDADE</small><h1>Relatório por garçom.</h1></div></header><section className="panel"><table className="table waiter-report"><thead><tr><th>GARÇOM</th><th>STATUS</th><th>MESAS</th><th>PEDIDOS</th><th>VENDAS</th><th>PIX</th><th>DINHEIRO</th><th>CARTÃO</th><th>COMPROVANTES</th></tr></thead><tbody>{(waiters || []).map(waiter => {
    const waiterPayments = (payments || []).filter(payment => payment.waiter_id === waiter.id);
    const waiterProofs = (proofs || []).filter(proof => proof.waiter_id === waiter.id);
    return <tr key={waiter.id}><td><b>{waiter.name}</b><small>{waiter.sector || "Sem setor"}</small></td><td>{waiter.status}</td><td>{(sessions || []).filter(session => session.waiter_id === waiter.user_id).length}</td><td>{(orders || []).filter(order => order.waiter_id === waiter.user_id).length}</td><td>{money(waiterPayments.reduce((sum, payment) => sum + payment.amount_cents, 0))}</td><td>{money(waiterPayments.filter(payment => payment.payment_method === "pix").reduce((sum,payment) => sum + payment.amount_cents, 0))}</td><td>{money(waiterPayments.filter(payment => payment.payment_method === "cash").reduce((sum,payment) => sum + payment.amount_cents, 0))}</td><td>{money(waiterPayments.filter(payment => ["credit_card","debit_card"].includes(payment.payment_method)).reduce((sum,payment) => sum + payment.amount_cents, 0))}</td><td>{waiterProofs.length}{waiterProofs[0] && proofLinks.get(waiterProofs[0].id) && <a className="proof-link" href={proofLinks.get(waiterProofs[0].id)} target="_blank">Abrir foto</a>}</td></tr>;
  })}</tbody></table>{!waiters?.length && <div className="empty"><b>Nenhum garçom cadastrado.</b><span>Cadastre a equipe em Modo de atendimento.</span></div>}</section></DashboardShell>;
}
