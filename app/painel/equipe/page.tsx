import Link from "next/link";
import { redirect } from "next/navigation";
import { AttendanceManager } from "@/components/attendance-manager";
import { DashboardShell } from "@/components/dashboard-shell";
import { TeamDeleteButton } from "@/components/team-delete-button";
import { getDashboardContext } from "@/lib/dashboard";

type TeamRow = {
  id: string;
  name: string;
  detail: string;
  payment?: string;
  active: boolean;
  kind?: "waiter" | "kitchen";
};

const paymentLabels: Record<string, string> = {
  daily: "Diária",
  weekly: "Semanal",
  biweekly: "Quinzenal",
  monthly: "Mensal",
};

const roleLabels: Record<string, string> = {
  owner: "Proprietário",
  manager: "Gerente",
  catalog_editor: "Editor de catálogo",
};

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function TeamGroup({ title, description, rows, href }: { title: string; description: string; rows: TeamRow[]; href: string }) {
  return <article className="panel team-group">
    <header className="team-group-head">
      <div><small>FUNÇÃO</small><h2>{title}</h2><p>{description}</p></div>
      <div><span className="status-pill">{rows.filter(row => row.active).length} ativos</span><Link href={href}>Administrar →</Link></div>
    </header>
    <div className="team-member-list">
      {rows.length === 0 ? <div className="empty-state">Nenhuma pessoa cadastrada nesta função.</div> : rows.map(row => <div className="team-member-row" key={row.id}>
        <div className="team-member-main"><span className={`team-status ${row.active ? "active" : "inactive"}`}>{row.active ? "ATIVO" : "INATIVO"}</span><div><strong>{row.name}</strong><p>{row.detail}</p></div></div>
        {row.payment && <div className="team-payment"><small>FORMA DE PAGAMENTO</small><b>{row.payment}</b></div>}
        {row.kind && <TeamDeleteButton id={row.id} name={row.name} kind={row.kind} />}
      </div>)}
    </div>
  </article>;
}

export default async function TeamPage() {
  const { supabase, establishment, member, userId } = await getDashboardContext();
  if (!['owner', 'manager'].includes(member.role)) redirect("/painel/garcom");

  const [{ data: members }, { data: waiters }, { data: kitchen }, { data: ownProfile }, { data: sessions }, { data: tableOrders }, { data: payments }, { data: proofs }, { data: serviceMode }] = await Promise.all([
    supabase.from("establishment_members").select("id,user_id,role,created_at").eq("establishment_id", establishment.id).order("created_at"),
    supabase.from("waiters").select("id,user_id,name,phone,status,active_now,sector,employment_type,work_date,payment_cycle,permissions,shift_start,shift_end").eq("establishment_id", establishment.id).order("name"),
    supabase.from("kitchen_operators").select("id,user_id,name,status,access_type,work_date,device_mode,payment_cycle").eq("establishment_id", establishment.id).order("name"),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    supabase.from("table_sessions").select("id,waiter_id").eq("establishment_id", establishment.id),
    supabase.from("table_orders").select("id,waiter_id").eq("establishment_id", establishment.id),
    supabase.from("table_payments").select("id,waiter_id,payment_method,amount_cents").eq("establishment_id", establishment.id),
    supabase.from("payment_proofs").select("id,waiter_id,image_path").eq("establishment_id", establishment.id),
    supabase.from("service_modes").select("*").eq("establishment_id", establishment.id).single(),
  ]);

  const proofLinks = new Map<string, string>();
  await Promise.all((proofs || []).map(async proof => {
    const { data } = await supabase.storage.from("payment-proofs").createSignedUrl(proof.image_path, 900);
    if (data?.signedUrl) proofLinks.set(proof.id, data.signedUrl);
  }));

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const waiterRows: TeamRow[] = (waiters || []).map(person => ({
    id: person.id,
    name: person.name,
    active: Boolean(person.active_now) && ["active", "serving"].includes(person.status) && (person.employment_type === "fixed" || person.work_date === today),
    detail: [person.employment_type === "daily" ? `Diarista · ${person.work_date ? new Date(`${person.work_date}T12:00:00`).toLocaleDateString("pt-BR") : "data não informada"}` : "Funcionário fixo", person.sector || "Setor não informado"].join(" · "),
    payment: paymentLabels[person.payment_cycle] || "Mensal",
    kind: "waiter",
  }));
  const kitchenRows: TeamRow[] = (kitchen || []).map(person => ({
    id: person.id,
    name: person.name,
    active: person.status === "active" && (person.access_type === "fixed" || person.work_date === today),
    detail: [person.access_type === "daily" ? `Diarista · ${person.work_date ? new Date(`${person.work_date}T12:00:00`).toLocaleDateString("pt-BR") : "data não informada"}` : "Funcionário fixo", person.device_mode === "dedicated" ? "Tela exclusiva" : "Tela compartilhada"].join(" · "),
    payment: paymentLabels[person.payment_cycle] || "Mensal",
    kind: "kitchen",
  }));
  const adminMembers = (members || []).filter(person => ["owner", "manager", "catalog_editor"].includes(person.role));
  const adminRows: TeamRow[] = adminMembers.map(person => ({
    id: person.id,
    name: person.user_id === userId && ownProfile?.full_name ? ownProfile.full_name : roleLabels[person.role] || "Membro da equipe",
    active: true,
    detail: `${roleLabels[person.role] || person.role} · Desde ${new Date(person.created_at).toLocaleDateString("pt-BR")}`,
  }));
  const allRows = [...adminRows, ...waiterRows, ...kitchenRows];
  const waiterMetrics = (waiters || []).map(waiter => ({
    waiterId: waiter.id,
    orders: (tableOrders || []).filter(order => order.waiter_id === waiter.user_id).length,
    tables: (sessions || []).filter(session => session.waiter_id === waiter.user_id).length,
    salesCents: (payments || []).filter(payment => payment.waiter_id === waiter.id).reduce((sum, payment) => sum + payment.amount_cents, 0),
    payments: (payments || []).filter(payment => payment.waiter_id === waiter.id).length,
  }));

  return <DashboardShell active="team" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head"><div><small>PESSOAS E ACESSOS</small><h1>Sua equipe.</h1><p>Funcionários separados por função, vínculo e forma de pagamento.</p></div><span className="status-pill">{allRows.filter(row => row.active).length} ativos agora</span></header>
    <section className="team-summary"><article><small>PESSOAS CADASTRADAS</small><strong>{allRows.length}</strong></article><article><small>GARÇONS ATIVOS</small><strong>{waiterRows.filter(row => row.active).length}</strong></article><article><small>COZINHA ATIVA</small><strong>{kitchenRows.filter(row => row.active).length}</strong></article></section>
    <section className="team-groups">
      <AttendanceManager establishmentId={establishment.id} slug={establishment.slug} initialMode={serviceMode as never} initialWaiters={(waiters || []) as never[]} metrics={waiterMetrics} section="team" />
      <article className="panel team-group" id="relatorio-garcons">
        <header className="team-group-head">
          <div><small>DESEMPENHO E RESPONSABILIDADE</small><h2>Relatório dos garçons</h2><p>Mesas, pedidos, vendas e pagamentos de cada integrante da equipe.</p></div>
          <span className="status-pill">{waiters?.length || 0} cadastrados</span>
        </header>
        <div className="team-report-scroll">
          <table className="table waiter-report">
            <thead><tr><th>GARÇOM</th><th>STATUS</th><th>MESAS</th><th>PEDIDOS</th><th>VENDAS</th><th>PIX</th><th>DINHEIRO</th><th>CARTÃO</th><th>COMPROVANTES</th></tr></thead>
            <tbody>{(waiters || []).map(waiter => {
              const waiterPayments = (payments || []).filter(payment => payment.waiter_id === waiter.id);
              const waiterProofs = (proofs || []).filter(proof => proof.waiter_id === waiter.id);
              return <tr key={waiter.id}>
                <td><b>{waiter.name}</b><small>{waiter.sector || "Sem setor"}</small></td>
                <td>{waiter.active_now && ["active", "serving"].includes(waiter.status) ? "Ativo" : "Inativo"}</td>
                <td>{(sessions || []).filter(session => session.waiter_id === waiter.user_id).length}</td>
                <td>{(tableOrders || []).filter(order => order.waiter_id === waiter.user_id).length}</td>
                <td>{money(waiterPayments.reduce((sum, payment) => sum + payment.amount_cents, 0))}</td>
                <td>{money(waiterPayments.filter(payment => payment.payment_method === "pix").reduce((sum, payment) => sum + payment.amount_cents, 0))}</td>
                <td>{money(waiterPayments.filter(payment => payment.payment_method === "cash").reduce((sum, payment) => sum + payment.amount_cents, 0))}</td>
                <td>{money(waiterPayments.filter(payment => ["credit_card", "debit_card"].includes(payment.payment_method)).reduce((sum, payment) => sum + payment.amount_cents, 0))}</td>
                <td>{waiterProofs.length}{waiterProofs[0] && proofLinks.get(waiterProofs[0].id) && <a className="proof-link" href={proofLinks.get(waiterProofs[0].id)} target="_blank">Abrir foto</a>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {!waiters?.length && <div className="empty"><b>Nenhum garçom cadastrado.</b><span>Cadastre a equipe no formulário acima.</span></div>}
      </article>
      <TeamGroup title="Cozinha" description="Responsáveis por aceitar, imprimir, preparar e liberar pedidos." rows={kitchenRows} href="/painel/configuracoes#equipe-cozinha" />
      <TeamGroup title="Administração" description="Proprietários, gerentes e responsáveis pelo catálogo." rows={adminRows} href="/painel/configuracoes" />
    </section>
  </DashboardShell>;
}
