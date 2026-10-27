"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
type Receipt = { id: string; order_number: number; total_cents: number; online_payment_status: string; paid_at: string | null; payment_method: string };
export function OnlinePaymentReport({ establishmentId }: { establishmentId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Receipt[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  useEffect(() => {
    let active = true;
    async function load() {
      const result = await supabase.from("orders").select("id,order_number,total_cents,online_payment_status,paid_at,payment_method")
        .eq("establishment_id", establishmentId).in("payment_method", ["mercado_pago_online", "pagarme_online"])
        .order("created_at", { ascending: false }).range(page * 20, page * 20 + 19);
      if (!active) return;
      setLoading(false); setError(result.error ? "Não foi possível atualizar os pagamentos. Tentaremos novamente." : "");
      if (!result.error) setRows(result.data || []);
    }
    void load(); const timer = window.setInterval(load, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [establishmentId, page, supabase]);
  const labels: Record<string, string> = { approved: "Pago", pending: "Aguardando Pix/pagamento", refunded: "Estornado", declined: "Recusado", canceled: "Cancelado" };
  return <section className="panel"><div className="section-heading"><div><small>BAIXA AUTOMÁTICA</small><h2>Pagamentos online</h2><p>Recebidos pelo provedor, sem nova cobrança no caixa. Não entram na gaveta de dinheiro nem são atribuídos a um funcionário.</p></div></div>
    <p>Confirmados nesta página: <strong>{money(rows.filter(r => r.online_payment_status === "approved").reduce((sum, r) => sum + r.total_cents, 0))}</strong></p>
    {loading && <p>Carregando pagamentos...</p>}{error && <p role="alert">{error}</p>}
    {!loading && !rows.length && <p>Nenhum pedido online nesta página.</p>}
    <div style={{ overflowX: "auto" }}><table><thead><tr><th>Pedido</th><th>Provedor</th><th>Valor</th><th>Situação</th><th>Confirmado em</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td>#{r.order_number}</td><td>{r.payment_method === "mercado_pago_online" ? "Mercado Pago" : "Pagar.me"}</td><td>{money(r.total_cents)}</td><td>{labels[r.online_payment_status] || r.online_payment_status}</td><td>{r.paid_at ? new Date(r.paid_at).toLocaleString("pt-BR") : "—"}</td></tr>)}</tbody></table></div>
    <div className="form-grid"><button className="button outline" disabled={!page} onClick={() => setPage(p => p - 1)}>Anterior</button><button className="button outline" disabled={rows.length < 20} onClick={() => setPage(p => p + 1)}>Próxima</button></div>
    <TablePixReport establishmentId={establishmentId} />
  </section>;
}

type TableCharge = { id: string; table_session_id: string; waiter_name: string | null; amount_cents: number; status: string; external_id: string | null; approved_at: string | null };
function TablePixReport({ establishmentId }: { establishmentId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<TableCharge[]>([]);
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState("Carregando cobranças das mesas...");
  useEffect(() => {
    let active = true, running = false;
    async function load() {
      if (document.hidden || running) return;
      running = true;
      try {
        const { data, error } = await supabase.from("order_payment_transactions")
          .select("id,table_session_id,waiter_name,amount_cents,status,external_id,approved_at")
          .eq("establishment_id", establishmentId).not("table_session_id", "is", null)
          .order("created_at", { ascending: false }).range(page * 20, page * 20 + 19);
        if (!active) return;
        setMessage(error ? "Não foi possível atualizar. Tentaremos novamente." : "");
        if (!error) setRows(data || []);
      } finally { running = false; }
    }
    void load(); const timer = window.setInterval(load, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [supabase, establishmentId, page]);
  const labels: Record<string,string> = { pending: "Aguardando pagamento", approved: "Pago automaticamente", canceled: "Cancelado", declined: "Recusado", refunded: "Estornado", error: "Em conferência" };
  return <div><h3>Pix automático das mesas</h3><p>As aprovações já entram nos recebimentos de mesa abaixo. Não registre outra entrada manual. Estornos deixam de compor o total recebido.</p>
    {message && <p role="status">{message}</p>}
    {!message && !rows.length && <p>Nenhuma cobrança nesta página.</p>}
    <div style={{ overflowX: "auto" }}><table><thead><tr><th>Conta</th><th>Responsável</th><th>Valor</th><th>Situação</th><th>Transação Mercado Pago</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.table_session_id.slice(0,8)}</td><td>{row.waiter_name || "Equipe"}</td><td>{(row.amount_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td><td>{labels[row.status] || row.status}</td><td>{row.external_id || "Em preparação"}</td></tr>)}</tbody></table></div>
    <div className="form-grid"><button className="button outline" disabled={!page} onClick={() => setPage(p => p - 1)}>Anterior</button><button className="button outline" disabled={rows.length < 20} onClick={() => setPage(p => p + 1)}>Próxima</button></div>
  </div>;
}
