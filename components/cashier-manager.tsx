"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Employee = { id: string; role_id: string; name: string; status: string; staff_roles: { name: string } | { name: string }[] | null };
type Movement = { id: string; staff_member_id: string; operator_name: string; movement_type: "inflow" | "outflow"; category: string; payment_method: string; amount_cents: number; description?: string | null; reference?: string | null; occurred_at: string };
type Payment = { id: string; waiter_name?: string | null; payment_method: string; amount_cents: number; table_number?: string | null; confirmed_at: string };

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const method: Record<string, string> = { pix: "Pix", cash: "Dinheiro", credit_card: "Crédito", debit_card: "Débito", transfer: "Transferência", other: "Outro" };
const parseCents = (value: string) => Math.round(Number(value.replace(/\./g, "").replace(",", ".")) * 100);

export function CashierManager({ establishmentId, userId, employees, initialMovements, tablePayments }: { establishmentId: string; userId: string; employees: Employee[]; initialMovements: Movement[]; tablePayments: Payment[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [movements, setMovements] = useState(initialMovements);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inflow = movements.filter(item => item.movement_type === "inflow").reduce((sum, item) => sum + item.amount_cents, 0) + tablePayments.reduce((sum, item) => sum + item.amount_cents, 0);
  const outflow = movements.filter(item => item.movement_type === "outflow").reduce((sum, item) => sum + item.amount_cents, 0);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const employee = employees.find(item => item.id === form.get("staff_member_id"));
    const amount = parseCents(String(form.get("amount")));
    if (!employee || !Number.isFinite(amount) || amount <= 0) { setMessage("Selecione o funcionário e informe um valor válido."); setBusy(false); return; }
    const values = { establishment_id: establishmentId, staff_member_id: employee.id, staff_role_id: employee.role_id, operator_name: employee.name, movement_type: String(form.get("movement_type")), category: String(form.get("category")), payment_method: String(form.get("payment_method")), amount_cents: amount, description: String(form.get("description") || "").trim() || null, reference: String(form.get("reference") || "").trim() || null, created_by: userId };
    const { data, error } = await supabase.from("cash_movements").insert(values).select("*").single();
    if (error) setMessage(error.message); else { setMovements(current => [data as Movement, ...current]); setMessage(`Movimentação registrada no nome de ${employee.name}.`); formElement.reset(); }
    setBusy(false);
  }

  const report = employees.map(employee => {
    const rows = movements.filter(item => item.staff_member_id === employee.id);
    const entries = rows.filter(item => item.movement_type === "inflow").reduce((sum, item) => sum + item.amount_cents, 0);
    const exits = rows.filter(item => item.movement_type === "outflow").reduce((sum, item) => sum + item.amount_cents, 0);
    return { employee, count: rows.length, entries, exits };
  });

  return <div className="cashier-stack">
    <section className="team-summary cashier-summary"><article><small>ENTRADAS</small><strong>{money(inflow)}</strong></article><article><small>SAÍDAS</small><strong>{money(outflow)}</strong></article><article><small>SALDO REGISTRADO</small><strong>{money(inflow - outflow)}</strong></article></section>
    <article className="panel"><div className="section-heading"><div><small>CONTROLE E RESPONSABILIDADE</small><h2>Registrar movimentação.</h2><p>Cada valor fica vinculado ao funcionário que operou o caixa ou o balcão.</p></div></div>
      {employees.length ? <form className="form" onSubmit={save}><div className="form-grid"><div className="field"><label>FUNCIONÁRIO RESPONSÁVEL</label><select name="staff_member_id" required defaultValue=""><option value="" disabled>Selecione</option>{employees.filter(item => item.status === "active").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="field"><label>TIPO</label><select name="movement_type"><option value="inflow">Entrada</option><option value="outflow">Saída</option></select></div><div className="field"><label>CATEGORIA</label><select name="category"><option>Venda no balcão</option><option>Recebimento de mesa</option><option>Reforço de caixa</option><option>Sangria</option><option>Despesa</option><option>Outro</option></select></div><div className="field"><label>FORMA DE PAGAMENTO</label><select name="payment_method"><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="credit_card">Crédito</option><option value="debit_card">Débito</option><option value="transfer">Transferência</option><option value="other">Outro</option></select></div><div className="field"><label>VALOR (R$)</label><input name="amount" inputMode="decimal" placeholder="0,00" required /></div><div className="field"><label>REFERÊNCIA</label><input name="reference" placeholder="Pedido, mesa ou comprovante" /></div><div className="field full"><label>DESCRIÇÃO</label><input name="description" placeholder="Informações para conferência" /></div></div><button className="button dark" disabled={busy}>{busy ? "Registrando..." : "Registrar no caixa"}</button></form> : <div className="empty"><b>Cadastre primeiro a equipe de caixa.</b><span>Na área Equipe, abra a função Caixa e cadastre os responsáveis.</span><Link className="button dark" href="/painel/equipe">Abrir Equipe</Link></div>}{message && <div className="form-message">{message}</div>}
    </article>
    <article className="panel"><div className="section-heading"><div><small>RELATÓRIO FINANCEIRO</small><h2>Resultado por funcionário.</h2><p>Entradas, saídas e saldo individual de quem trabalhou com valores.</p></div></div><div className="team-report-scroll"><table className="table"><thead><tr><th>FUNCIONÁRIO</th><th>LANÇAMENTOS</th><th>ENTRADAS</th><th>SAÍDAS</th><th>SALDO</th></tr></thead><tbody>{report.map(row => <tr key={row.employee.id}><td><b>{row.employee.name}</b><small>{Array.isArray(row.employee.staff_roles) ? row.employee.staff_roles[0]?.name : row.employee.staff_roles?.name}</small></td><td>{row.count}</td><td>{money(row.entries)}</td><td>{money(row.exits)}</td><td><b>{money(row.entries - row.exits)}</b></td></tr>)}</tbody></table></div></article>
    <article className="panel"><div className="section-heading"><div><small>CONFERÊNCIA</small><h2>Movimentações do caixa.</h2><p>Histórico com operador, forma de pagamento e referência.</p></div></div><div className="team-report-scroll"><table className="table"><thead><tr><th>DATA</th><th>RESPONSÁVEL</th><th>OPERAÇÃO</th><th>FORMA</th><th>REFERÊNCIA</th><th>VALOR</th></tr></thead><tbody>{movements.map(item => <tr key={item.id}><td>{new Date(item.occurred_at).toLocaleString("pt-BR")}</td><td><b>{item.operator_name}</b></td><td>{item.category}</td><td>{method[item.payment_method] || item.payment_method}</td><td>{item.reference || item.description || "—"}</td><td className={item.movement_type === "outflow" ? "money-out" : "money-in"}>{item.movement_type === "outflow" ? "− " : "+ "}{money(item.amount_cents)}</td></tr>)}{tablePayments.map(item => <tr key={`payment-${item.id}`}><td>{new Date(item.confirmed_at).toLocaleString("pt-BR")}</td><td><b>{item.waiter_name || "Equipe"}</b></td><td>Pagamento de mesa</td><td>{method[item.payment_method] || item.payment_method}</td><td>{item.table_number ? `Mesa ${item.table_number}` : "Atendimento"}</td><td className="money-in">+ {money(item.amount_cents)}</td></tr>)}</tbody></table></div></article>
  </div>;
}
