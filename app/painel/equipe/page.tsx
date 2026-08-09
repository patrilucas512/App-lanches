import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardContext } from "@/lib/dashboard";

type TeamRow = {
  id: string;
  name: string;
  detail: string;
  payment?: string;
  active: boolean;
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
      </div>)}
    </div>
  </article>;
}

export default async function TeamPage() {
  const { supabase, establishment, member, userId } = await getDashboardContext();
  if (!['owner', 'manager'].includes(member.role)) redirect("/painel/garcom");

  const [{ data: members }, { data: waiters }, { data: kitchen }, { data: ownProfile }] = await Promise.all([
    supabase.from("establishment_members").select("id,user_id,role,created_at").eq("establishment_id", establishment.id).order("created_at"),
    supabase.from("waiters").select("id,user_id,name,status,active_now,sector,employment_type,work_date,payment_cycle").eq("establishment_id", establishment.id).order("name"),
    supabase.from("kitchen_operators").select("id,user_id,name,status,access_type,work_date,device_mode,payment_cycle").eq("establishment_id", establishment.id).order("name"),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const waiterRows: TeamRow[] = (waiters || []).map(person => ({
    id: person.id,
    name: person.name,
    active: Boolean(person.active_now) && ["active", "serving"].includes(person.status) && (person.employment_type === "fixed" || person.work_date === today),
    detail: [person.employment_type === "daily" ? `Diarista · ${person.work_date ? new Date(`${person.work_date}T12:00:00`).toLocaleDateString("pt-BR") : "data não informada"}` : "Funcionário fixo", person.sector || "Setor não informado"].join(" · "),
    payment: paymentLabels[person.payment_cycle] || "Mensal",
  }));
  const kitchenRows: TeamRow[] = (kitchen || []).map(person => ({
    id: person.id,
    name: person.name,
    active: person.status === "active" && (person.access_type === "fixed" || person.work_date === today),
    detail: [person.access_type === "daily" ? `Diarista · ${person.work_date ? new Date(`${person.work_date}T12:00:00`).toLocaleDateString("pt-BR") : "data não informada"}` : "Funcionário fixo", person.device_mode === "dedicated" ? "Tela exclusiva" : "Tela compartilhada"].join(" · "),
    payment: paymentLabels[person.payment_cycle] || "Mensal",
  }));
  const adminMembers = (members || []).filter(person => ["owner", "manager", "catalog_editor"].includes(person.role));
  const adminRows: TeamRow[] = adminMembers.map(person => ({
    id: person.id,
    name: person.user_id === userId && ownProfile?.full_name ? ownProfile.full_name : roleLabels[person.role] || "Membro da equipe",
    active: true,
    detail: `${roleLabels[person.role] || person.role} · Desde ${new Date(person.created_at).toLocaleDateString("pt-BR")}`,
  }));
  const allRows = [...adminRows, ...waiterRows, ...kitchenRows];

  return <DashboardShell active="team" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head"><div><small>PESSOAS E ACESSOS</small><h1>Sua equipe.</h1><p>Funcionários separados por função, vínculo e forma de pagamento.</p></div><span className="status-pill">{allRows.filter(row => row.active).length} ativos agora</span></header>
    <section className="team-summary"><article><small>PESSOAS CADASTRADAS</small><strong>{allRows.length}</strong></article><article><small>GARÇONS ATIVOS</small><strong>{waiterRows.filter(row => row.active).length}</strong></article><article><small>COZINHA ATIVA</small><strong>{kitchenRows.filter(row => row.active).length}</strong></article></section>
    <section className="team-groups">
      <TeamGroup title="Garçons" description="Equipe que abre mesas, lança pedidos e fecha contas." rows={waiterRows} href="/painel/atendimento#equipe-garcons" />
      <TeamGroup title="Cozinha" description="Responsáveis por aceitar, imprimir, preparar e liberar pedidos." rows={kitchenRows} href="/painel/configuracoes#equipe-cozinha" />
      <TeamGroup title="Administração" description="Proprietários, gerentes e responsáveis pelo catálogo." rows={adminRows} href="/painel/configuracoes" />
    </section>
  </DashboardShell>;
}
