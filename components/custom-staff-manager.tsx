"use client";

import { FormEvent, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type StaffMember = {
  id: string; name: string; phone?: string | null; status: "active" | "inactive";
  user_id?: string | null;
  employment_type: "fixed" | "daily"; work_date?: string | null;
  payment_cycle: "daily" | "weekly" | "biweekly" | "monthly";
  shift_start?: string | null; shift_end?: string | null; photo_url?: string | null; notes?: string | null;
};
type StaffRole = {
  id: string; name: string; description?: string | null; color: string; image_url?: string | null;
  financial_role?: boolean; system_key?: string | null;
  custom_staff_members: StaffMember[];
};

const paymentLabel: Record<string, string> = { daily: "Diária", weekly: "Semanal", biweekly: "Quinzenal", monthly: "Mensal" };
const localDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export function CustomStaffManager({ establishmentId, initialRoles }: { establishmentId: string; initialRoles: StaffRole[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [roles, setRoles] = useState(initialRoles);
  const [roleFormOpen, setRoleFormOpen] = useState(false);
  const [memberRoleId, setMemberRoleId] = useState<string | null>(null);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [employmentType, setEmploymentType] = useState<"fixed" | "daily">("fixed");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cashierInvite, setCashierInvite] = useState<{ memberId: string; name: string; phone: string; link: string } | null>(null);

  async function createCashierInvite(member: StaffMember) {
    setMessage("");
    const { data, error } = await supabase.rpc("create_cashier_invite", { requested_member_id: member.id });
    if (error) return setMessage(error.message);
    setCashierInvite({ memberId: member.id, name: member.name, phone: String(data.phone || member.phone || ""), link: `${window.location.origin}/convite-caixa/${data.token}` });
  }

  async function upload(file: File | null, kind: string) {
    if (!file?.size) return null;
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) throw new Error("Use uma imagem JPG, PNG ou WebP de até 8 MB.");
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${establishmentId}/team/${kind}-${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file, { contentType: file.type, cacheControl: "3600" });
    if (error) throw error;
    return supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
  }

  async function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const imageUrl = await upload(form.get("image") as File, "role");
      const values = { establishment_id: establishmentId, name: String(form.get("name")).trim(), description: String(form.get("description") || "").trim() || null, color: String(form.get("color") || "#7b2326"), financial_role: form.get("financial_role") === "on", ...(imageUrl ? { image_url: imageUrl } : {}) };
      const query = editingRoleId ? supabase.from("staff_roles").update(values).eq("id", editingRoleId) : supabase.from("staff_roles").insert(values);
      const { data, error } = await query.select("id,name,description,color,image_url,financial_role,system_key").single();
      if (error) throw error;
      const saved = { ...data, custom_staff_members: editingRoleId ? roles.find(role => role.id === editingRoleId)?.custom_staff_members || [] : [] } as StaffRole;
      setRoles(current => editingRoleId ? current.map(role => role.id === saved.id ? saved : role) : [...current, saved]);
      setEditingRoleId(null); setRoleFormOpen(false); setMessage("Função salva e personalizada.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível salvar a função."); }
    setBusy(false);
  }

  async function saveMember(event: FormEvent<HTMLFormElement>, role: StaffRole) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const photoUrl = await upload(form.get("photo") as File, "employee");
      const values = { establishment_id: establishmentId, role_id: role.id, name: String(form.get("name")).trim(), phone: String(form.get("phone") || "").trim() || null, status: String(form.get("status") || "active"), employment_type: employmentType, work_date: employmentType === "daily" ? String(form.get("work_date")) : null, payment_cycle: String(form.get("payment_cycle") || (employmentType === "daily" ? "daily" : "monthly")), shift_start: String(form.get("shift_start") || "") || null, shift_end: String(form.get("shift_end") || "") || null, photo_url: photoUrl, notes: String(form.get("notes") || "").trim() || null };
      const { data, error } = await supabase.from("custom_staff_members").insert(values).select("*").single();
      if (error) throw error;
      setRoles(current => current.map(item => item.id === role.id ? { ...item, custom_staff_members: [...item.custom_staff_members, data as StaffMember] } : item));
      setMemberRoleId(null); setEmploymentType("fixed"); setMessage(`${data.name} foi cadastrado em ${role.name}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível cadastrar o funcionário."); }
    setBusy(false);
  }

  async function removeMember(roleId: string, member: StaffMember) {
    if (!window.confirm(`Excluir ${member.name} desta função?`)) return;
    const { error } = await supabase.from("custom_staff_members").delete().eq("id", member.id);
    if (error) return setMessage(error.message);
    setRoles(current => current.map(role => role.id === roleId ? { ...role, custom_staff_members: role.custom_staff_members.filter(item => item.id !== member.id) } : role));
    setMessage(`${member.name} foi excluído da equipe.`);
  }

  async function removeRole(role: StaffRole) {
    if (!window.confirm(`Excluir a função ${role.name} e todos os cadastros dela?`)) return;
    const { error } = await supabase.from("staff_roles").delete().eq("id", role.id);
    if (error) return setMessage(error.message);
    setRoles(current => current.filter(item => item.id !== role.id));
    setMessage(`A função ${role.name} foi excluída.`);
  }

  return <section className="custom-staff-area">
    <article className="panel custom-role-creator">
      <div className="section-heading"><div><small>PERSONALIZAÇÃO DA EQUIPE</small><h2>Tipos de funcionários</h2><p>Crie funções específicas do estabelecimento e escolha cor e imagem para identificar cada equipe.</p></div><button type="button" className="button dark" onClick={() => { setEditingRoleId(null); setRoleFormOpen(value => !value); }}>{roleFormOpen ? "Fechar" : "+ Criar tipo de funcionário"}</button></div>
      {roleFormOpen && <form className="form custom-role-form" onSubmit={saveRole} key={editingRoleId || "new-role"}>
        <div className="form-grid"><div className="field"><label>NOME DA FUNÇÃO</label><input name="name" required minLength={2} defaultValue={roles.find(role => role.id === editingRoleId)?.name || ""} placeholder="Ex.: Caixa, entregador, limpeza" /></div><div className="field"><label>COR DE IDENTIFICAÇÃO</label><input name="color" type="color" defaultValue={roles.find(role => role.id === editingRoleId)?.color || "#7b2326"} /></div><div className="field"><label>FOTO OU CAPA DA FUNÇÃO</label><input name="image" type="file" accept="image/*" /></div><div className="field"><label>DESCRIÇÃO</label><input name="description" defaultValue={roles.find(role => role.id === editingRoleId)?.description || ""} placeholder="Ex.: Responsável pelo caixa e fechamento" /></div><label className="check-row full"><input name="financial_role" type="checkbox" defaultChecked={roles.find(role => role.id === editingRoleId)?.financial_role || false} /><span><b>Função financeira</b><small>Ative para caixa, balcão ou outro funcionário que registre valores.</small></span></label></div>
        <button className="button dark" disabled={busy}>{busy ? "Salvando..." : "Salvar função personalizada"}</button>
      </form>}
    </article>

    {roles.map(role => <article className="panel custom-role-card" key={role.id} style={{ borderTopColor: role.color }}>
      <header className={`custom-role-header ${role.image_url ? "has-image" : ""}`} style={role.image_url ? { backgroundImage: `linear-gradient(90deg, rgba(20,20,16,.92), rgba(20,20,16,.55)), url(${role.image_url})` } : { backgroundColor: `${role.color}18` }}>
        <div><small>{role.financial_role ? "FUNÇÃO FINANCEIRA" : "FUNÇÃO PERSONALIZADA"}</small><h2>{role.name}</h2><p>{role.description || "Equipe personalizada pelo estabelecimento."}</p></div>
        <div className="team-heading-actions"><span className="status-pill">{role.custom_staff_members.filter(member => member.status === "active").length} ativos</span><button type="button" className="button dark" onClick={() => setMemberRoleId(current => current === role.id ? null : role.id)}>{memberRoleId === role.id ? "Fechar cadastro" : "Realizar cadastro de funcionário"}</button><button type="button" className="button outline" onClick={() => { setEditingRoleId(role.id); setRoleFormOpen(true); }}>Personalizar</button>{!role.system_key && <button type="button" className="danger-action" onClick={() => void removeRole(role)}>Excluir função</button>}</div>
      </header>
      {memberRoleId === role.id && <form className="form custom-member-form" onSubmit={event => saveMember(event, role)}>
        <div className="form-grid"><div className="field"><label>NOME E SOBRENOME</label><input name="name" required minLength={2} /></div><div className="field"><label>TELEFONE</label><input name="phone" type="tel" /></div><div className="field"><label>FOTO DO FUNCIONÁRIO</label><input name="photo" type="file" accept="image/*" /></div><div className="field"><label>STATUS</label><select name="status"><option value="active">Ativo</option><option value="inactive">Inativo</option></select></div><div className="field"><label>TIPO DE CONTRATAÇÃO</label><select value={employmentType} onChange={event => setEmploymentType(event.target.value as "fixed" | "daily")}><option value="fixed">Funcionário fixo</option><option value="daily">Diarista</option></select></div><div className="field"><label>FORMA DE PAGAMENTO</label><select name="payment_cycle" defaultValue={employmentType === "daily" ? "daily" : "monthly"} key={employmentType}><option value="daily">Diária</option><option value="weekly">Semanal</option><option value="biweekly">Quinzenal</option><option value="monthly">Mensal</option></select></div>{employmentType === "daily" && <div className="field"><label>DATA DE TRABALHO</label><input name="work_date" type="date" required min={localDate()} defaultValue={localDate()} /></div>}<div className="field"><label>TURNO</label><div className="shift-fields"><input name="shift_start" type="time" /><input name="shift_end" type="time" /></div></div><div className="field full"><label>OBSERVAÇÕES</label><input name="notes" placeholder="Responsabilidades ou informações importantes" /></div></div>
        <button className="button dark" disabled={busy}>{busy ? "Salvando..." : "Cadastrar funcionário"}</button>
      </form>}
      <div className="custom-member-list">{role.custom_staff_members.length ? role.custom_staff_members.map(member => <div key={member.id} className="custom-member-row">{member.photo_url ? <img src={member.photo_url} alt="" /> : <span className="custom-member-avatar" style={{ backgroundColor: role.color }}>{member.name.slice(0,2).toUpperCase()}</span>}<div><span className={`team-status ${member.status === "active" ? "active" : "inactive"}`}>{member.status === "active" ? "ATIVO" : "INATIVO"}</span><h3>{member.name}</h3><p>{member.employment_type === "daily" ? `Diarista em ${member.work_date ? new Date(`${member.work_date}T12:00:00`).toLocaleDateString("pt-BR") : "data não informada"}` : "Funcionário fixo"} · Pagamento {paymentLabel[member.payment_cycle]}{role.financial_role ? ` · ${member.user_id ? "Acesso vinculado" : "Aguardando senha"}` : ""}</p>{member.notes && <small>{member.notes}</small>}</div><div className="team-heading-actions">{role.financial_role && <button type="button" className="button outline" onClick={() => void createCashierInvite(member)}>{member.user_id ? "Redefinir senha" : "Gerar acesso"}</button>}<button type="button" className="danger-action" onClick={() => void removeMember(role.id, member)}>Excluir</button></div></div>) : <div className="empty-state">Nenhum funcionário cadastrado nesta função.</div>}</div>
      {cashierInvite && role.custom_staff_members.some(member => member.id === cashierInvite.memberId) && <div className="invite-box"><div><small>ACESSO INDIVIDUAL DO CAIXA</small><h3>Enviar acesso de {cashierInvite.name}</h3><p>O funcionário cria a senha uma vez e depois entra somente com nome e senha.</p></div><input readOnly value={cashierInvite.link} /><div className="team-heading-actions"><button className="button outline" type="button" onClick={() => navigator.clipboard.writeText(cashierInvite.link)}>Copiar link</button><a className="button whatsapp" target="_blank" href={`https://wa.me/${cashierInvite.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá, ${cashierInvite.name}. Crie sua senha para acessar o caixa: ${cashierInvite.link}`)}`}>Enviar pelo WhatsApp</a></div></div>}
    </article>)}
    {message && <div className="form-message form-success sticky-message">{message}</div>}
  </section>;
}
