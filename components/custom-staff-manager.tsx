"use client";

import { FormEvent, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { StaffSectionControls } from "@/components/staff-section-controls";
import { StaffAccessActions } from "@/components/staff-access-actions";

type StaffMember = {
  id: string; name: string; phone?: string | null; status: "active" | "inactive";
  user_id?: string | null;
  employment_type: "fixed" | "daily"; work_date?: string | null;
  payment_cycle: "daily" | "weekly" | "biweekly" | "monthly";
  shift_start?: string | null; shift_end?: string | null; photo_url?: string | null; notes?: string | null;
  driver_profiles?: { driver_kind: "fixed" | "partner"; id: string; vehicle_type: string; vehicle_model?: string | null; vehicle_plate?: string | null; approval_status: string; active: boolean }[];
};
type StaffRole = {
  id: string; name: string; description?: string | null; color: string; image_url?: string | null;
  financial_role?: boolean; system_key?: string | null;
  custom_staff_members: StaffMember[];
};

const paymentLabel: Record<string, string> = { daily: "Diária", weekly: "Semanal", biweekly: "Quinzenal", monthly: "Mensal" };
const localDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const isActiveToday = (member: StaffMember) =>
  member.status === "active" &&
  (member.employment_type === "fixed" || member.work_date === localDate());

export function CustomStaffManager({ establishmentId, initialRoles }: { establishmentId: string; initialRoles: StaffRole[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [roles, setRoles] = useState(initialRoles);
  const [roleFormOpen, setRoleFormOpen] = useState(false);
  const [memberRoleId, setMemberRoleId] = useState<string | null>(null);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [employmentType, setEmploymentType] = useState<"fixed" | "daily">("fixed");
  const [driverPayoutModel, setDriverPayoutModel] = useState("per_delivery");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cashierInvite, setCashierInvite] = useState<{ memberId: string; name: string; phone: string; link: string } | null>(null);
  const [driverInvite, setDriverInvite] = useState<{ memberId: string; name: string; phone: string; link: string } | null>(null);

  async function createCashierInvite(member: StaffMember) {
    setMessage("");
    const { data, error } = await supabase.rpc("create_cashier_invite", { requested_member_id: member.id });
    if (error) return setMessage(error.message);
    setCashierInvite({ memberId: member.id, name: member.name, phone: String(data.phone || member.phone || ""), link: `${window.location.origin}/convite-caixa/${data.token}` });
  }

  async function createDriverInvite(member: StaffMember) {
    setMessage("");
    const { data, error } = await supabase.rpc("create_driver_invite", { requested_member_id: member.id });
    if (error) return setMessage(error.message);
    setDriverInvite({ memberId: member.id, name: member.name, phone: String(data.phone || member.phone || ""), link: `${window.location.origin}/convite-motoboy/${data.token}` });
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
      let savedMember = data as StaffMember;
      if (role.system_key === "driver") {
        const { data: driver, error: driverError } = await supabase.from("driver_profiles").update({
          driver_kind: String(form.get("driver_kind") || "partner"),
          vehicle_type: String(form.get("vehicle_type") || "motorcycle"),
          vehicle_model: String(form.get("vehicle_model") || "").trim() || null,
          vehicle_plate: String(form.get("vehicle_plate") || "").trim().toUpperCase() || null,
        }).eq("custom_staff_member_id", data.id).select("id,driver_kind,vehicle_type,vehicle_model,vehicle_plate,approval_status,active").single();
        if (driverError) throw driverError;
        const toCents = (name: string) => Math.round(Number(String(form.get(name) || "0").replace(",", ".")) * 100) || 0;
        const { error: policyError } = await supabase.rpc("save_driver_compensation_policy", {
          requested_driver_profile_id: driver.id,
          requested_payout_model: driverPayoutModel,
          requested_per_delivery_cents: toCents("driver_per_delivery"),
          requested_daily_rate_cents: toCents("driver_daily_rate"),
          requested_monthly_salary_cents: toCents("driver_salary"),
          requested_commission_basis_points: Math.round(Number(form.get("driver_commission") || 0) * 100),
          requested_distance_rates: [],
          requested_effective_from: localDate(),
        });
        if (policyError) throw policyError;
        savedMember = { ...savedMember, driver_profiles: [driver] };
      }
      setRoles(current => current.map(item => item.id === role.id ? { ...item, custom_staff_members: [...item.custom_staff_members, savedMember] } : item));
      setMemberRoleId(null); setEmploymentType("fixed"); setDriverPayoutModel("per_delivery"); setMessage(`${data.name} foi cadastrado em ${role.name}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível cadastrar o funcionário."); }
    setBusy(false);
  }

  async function removeMember(role: StaffRole, member: StaffMember) {
    if (role.system_key === "driver") {
      if (!window.confirm(`Desativar ${member.name}? O acesso será bloqueado, mas todo o histórico financeiro será preservado.`)) return;
      const { error } = await supabase.rpc("deactivate_driver_staff_member", { requested_member_id: member.id });
      if (error) return setMessage(error.message);
      setRoles(current => current.map(item => item.id === role.id ? {
        ...item,
        custom_staff_members: item.custom_staff_members.map(currentMember => currentMember.id === member.id ? { ...currentMember, status: "inactive" } : currentMember),
      } : item));
      setMessage(`${member.name} foi desativado. Entregas e registros financeiros continuam preservados.`);
      return;
    }
    if (!window.confirm(`Excluir ${member.name} desta função?`)) return;
    const { error } = role.financial_role
      ? await supabase.rpc("archive_cashier_staff_member", { requested_member_id: member.id })
      : await supabase.from("custom_staff_members").delete().eq("id", member.id);
    if (error) return setMessage(error.message);
    setRoles(current => current.map(item => item.id === role.id ? { ...item, custom_staff_members: item.custom_staff_members.filter(currentMember => currentMember.id !== member.id) } : item));
    setMessage(role.financial_role
      ? `${member.name} foi removido do caixa. O acesso foi encerrado e o histórico financeiro foi preservado.`
      : `${member.name} foi excluído da equipe.`);
  }

  async function saveMemberEdit(event: FormEvent<HTMLFormElement>, role: StaffRole, member: StaffMember) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const values = {
      name: String(form.get("name") || "").trim(),
      phone: String(form.get("phone") || "").trim() || null,
      employment_type: String(form.get("employment_type") || member.employment_type),
      work_date: String(form.get("employment_type")) === "daily" ? String(form.get("work_date") || "") || null : null,
      payment_cycle: String(form.get("payment_cycle") || member.payment_cycle),
      shift_start: String(form.get("shift_start") || "") || null,
      shift_end: String(form.get("shift_end") || "") || null,
      notes: String(form.get("notes") || "").trim() || null,
    };
    const { data, error } = await supabase.from("custom_staff_members").update(values).eq("id", member.id).eq("establishment_id", establishmentId).select("*").single();
    if (error) setMessage(error.message);
    else {
      setRoles(current => current.map(item => item.id === role.id ? { ...item, custom_staff_members: item.custom_staff_members.map(row => row.id === member.id ? { ...row, ...data } as StaffMember : row) } : item));
      setEditingMemberId(null);
      setMessage(`${data.name} foi atualizado.`);
    }
    setBusy(false);
  }

  async function toggleMemberStatus(role: StaffRole, member: StaffMember) {
    setBusy(true); setMessage("");
    const status = member.status === "active" ? "inactive" : "active";
    const { error } = await supabase.from("custom_staff_members").update({ status }).eq("id", member.id).eq("establishment_id", establishmentId);
    if (error) setMessage(error.message);
    else {
      setRoles(current => current.map(item => item.id === role.id ? { ...item, custom_staff_members: item.custom_staff_members.map(row => row.id === member.id ? { ...row, status } : row) } : item));
      setMessage(status === "active" ? `${member.name} foi reativado.` : `${member.name} foi bloqueado.`);
    }
    setBusy(false);
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

    {roles.map(role => <article className={`panel custom-role-card ${role.financial_role ? "cashier-role-card" : ""}`} key={role.id} style={{ borderTopColor: role.color }}>
      <header className={`custom-role-header ${role.image_url ? "has-image" : ""}`} style={role.image_url ? { backgroundImage: `linear-gradient(90deg, rgba(20,20,16,.92), rgba(20,20,16,.55)), url(${role.image_url})` } : { backgroundColor: role.financial_role ? "var(--op-surface, #080806)" : `${role.color}18` }}>
        <div><small>{role.financial_role ? "ACESSO SEPARADO" : "FUNÇÃO PERSONALIZADA"}</small><h2>{role.financial_role ? "Equipe do caixa" : role.name}</h2><p>{role.financial_role ? "O operador recebe o acesso e entra somente com nome e senha." : role.description || "Equipe personalizada pelo estabelecimento."}</p></div>
        <div className="staff-header-actions"><StaffSectionControls activeCount={role.custom_staff_members.filter(isActiveToday).length} totalCount={role.custom_staff_members.length} open={memberRoleId === role.id} label={role.financial_role ? "operador" : role.system_key === "driver" ? "motoboy" : role.name.toLocaleLowerCase("pt-BR")} onToggle={() => { setEmploymentType("fixed"); setMemberRoleId(current => current === role.id ? null : role.id); }} /><div className="team-heading-actions">{role.financial_role ? <a className="button outline" href="/caixa">Abrir caixa</a> : <button type="button" className="button outline" onClick={() => { setEditingRoleId(role.id); setRoleFormOpen(true); }}>Personalizar</button>}{!role.system_key && <button type="button" className="danger-action" onClick={() => void removeRole(role)}>Excluir função</button>}</div></div>
      </header>
      {memberRoleId === role.id && <form className="form custom-member-form" onSubmit={event => saveMember(event, role)}>
        <div className="form-grid">
          <div className="field"><label>NOME E SOBRENOME</label><input name="name" required minLength={2} /></div><div className="field"><label>TELEFONE / WHATSAPP</label><input name="phone" type="tel" required={role.system_key === "driver"} /></div><div className="field"><label>FOTO DO FUNCIONÁRIO</label><input name="photo" type="file" accept="image/*" /></div><div className="field"><label>STATUS</label><select name="status"><option value="active">Ativo</option><option value="inactive">Inativo</option></select></div><div className="field"><label>TIPO DE CONTRATAÇÃO</label><select value={employmentType} onChange={event => setEmploymentType(event.target.value as "fixed" | "daily")}><option value="fixed">Funcionário fixo</option><option value="daily">Diarista</option></select></div><div className="field"><label>FORMA DE PAGAMENTO</label><select name="payment_cycle" defaultValue={employmentType === "daily" ? "daily" : "monthly"} key={employmentType}><option value="daily">Diária</option><option value="weekly">Semanal</option><option value="biweekly">Quinzenal</option><option value="monthly">Mensal</option></select></div>{employmentType === "daily" && <div className="field"><label>DATA DE TRABALHO</label><input name="work_date" type="date" required min={localDate()} defaultValue={localDate()} /></div>}<div className="field"><label>TURNO</label><div className="shift-fields"><input name="shift_start" type="time" /><input name="shift_end" type="time" /></div></div>
          {role.system_key === "driver" && <><div className="field"><label>VÍNCULO DO MOTOBOY</label><select name="driver_kind" defaultValue="partner"><option value="fixed">Motoboy fixo · retirada sem código</option><option value="partner">Motoboy parceiro · código de retirada</option></select></div><div className="field"><label>VEÍCULO</label><select name="vehicle_type"><option value="motorcycle">Moto</option><option value="bicycle">Bicicleta</option><option value="car">Carro</option><option value="other">Outro</option></select></div><div className="field"><label>MODELO DO VEÍCULO</label><input name="vehicle_model" placeholder="Ex.: Honda CG 160" /></div><div className="field"><label>PLACA (OPCIONAL)</label><input name="vehicle_plate" maxLength={8} placeholder="ABC1D23" /></div><div className="field"><label>TIPO DE CONTRATO / REPASSE</label><select value={driverPayoutModel} onChange={event => setDriverPayoutModel(event.target.value)}><option value="per_delivery">Por entrega</option><option value="daily">Diária</option><option value="daily_plus_delivery">Diária + entrega</option><option value="salary">Salário</option><option value="salary_plus_commission">Salário + comissão</option><option value="custom">Personalizado</option></select></div>{["per_delivery","daily_plus_delivery"].includes(driverPayoutModel) && <div className="field"><label>VALOR POR ENTREGA (R$)</label><input name="driver_per_delivery" inputMode="decimal" placeholder="0,00" /></div>}{["daily","daily_plus_delivery"].includes(driverPayoutModel) && <div className="field"><label>VALOR DA DIÁRIA (R$)</label><input name="driver_daily_rate" inputMode="decimal" placeholder="0,00" /></div>}{["salary","salary_plus_commission"].includes(driverPayoutModel) && <div className="field"><label>SALÁRIO MENSAL (R$)</label><input name="driver_salary" inputMode="decimal" placeholder="0,00" /></div>}{driverPayoutModel === "salary_plus_commission" && <div className="field"><label>COMISSÃO (%)</label><input name="driver_commission" type="number" min="0" max="100" step="0.01" /></div>}</>}
          <div className="field full"><label>OBSERVAÇÕES</label><input name="notes" placeholder="Responsabilidades ou informações importantes" /></div>
        </div>
        <button className="button dark" disabled={busy}>{busy ? "Salvando..." : "Cadastrar funcionário"}</button>
      </form>}
      <div className="custom-member-list">{role.custom_staff_members.length ? role.custom_staff_members.map(member => <div key={member.id} className={`custom-member-row ${role.system_key === "driver" ? "driver-member-row" : role.financial_role ? "cashier-member-row" : ""}`}>{member.photo_url ? <img src={member.photo_url} alt="" /> : <span className="custom-member-avatar" style={{ backgroundColor: role.color }}>{member.name.slice(0,2).toUpperCase()}</span>}<div className="custom-member-info"><span className={`team-status ${member.status === "active" ? "active" : "inactive"}`}>{member.status === "active" ? "ATIVO" : "INATIVO"}</span><h3>{member.name}</h3><p>{member.employment_type === "daily" ? `Diarista em ${member.work_date ? new Date(`${member.work_date}T12:00:00`).toLocaleDateString("pt-BR") : "data não informada"}` : "Funcionário fixo"} · Pagamento {paymentLabel[member.payment_cycle]}{(role.financial_role || role.system_key === "driver") ? ` · ${member.user_id ? "Acesso vinculado" : "Aguardando senha"}` : ""}</p>{role.system_key === "driver" && member.driver_profiles?.[0] && <small className="driver-vehicle-summary">{({ motorcycle: "Moto", bicycle: "Bicicleta", car: "Carro", other: "Outro" } as Record<string,string>)[member.driver_profiles[0].vehicle_type]}{member.driver_profiles[0].vehicle_model ? ` · ${member.driver_profiles[0].vehicle_model}` : ""}{member.driver_profiles[0].vehicle_plate ? ` · ${member.driver_profiles[0].vehicle_plate}` : ""}</small>}{member.driver_profiles?.[0] && <div className={`driver-kind-field ${editingDriverId === member.id ? "editing" : ""}`}><span>Vínculo: {member.driver_profiles[0].driver_kind === "fixed" ? "Motoboy fixo" : "Motoboy parceiro"}</span>{editingDriverId === member.id && <label>VÍNCULO DO MOTOBOY<select aria-label={`Vínculo de ${member.name}`} value={member.driver_profiles[0].driver_kind || "partner"} disabled={busy} onChange={async event => {
 const kind=event.target.value as "fixed" | "partner"; setBusy(true);
 const {error}=await supabase.from("driver_profiles").update({driver_kind:kind}).eq("id",member.driver_profiles![0].id).eq("establishment_id",establishmentId);
 if(error) setMessage(error.message); else {setRoles(current=>current.map(r=>({...r,custom_staff_members:r.custom_staff_members.map(m=>m.id===member.id?{...m,driver_profiles:m.driver_profiles?.map(d=>({...d,driver_kind:kind}))}:m)})));setMessage("Vínculo do motoboy atualizado.");} setBusy(false);
 }}><option value="fixed">Motoboy fixo</option><option value="partner">Motoboy parceiro</option></select></label>}</div>}{member.notes && <small>{member.notes}</small>}</div><div className={`${role.financial_role ? "waiter-row-actions cashier-member-actions" : "team-heading-actions"} ${role.system_key === "driver" ? "driver-member-actions" : ""}`}>{(role.system_key === "driver" || role.financial_role) && <button type="button" className="button outline" onClick={() => role.financial_role ? setEditingMemberId(current => current === member.id ? null : member.id) : setEditingDriverId(current => current === member.id ? null : member.id)}>{(role.financial_role ? editingMemberId : editingDriverId) === member.id ? "Fechar" : "Editar"}</button>}{role.system_key === "driver" ? <StaffAccessActions name={member.name} phone={member.phone} areaLabel="motoboy" loginPath="/motoboy/login" activated={Boolean(member.user_id)} busy={busy} onCreateAccess={() => createDriverInvite(member)} onResetPassword={() => createDriverInvite(member)} /> : role.financial_role ? <StaffAccessActions name={member.name} phone={member.phone} areaLabel="caixa" loginPath="/caixa/login" activated={Boolean(member.user_id)} busy={busy} onCreateAccess={() => createCashierInvite(member)} onResetPassword={() => createCashierInvite(member)} /> : null}{role.financial_role && <button type="button" disabled={busy} onClick={() => void toggleMemberStatus(role, member)}>{member.status === "active" ? "Bloquear" : "Ativar"}</button>}<button type="button" className="danger-action" onClick={() => void removeMember(role, member)}>{role.system_key === "driver" ? "Desativar" : "Excluir"}</button></div></div>) : <div className="empty-state">Nenhum funcionário cadastrado nesta função.</div>}</div>
      {role.financial_role && editingMemberId && (() => {
        const member = role.custom_staff_members.find(row => row.id === editingMemberId);
        if (!member) return null;
        return <form className="form custom-member-form cashier-edit-form" onSubmit={event => saveMemberEdit(event, role, member)}>
          <div className="section-heading"><div><small>EDITAR FUNCIONÁRIO DO CAIXA</small><h3>{member.name}</h3></div><button type="button" className="button outline" onClick={() => setEditingMemberId(null)}>Cancelar</button></div>
          <div className="form-grid"><div className="field"><label>NOME E SOBRENOME</label><input name="name" required minLength={2} defaultValue={member.name} /></div><div className="field"><label>TELEFONE / WHATSAPP</label><input name="phone" type="tel" defaultValue={member.phone || ""} /></div><div className="field"><label>TIPO DE CONTRATAÇÃO</label><select name="employment_type" defaultValue={member.employment_type}><option value="fixed">Funcionário fixo</option><option value="daily">Diarista</option></select></div><div className="field"><label>DATA DE TRABALHO (DIARISTA)</label><input name="work_date" type="date" defaultValue={member.work_date || ""} /></div><div className="field"><label>FORMA DE PAGAMENTO</label><select name="payment_cycle" defaultValue={member.payment_cycle}><option value="daily">Diária</option><option value="weekly">Semanal</option><option value="biweekly">Quinzenal</option><option value="monthly">Mensal</option></select></div><div className="field"><label>TURNO</label><div className="shift-fields"><input name="shift_start" type="time" defaultValue={member.shift_start || ""} /><input name="shift_end" type="time" defaultValue={member.shift_end || ""} /></div></div><div className="field full"><label>OBSERVAÇÕES</label><input name="notes" defaultValue={member.notes || ""} /></div></div>
          <button className="button dark" disabled={busy}>{busy ? "Salvando..." : "Salvar alterações"}</button>
        </form>;
      })()}
      {cashierInvite && role.custom_staff_members.some(member => member.id === cashierInvite.memberId) && <div className="invite-box"><div><small>ACESSO INDIVIDUAL DO CAIXA</small><h3>Enviar acesso de {cashierInvite.name}</h3><p>O funcionário cria a senha uma vez e depois entra somente com nome e senha.</p></div><input readOnly value={cashierInvite.link} /><div className="team-heading-actions"><button className="button outline" type="button" onClick={() => navigator.clipboard.writeText(cashierInvite.link)}>Copiar link</button><a className="button whatsapp" target="_blank" href={`https://wa.me/${cashierInvite.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá, ${cashierInvite.name}. Crie sua senha para acessar o caixa: ${cashierInvite.link}`)}`}>Enviar pelo WhatsApp</a></div></div>}
      {driverInvite && role.custom_staff_members.some(member => member.id === driverInvite.memberId) && <div className="invite-box"><div><small>ACESSO INDIVIDUAL DO MOTOBOY</small><h3>Enviar acesso de {driverInvite.name}</h3><p>O motoboy cria a senha uma vez e depois entra somente com nome e senha. Diaristas acessam apenas na data liberada.</p></div><input readOnly value={driverInvite.link} /><div className="team-heading-actions"><button className="button outline" type="button" onClick={() => navigator.clipboard.writeText(driverInvite.link)}>Copiar link</button><a className="button whatsapp" target="_blank" rel="noreferrer" href={`https://wa.me/${driverInvite.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá, ${driverInvite.name}. Crie sua senha para acessar as entregas do MasterApp: ${driverInvite.link}`)}`}>Enviar pelo WhatsApp</a></div></div>}
    </article>)}
    {message && <div className="form-message form-success sticky-message">{message}</div>}
  </section>;
}
