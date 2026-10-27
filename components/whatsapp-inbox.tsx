"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Contact = { id:string; wa_id:string; phone_number:string; name?:string|null; profile_name?:string|null };
type Conversation = { id:string; status:"open"|"waiting"|"resolved"; assigned_user_id?:string|null; unread_count:number; last_message_preview?:string|null; last_message_at?:string|null; human_controlled:boolean; last_automation_intent?:string|null; last_ai_response_at?:string|null; whatsapp_contacts:Contact|Contact[]|null };
type Message = { id:string; conversation_id:string; direction:"inbound"|"outbound"; message_type:string; content?:string|null; status:string; sent_by_user_id?:string|null; message_timestamp:string; created_at:string; error_message?:string|null };
type Permissions = { can_view:boolean; can_respond:boolean; can_claim:boolean; can_resolve:boolean; can_configure:boolean };
type Connection = { id:string; status:string; webhook_status:string; display_phone_number?:string|null; verified_name?:string|null; ai_enabled?:boolean; automatic_replies_enabled?:boolean };
type CartItem = { id:string; product_name:string; variation_name?:string|null; quantity:number; total_cents:number };
type Cart = { id:string; conversation_id:string; status:string; state:string; fulfillment_type?:string|null; payment_method?:string|null; subtotal_cents:number; discount_cents:number; delivery_fee_cents:number; total_cents:number; converted_order_id?:string|null; expires_at:string; whatsapp_cart_items:CartItem[]|null };
const contactOf = (conversation?:Conversation|null) => Array.isArray(conversation?.whatsapp_contacts) ? conversation?.whatsapp_contacts[0] : conversation?.whatsapp_contacts;
const time = (value?:string|null) => value ? new Intl.DateTimeFormat("pt-BR",{hour:"2-digit",minute:"2-digit"}).format(new Date(value)) : "";
const currency = (value:number) => (value/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});

export function WhatsAppInbox({ establishmentId, currentUserId, connection, initialConversations, initialMessages, initialCarts, permissions, initialSelectedId, monitorMode=false }: { establishmentId:string; currentUserId:string; connection:Connection|null; initialConversations:Conversation[]; initialMessages:Message[]; initialCarts:Cart[]; permissions:Permissions; initialSelectedId?:string; monitorMode?:boolean }) {
  const [conversations,setConversations] = useState(initialConversations);
  const [selectedId,setSelectedId] = useState(initialSelectedId || initialConversations[0]?.id || "");
  const [messages,setMessages] = useState(initialMessages);
  const [search,setSearch] = useState("");
  const [draft,setDraft] = useState("");
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(false);
  const [notice,setNotice] = useState("");
  const [carts,setCarts] = useState(initialCarts);
  const selected = conversations.find(item => item.id===selectedId) || null;
  const contact = contactOf(selected);
  const selectedCart = carts.find(item=>item.conversation_id===selectedId) || null;

  const refreshConversations = useCallback(async () => {
    const supabase=createClient();
    const [{data},{data:cartRows}]=await Promise.all([
      supabase.from("whatsapp_conversations").select("id,status,assigned_user_id,unread_count,last_message_preview,last_message_at,human_controlled,last_automation_intent,last_ai_response_at,whatsapp_contacts(id,wa_id,phone_number,name,profile_name)").eq("establishment_id",establishmentId).order("last_message_at",{ascending:false}).limit(100),
      supabase.from("whatsapp_carts").select("id,conversation_id,status,state,fulfillment_type,payment_method,subtotal_cents,discount_cents,delivery_fee_cents,total_cents,converted_order_id,expires_at,whatsapp_cart_items(id,product_name,variation_name,quantity,total_cents)").eq("establishment_id",establishmentId).in("status",["active","awaiting_information","awaiting_confirmation","converted"]).order("updated_at",{ascending:false}).limit(100),
    ]);
    if(data) setConversations(data as unknown as Conversation[]);
    if(cartRows) setCarts(cartRows as unknown as Cart[]);
  },[establishmentId]);

  const openConversation = useCallback(async (id:string) => {
    setSelectedId(id); setLoading(true); setNotice("");
    const supabase=createClient();
    const {data,error}=await supabase.from("whatsapp_messages").select("id,conversation_id,direction,message_type,content,status,sent_by_user_id,message_timestamp,created_at,error_message").eq("establishment_id",establishmentId).eq("conversation_id",id).order("message_timestamp").limit(500);
    if(error) setNotice("Não foi possível carregar o histórico."); else setMessages((data||[]) as Message[]);
    if(!monitorMode){await supabase.rpc("mark_whatsapp_conversation_read",{requested_conversation_id:id});setConversations(current=>current.map(item=>item.id===id?{...item,unread_count:0}:item));}
    setLoading(false);
  },[establishmentId,monitorMode]);

  useEffect(()=>{
    const supabase=createClient();
    const refresh=()=>{void refreshConversations(); if(selectedId) void openConversation(selectedId);};
    const channel=supabase.channel(`wa-inbox-${establishmentId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"whatsapp_conversations",filter:`establishment_id=eq.${establishmentId}`},refreshConversations)
      .on("postgres_changes",{event:"*",schema:"public",table:"whatsapp_messages",filter:`establishment_id=eq.${establishmentId}`},refresh).subscribe();
    return()=>{void supabase.removeChannel(channel);};
  },[establishmentId,openConversation,refreshConversations,selectedId]);

  const filtered=useMemo(()=>{const q=search.trim().toLowerCase(); if(!q)return conversations; return conversations.filter(item=>{const c=contactOf(item); return `${c?.name||""} ${c?.profile_name||""} ${c?.phone_number||""} ${item.last_message_preview||""}`.toLowerCase().includes(q);});},[conversations,search]);

  async function send(event:FormEvent){event.preventDefault(); const text=draft.trim(); if(!selected||!text)return; setBusy(true);setNotice("");
    const response=await fetch("/api/whatsapp/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({conversation_id:selected.id,text,client_request_id:crypto.randomUUID()})});
    const result=await response.json() as {error?:string};
    if(response.ok){setDraft("");await openConversation(selected.id);}else setNotice(result.error||"Não foi possível enviar esta mensagem. Tente novamente."); setBusy(false);
  }
  async function action(kind:"claim"|"resolve"|"automation") {if(!selected)return;setBusy(true);setNotice("");const supabase=createClient();const rpc=kind==="claim"?"claim_whatsapp_conversation":kind==="resolve"?"resolve_whatsapp_conversation":"return_whatsapp_to_automation";const {error}=await supabase.rpc(rpc,{requested_conversation_id:selected.id});if(error)setNotice(error.message);else await refreshConversations();setBusy(false);}

  if(!connection||connection.status!=="connected") return <section className="panel whatsapp-empty-state"><span aria-hidden="true">◉</span><h2>Conecte o WhatsApp para começar.</h2><p>Cadastre o número oficial da empresa e o webhook nas configurações.</p>{permissions.can_configure&&<Link className="admin-button admin-button-primary" href="/painel/configuracoes#whatsapp">Abrir configurações</Link>}</section>;
  return <section className={`whatsapp-inbox ${selected?"has-chat":""}`}>
    <aside className="whatsapp-conversation-list"><header><div><small>CAIXA DE ENTRADA</small><b>{conversations.filter(item=>item.status!=="resolved").length} em atendimento</b></div><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar nome ou telefone" aria-label="Buscar conversas" /></header><div className="whatsapp-conversation-scroll">{filtered.length?filtered.map(item=>{const c=contactOf(item);return <button key={item.id} className={item.id===selectedId?"active":""} onClick={()=>openConversation(item.id)}><span className="whatsapp-avatar">{(c?.name||c?.profile_name||"C").slice(0,2).toUpperCase()}</span><div><b>{c?.name||c?.profile_name||c?.phone_number||"Cliente"}</b><small>{item.last_message_preview||"Nova conversa"}</small></div><time>{time(item.last_message_at)}</time>{item.unread_count>0&&<em>{item.unread_count}</em>}</button>}):<div className="whatsapp-list-empty">Nenhuma conversa encontrada.</div>}</div></aside>
    <main className="whatsapp-chat">{selected?<><header><button className="whatsapp-back" onClick={()=>setSelectedId("")} aria-label="Voltar à lista">←</button><div><b>{contact?.name||contact?.profile_name||"Cliente"}</b><small>{contact?.phone_number} · {selected.status==="resolved"?"Finalizado":selected.status==="waiting"?"Aguardando humano":selected.human_controlled?"Atendimento humano":connection.ai_enabled&&connection.automatic_replies_enabled?"IA respondendo":"Aberto"}</small></div>{monitorMode?<span className="status-pill">Somente leitura</span>:<div className="whatsapp-chat-actions">{permissions.can_claim&&selected.assigned_user_id!==currentUserId&&<button onClick={()=>action("claim")} disabled={busy}>Assumir atendimento</button>}{permissions.can_resolve&&selected.human_controlled&&<button onClick={()=>action("automation")} disabled={busy}>Devolver para IA</button>}{permissions.can_resolve&&selected.status!=="resolved"&&<button onClick={()=>action("resolve")} disabled={busy}>Finalizar</button>}</div>}</header><div className="whatsapp-message-history" aria-live="polite">{loading?<div className="whatsapp-loading">Carregando histórico...</div>:messages.length?messages.map(message=><article key={message.id} className={message.direction}><p>{message.content||`[${message.message_type}]`}</p><footer><time>{time(message.message_timestamp)}</time>{message.direction==="outbound"&&<span>{message.status==="read"?"✓✓ Lida":message.status==="delivered"?"✓✓ Entregue":message.status==="failed"?"Falhou":"✓ Enviada"}</span>}</footer>{message.status==="failed"&&<small>Não foi possível enviar.</small>}</article>):<div className="whatsapp-loading">O histórico aparecerá aqui.</div>}</div>{notice&&<div className="whatsapp-notice">{notice}</div>}{!monitorMode&&<form className="whatsapp-composer" onSubmit={send}><textarea value={draft} onChange={event=>setDraft(event.target.value)} placeholder={permissions.can_respond?"Digite uma mensagem":"Você não possui permissão para responder"} disabled={!permissions.can_respond||busy} maxLength={4096}/><button disabled={!permissions.can_respond||busy||!draft.trim()}>{busy?"Enviando...":"Enviar"}</button></form>}</>:<div className="whatsapp-chat-placeholder"><span>◉</span><h2>Selecione uma conversa</h2><p>O histórico completo aparecerá aqui.</p></div>}</main>
    <aside className="whatsapp-contact-panel">{selected&&<><small>CONTATO</small><h3>{contact?.name||contact?.profile_name||"Cliente"}</h3><dl><div><dt>Telefone</dt><dd>{contact?.phone_number}</dd></div><div><dt>Status</dt><dd>{selected.status==="waiting"?"Aguardando humano":selected.status}</dd></div><div><dt>Responsável</dt><dd>{selected.assigned_user_id===currentUserId?"Você":selected.assigned_user_id?"Outro atendente":selected.human_controlled?"Fila da equipe":"Atendente IA"}</dd></div><div><dt>Modo</dt><dd>{selected.human_controlled?"Humano":connection.ai_enabled&&connection.automatic_replies_enabled?"IA ativa":"Manual"}</dd></div>{selected.last_automation_intent&&<div><dt>Última intenção</dt><dd>{selected.last_automation_intent}</dd></div>}</dl>{selectedCart&&<section className="whatsapp-active-cart"><small>{selectedCart.status==="converted"?"PEDIDO CONVERTIDO":"CARRINHO ATIVO"}</small><b>{currency(selectedCart.total_cents)}</b><span>{selectedCart.fulfillment_type||"Atendimento em definição"} · {selectedCart.state.replaceAll("_"," ")}</span>{(selectedCart.whatsapp_cart_items||[]).map(item=><div key={item.id}>{item.quantity}× {item.product_name}{item.variation_name?` · ${item.variation_name}`:""}<strong>{currency(item.total_cents)}</strong></div>)}{selectedCart.converted_order_id&&<Link href={`/painel/pedidos?pedido=${selectedCart.converted_order_id}`}>Abrir pedido</Link>}</section>}<p>A IA usa somente dados cadastrados neste estabelecimento. Ao assumir, o carrinho é preservado e nenhuma resposta automática será enviada.</p></>}</aside>
  </section>;
}
