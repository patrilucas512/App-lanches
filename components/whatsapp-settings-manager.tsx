"use client";

import { FormEvent, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Connection = { id: string; status: string; webhook_status: string; phone_number_id: string; whatsapp_business_account_id: string; display_phone_number?: string | null; verified_name?: string | null; graph_api_version?: string; connected_at?: string | null; last_webhook_at?: string | null; last_error?: string | null; label?:string | null; is_primary?:boolean; routing_mode?:"store"|"organization"; ai_enabled?:boolean; automatic_replies_enabled?:boolean; human_handoff_enabled?:boolean; ai_outside_business_hours?:boolean; ai_attendant_name?:string; ai_welcome_message?:string; ai_fallback_message?:string; cart_recovery_enabled?:boolean; cart_recovery_delay_minutes?:number; upsell_enabled?:boolean; pix_expiration_minutes?:number; notify_payment_confirmed?:boolean; notify_order_preparing?:boolean; notify_order_ready?:boolean; notify_order_out_for_delivery?:boolean; notify_order_delivered?:boolean };
type TeamMember = { user_id: string; role: string; label: string; permissions?: Record<string, boolean> };
const permissionLabels: Array<[string,string]> = [["can_view","Visualizar"],["can_respond","Responder"],["can_claim","Assumir"],["can_resolve","Finalizar"],["can_configure","Configurar WhatsApp"],["can_view_queue","Ver filas"],["can_transfer","Transferir"],["can_change_priority","Alterar prioridade"],["can_view_supervision","Ver supervisão"],["can_monitor","Monitorar conversas"],["can_take_over","Assumir pela supervisão"],["can_configure_sla","Configurar SLA"],["can_configure_queues","Configurar filas"],["can_view_productivity","Ver produtividade"],["can_review_quality","Avaliar qualidade"]];

export function WhatsAppSettingsManager({ establishmentId, initialConnection, initialConnections, team }: { establishmentId: string; initialConnection: Connection | null; initialConnections?: Connection[]; team: TeamMember[] }) {
  const [connections, setConnections] = useState(initialConnections?.length ? initialConnections : initialConnection ? [initialConnection] : []);
  const [connection, setConnection] = useState(initialConnection);
  const [adding, setAdding] = useState(false);
  const [members, setMembers] = useState(team);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const webhookUrl = useMemo(() => connection && typeof window !== "undefined" ? `${window.location.origin}/api/whatsapp/webhook?connection=${connection.id}` : "", [connection]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const data = new FormData(event.currentTarget);
    const payload = Object.fromEntries(data.entries());
    const response = await fetch("/api/whatsapp/configure", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({...payload,action:adding?"add":undefined,is_primary:data.get("is_primary")==="on"}) });
    const result = await response.json() as { connection?: Connection; error?: string };
    if (response.ok && result.connection) { setConnections(current => adding ? [...current.map(item => result.connection?.is_primary ? {...item,is_primary:false}:item),result.connection!] : current.map(item => item.id===result.connection?.id?result.connection!:item)); setConnection(result.connection); setAdding(false); setMessage("Conexão salva com segurança. Agora cadastre a URL do webhook na Meta."); event.currentTarget.reset(); }
    else setMessage(result.error || "Não foi possível salvar a conexão.");
    setBusy(false);
  }
  async function disconnect(target = connection) {
    if (!target) return;
    if (!confirm("Desconectar o WhatsApp deste estabelecimento? O histórico será preservado.")) return;
    setBusy(true); const response = await fetch("/api/whatsapp/configure", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ establishment_id:establishmentId, connection_id:target.id, action:"disconnect_by_id" }) });
    if (response.ok) { setConnections(current => current.map(item=>item.id===target.id?{...item,status:"disconnected",is_primary:false}:item)); setConnection(current => current?.id===target.id ? {...current,status:"disconnected",is_primary:false}:current); setMessage("WhatsApp desconectado. O histórico foi mantido."); }
    else setMessage("Não foi possível desconectar."); setBusy(false);
  }
  async function saveAutomation(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!connection)return; setBusy(true);setMessage("");
    const form=new FormData(event.currentTarget);
    const payload={establishment_id:establishmentId,ai_enabled:form.get("ai_enabled")==="on",automatic_replies_enabled:form.get("automatic_replies_enabled")==="on",human_handoff_enabled:form.get("human_handoff_enabled")==="on",ai_outside_business_hours:form.get("ai_outside_business_hours")==="on",ai_attendant_name:form.get("ai_attendant_name"),ai_welcome_message:form.get("ai_welcome_message"),ai_fallback_message:form.get("ai_fallback_message"),cart_recovery_enabled:form.get("cart_recovery_enabled")==="on",cart_recovery_delay_minutes:Number(form.get("cart_recovery_delay_minutes")||30),upsell_enabled:form.get("upsell_enabled")==="on",pix_expiration_minutes:Number(form.get("pix_expiration_minutes")||30),notify_payment_confirmed:form.get("notify_payment_confirmed")==="on",notify_order_preparing:form.get("notify_order_preparing")==="on",notify_order_ready:form.get("notify_order_ready")==="on",notify_order_out_for_delivery:form.get("notify_order_out_for_delivery")==="on",notify_order_delivered:form.get("notify_order_delivered")==="on"};
    const response=await fetch("/api/whatsapp/automation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const result=await response.json() as {automation?:Partial<Connection>;error?:string};
    if(response.ok&&result.automation){setConnection(current=>current?{...current,...result.automation}:current);setMessage("Atendente automático atualizado.");}else setMessage(result.error||"Não foi possível salvar o atendente.");
    setBusy(false);
  }
  async function changePermission(member: TeamMember, key: string, checked: boolean) {
    const next = { ...(member.permissions || {}), [key]: checked };
    if (key === "can_view" && !checked) Object.assign(next,{can_respond:false,can_claim:false,can_resolve:false,can_configure:false,can_view_queue:false,can_transfer:false,can_change_priority:false,can_view_supervision:false,can_monitor:false,can_take_over:false,can_configure_sla:false,can_configure_queues:false,can_view_productivity:false,can_review_quality:false});
    if (key !== "can_view" && checked) next.can_view = true;
    const supabase = createClient();
    const { error } = await supabase.rpc("set_whatsapp_member_permissions", { requested_establishment_id:establishmentId, requested_user_id:member.user_id, requested_permissions:next });
    if (error) return setMessage(error.message);
    setMembers(current => current.map(item => item.user_id === member.user_id ? {...item,permissions:next}:item)); setMessage("Permissão atualizada.");
  }

  return <section className="panel whatsapp-settings" id="whatsapp">
    <header className="delivery-settings-head"><div><small>CANAL OFICIAL DA META</small><h2>WhatsApp Business.</h2><p>Conecte o número do estabelecimento pela Cloud API oficial. As credenciais ficam protegidas no cofre e nunca aparecem no navegador.</p></div><span className={`status-pill ${connection?.status === "connected" ? "active":""}`}>{connection?.status === "connected" ? "Conectado":"Desconectado"}</span></header>
    <div className="whatsapp-number-list"><header><div><small>NÚMEROS DA UNIDADE</small><h3>{connections.length} cadastrado{connections.length===1?"":"s"}</h3></div><button className="admin-button admin-button-secondary" type="button" onClick={()=>{setAdding(true);setConnection(null);setMessage("");}}>+ Adicionar número</button></header>{connections.map(item=><article className={item.id===connection?.id?"selected":""} key={item.id}><button type="button" onClick={()=>{setConnection(item);setAdding(false);}}><b>{item.label||item.verified_name||"WhatsApp"}</b><span>{item.display_phone_number||item.phone_number_id}</span><small>{item.is_primary?"Principal · ":""}{item.routing_mode==="organization"?"Central da rede":"Unidade"} · {item.status==="connected"?"Conectado":"Desconectado"}</small></button>{item.status==="connected"&&<button type="button" className="admin-button admin-button-danger" onClick={()=>disconnect(item)}>Desconectar</button>}</article>)}</div>
    {connection && !adding && <div className="whatsapp-connection-summary"><div><small>NÚMERO</small><b>{connection.display_phone_number || "Não informado"}</b></div><div><small>NOME COMERCIAL</small><b>{connection.verified_name || "Não informado"}</b></div><div><small>WEBHOOK</small><b>{connection.webhook_status === "verified" ? "Funcionando":"Aguardando verificação"}</b></div><div><small>ÚLTIMO EVENTO</small><b>{connection.last_webhook_at ? new Date(connection.last_webhook_at).toLocaleString("pt-BR") : "Ainda não recebido"}</b></div></div>}
    {(adding || !connection || connection.is_primary) && <form className="whatsapp-config-form" onSubmit={save}>
      <input type="hidden" name="establishment_id" value={establishmentId} />
      {adding&&<><div className="field"><label>IDENTIFICAÇÃO DO NÚMERO</label><input name="label" placeholder="Ex.: Central de pedidos" required /></div><div className="field"><label>ROTEAMENTO</label><select name="routing_mode" defaultValue="store"><option value="store">Direto para esta unidade</option><option value="organization">Central da rede — cliente escolhe a unidade</option></select></div><label className="whatsapp-primary-check"><input type="checkbox" name="is_primary"/> Tornar este o número principal</label></>}
      <div className="field"><label>PHONE NUMBER ID</label><input name="phone_number_id" defaultValue={connection?.phone_number_id || ""} required /></div>
      <div className="field"><label>WHATSAPP BUSINESS ACCOUNT ID</label><input name="whatsapp_business_account_id" defaultValue={connection?.whatsapp_business_account_id || ""} required /></div>
      <div className="field"><label>NÚMERO EXIBIDO</label><input name="display_phone_number" defaultValue={connection?.display_phone_number || ""} placeholder="+55 21 99999-9999" /></div>
      <div className="field"><label>NOME COMERCIAL</label><input name="verified_name" defaultValue={connection?.verified_name || ""} /></div>
      <div className="field"><label>ACCESS TOKEN</label><input name="access_token" type="password" autoComplete="new-password" required={!connection} placeholder={connection ? "Deixe vazio para manter o atual":"Token permanente da Meta"} /></div>
      <div className="field"><label>APP SECRET</label><input name="app_secret" type="password" autoComplete="new-password" required={!connection} placeholder={connection ? "Deixe vazio para manter o atual":"Segredo do aplicativo Meta"} /></div>
      <div className="field"><label>VERIFY TOKEN</label><input name="verify_token" type="password" autoComplete="new-password" required={!connection} placeholder={connection ? "Deixe vazio para manter o atual":"Crie um token de verificação forte"} /></div>
      <div className="field"><label>VERSÃO DA GRAPH API</label><input name="graph_api_version" defaultValue={connection?.graph_api_version || "v23.0"} pattern="v[0-9]+\.[0-9]+" /></div>
      <div className="whatsapp-config-actions"><button className="admin-button admin-button-primary" disabled={busy}>{busy ? "Salvando...":adding ? "Adicionar número":connection ? "Atualizar conexão":"Conectar WhatsApp"}</button>{adding&&<button className="admin-button admin-button-secondary" type="button" onClick={()=>{setAdding(false);setConnection(connections[0]||null);}}>Cancelar</button>}</div>
    </form>}
    {connection && !connection.is_primary && !adding && <p className="form-message">Este é um número adicional. Para substituir credenciais, desconecte-o e cadastre novamente; o histórico existente será preservado.</p>}
    {webhookUrl && <div className="whatsapp-webhook-box"><small>URL DO WEBHOOK PARA CADASTRAR NA META</small><code>{webhookUrl}</code><button className="admin-button admin-button-secondary" type="button" onClick={() => navigator.clipboard.writeText(webhookUrl)}>Copiar URL</button><p>Assine o campo <b>messages</b> no painel da Meta. Use o mesmo Verify Token informado acima.</p></div>}
    {connection&&<form className="whatsapp-automation-form" onSubmit={saveAutomation}>
      <header><small>FASE 2 · ATENDENTE INTELIGENTE</small><h3>Automação com dados reais do MasterApp</h3><p>Responde dúvidas de cardápio, horários, entrega, pagamento e pedidos. Ao assumir uma conversa, a automação para imediatamente.</p></header>
      <div className="whatsapp-automation-switches">
        <label><input type="checkbox" name="ai_enabled" defaultChecked={connection.ai_enabled}/> Atendente com IA</label>
        <label><input type="checkbox" name="automatic_replies_enabled" defaultChecked={connection.automatic_replies_enabled}/> Respostas automáticas</label>
        <label><input type="checkbox" name="human_handoff_enabled" defaultChecked={connection.human_handoff_enabled!==false}/> Transferência humana</label>
        <label><input type="checkbox" name="ai_outside_business_hours" defaultChecked={connection.ai_outside_business_hours!==false}/> Responder fora do horário</label>
      </div>
      <div className="field"><label>NOME DO ATENDENTE</label><input name="ai_attendant_name" defaultValue={connection.ai_attendant_name||"Atendente virtual"} minLength={2} maxLength={60} required/></div>
      <div className="field"><label>MENSAGEM DE BOAS-VINDAS</label><textarea name="ai_welcome_message" defaultValue={connection.ai_welcome_message||"Olá! Sou o atendente virtual. Posso ajudar com cardápio, horários, entrega e andamento do pedido."} maxLength={1000} required/></div>
      <div className="field"><label>MENSAGEM QUANDO NÃO SOUBER RESPONDER</label><textarea name="ai_fallback_message" defaultValue={connection.ai_fallback_message||"Não consegui confirmar essa informação com segurança. Vou chamar uma pessoa da equipe para ajudar você."} maxLength={1000} required/></div>
      <header><small>FASE 4 · COMÉRCIO AUTOMÁTICO</small><h3>Pagamentos, recuperação e avisos</h3><p>O PIX expira, confirma por webhook e só então libera o pedido para a cozinha. A recuperação envia no máximo um lembrete e respeita a janela da Meta.</p></header>
      <div className="whatsapp-automation-switches">
        <label><input type="checkbox" name="cart_recovery_enabled" defaultChecked={connection.cart_recovery_enabled}/> Recuperar carrinho abandonado</label>
        <label><input type="checkbox" name="upsell_enabled" defaultChecked={connection.upsell_enabled!==false}/> Sugerir complemento uma vez</label>
        <label><input type="checkbox" name="notify_payment_confirmed" defaultChecked={connection.notify_payment_confirmed!==false}/> Avisar pagamento confirmado</label>
        <label><input type="checkbox" name="notify_order_preparing" defaultChecked={connection.notify_order_preparing!==false}/> Avisar pedido em preparo</label>
        <label><input type="checkbox" name="notify_order_ready" defaultChecked={connection.notify_order_ready!==false}/> Avisar pedido pronto</label>
        <label><input type="checkbox" name="notify_order_out_for_delivery" defaultChecked={connection.notify_order_out_for_delivery!==false}/> Avisar saída para entrega</label>
        <label><input type="checkbox" name="notify_order_delivered" defaultChecked={connection.notify_order_delivered!==false}/> Avisar entrega concluída</label>
      </div>
      <div className="field"><label>LEMBRAR CARRINHO APÓS (MINUTOS)</label><input name="cart_recovery_delay_minutes" type="number" min="15" max="1440" defaultValue={connection.cart_recovery_delay_minutes||30}/></div>
      <div className="field"><label>PIX VÁLIDO POR (MINUTOS)</label><input name="pix_expiration_minutes" type="number" min="30" max="1440" defaultValue={connection.pix_expiration_minutes||30}/></div>
      <button className="admin-button admin-button-primary" disabled={busy}>Salvar atendente automático</button>
    </form>}
    {connection?.last_error && <div className="form-message">{connection.last_error}</div>}
    <div className="whatsapp-permissions"><header><small>EQUIPE</small><h3>Permissões de atendimento</h3><p>Administradores já possuem acesso total. Libere somente o necessário para cada funcionário.</p></header>{members.filter(member => !["owner","manager"].includes(member.role)).map(member => <article key={member.user_id}><div><b>{member.label}</b><small>{member.role}</small></div><div>{permissionLabels.map(([key,label]) => <label key={key}><input type="checkbox" checked={Boolean(member.permissions?.[key])} onChange={event => changePermission(member,key,event.target.checked)} /> {label}</label>)}</div></article>)}</div>
    {message && <div className="form-message" aria-live="polite">{message}</div>}
  </section>;
}
