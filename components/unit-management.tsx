"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Unit = { id: string; name: string; slug: string; status: string; capacity: string; open: boolean; whatsapp_connected: boolean; active_orders: number; waiting_conversations: number; sales_today_cents: number };
type Totals = { orders_today?: number; revenue_today_cents?: number; whatsapp_sales_today?: number; customers?: number };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function UnitManagement({ organizationId, units, totals, maxStores }: { organizationId: string; units: Unit[]; totals: Totals; maxStores: number | null }) {
  const supabase = createClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cloneSource, setCloneSource] = useState(units[0]?.id ?? "");
  const [cloneTarget, setCloneTarget] = useState(units[1]?.id ?? "");
  async function createUnit() {
    if (!name.trim()) return setMessage("Informe o nome da nova unidade.");
    setBusy(true);
    const { error } = await supabase.rpc("create_organization_store", { requested_organization_id: organizationId, requested_name: name.trim(), requested_slug: null });
    setBusy(false); setMessage(error?.message ?? "Unidade criada. Conclua as etapas antes de ativar a operação.");
    if (!error) { setName(""); router.refresh(); }
  }
  async function setStatus(id: string, status: string) {
    setBusy(true);
    const { error } = await supabase.rpc("set_organization_store_status", { requested_establishment_id: id, requested_status: status });
    setBusy(false); setMessage(error?.message ?? "Status da unidade atualizado.");
    if (!error) router.refresh();
  }
  async function cloneConfiguration() {
    if (!cloneSource || !cloneTarget || cloneSource === cloneTarget) return setMessage("Escolha uma unidade de origem e outra de destino.");
    if (!confirm("Copiar as configurações selecionadas para a unidade de destino? Credenciais, impressoras, contas financeiras e contatos não serão copiados.")) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("clone_store_configuration", { requested_source_store_id:cloneSource, requested_target_store_id:cloneTarget, requested_sections:["appearance","business_hours","service","delivery","catalog","ai"] });
    setBusy(false); setMessage(error?.message ?? `Configuração clonada com segurança. ${data?.sensitive_data_copied ? "Revise os dados sensíveis." : "Nenhum dado sensível foi copiado."}`);
    if (!error) router.refresh();
  }
  return <div className="unit-console">
    <section className="unit-summary-grid">
      <article><small>FATURAMENTO HOJE</small><strong>{money.format((totals.revenue_today_cents ?? 0) / 100)}</strong><span>Consolidado autorizado</span></article>
      <article><small>PEDIDOS HOJE</small><strong>{totals.orders_today ?? 0}</strong><span>Todas as unidades visíveis</span></article>
      <article><small>VENDAS WHATSAPP</small><strong>{totals.whatsapp_sales_today ?? 0}</strong><span>Origem confirmada</span></article>
      <article><small>CLIENTES DA REDE</small><strong>{totals.customers ?? 0}</strong><span>Identidade consolidada</span></article>
    </section>

    <section className="unit-create-panel">
      <div><small>NOVA UNIDADE</small><h2>Expanda a operação sem duplicar o sistema.</h2><p>O limite do plano é validado no servidor. Credenciais, tokens e dados financeiros nunca são copiados.</p></div>
      <div className="unit-create-form"><label>Nome da unidade<input value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: Unidade Copacabana" /></label><button disabled={busy || (maxStores !== null && units.length >= maxStores)} onClick={createUnit}>+ Criar unidade</button></div>
      <small>{maxStores === null ? "Plano com unidades ilimitadas" : `${units.length} de ${maxStores} unidades utilizadas`}</small>
    </section>

    {units.length > 1 && <section className="unit-clone-panel">
      <div><small>REPLICAÇÃO SEGURA</small><h2>Clonar configuração entre unidades</h2><p>Copia visual, horários, operação, entrega, cardápio e cria um rascunho da IA. Endereço, credenciais, tokens, impressoras, equipe e contas financeiras permanecem exclusivos.</p></div>
      <div className="unit-clone-form"><label>Unidade de origem<select value={cloneSource} onChange={event=>setCloneSource(event.target.value)}>{units.map(unit=><option value={unit.id} key={unit.id}>{unit.name}</option>)}</select></label><label>Unidade de destino<select value={cloneTarget} onChange={event=>setCloneTarget(event.target.value)}>{units.map(unit=><option value={unit.id} key={unit.id}>{unit.name}</option>)}</select></label><button disabled={busy||cloneSource===cloneTarget} onClick={cloneConfiguration}>Clonar configuração</button></div>
    </section>}

    {message && <p className="unit-message" role="status">{message}</p>}
    <section className="unit-grid">
      {units.map(unit => <article className="unit-card" key={unit.id}>
        <header><span className={`unit-status ${unit.status}`}>{unit.status === "active" && unit.open ? "● Aberta" : unit.status === "temporarily_closed" ? "● Fechada temporariamente" : "● Inativa"}</span><b>{unit.capacity === "high" ? "Alta demanda" : "Operação normal"}</b></header>
        <h2>{unit.name}</h2><p>/{unit.slug}</p>
        <div className="unit-card-metrics"><span><b>{unit.active_orders}</b> pedidos ativos</span><span><b>{unit.waiting_conversations}</b> conversas aguardando</span><span><b>{money.format(unit.sales_today_cents / 100)}</b> vendido hoje</span><span><b>{unit.whatsapp_connected ? "Conectado" : "Desconectado"}</b> WhatsApp</span></div>
        <footer><Link href={`/painel/configuracoes?unidade=${unit.id}`}>Configurar</Link><Link href="/onboarding">Abrir wizard</Link><Link href={`/loja/${unit.slug}`} target="_blank">Abrir loja</Link>{unit.status === "active" ? <button disabled={busy} onClick={() => setStatus(unit.id,"temporarily_closed")}>Pausar</button> : <button disabled={busy} onClick={() => setStatus(unit.id,"active")}>Ativar</button>}</footer>
      </article>)}
    </section>

    <section className="unit-onboarding"><small>MINI-ONBOARDING DE NOVA UNIDADE</small><h2>Configuração operacional</h2><p>Use o wizard progressivo ou clone uma unidade. Credenciais nunca são herdadas.</p><ol>{["Dados e endereço","Horários","Cardápio","Pagamentos","WhatsApp","Equipe","Teste","Ativar"].map((step,index) => <li key={step}><b>{index + 1}</b><span>{step}</span></li>)}</ol></section>
  </div>;
}
