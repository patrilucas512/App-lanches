/* eslint-disable @typescript-eslint/no-explicit-any,react-hooks/set-state-in-effect */
"use client";
import{useCallback,useEffect,useState}from"react";
// The subject's privacy center inside the customer portal. When the store has not turned it on (or the database does not
// have it yet), it renders nothing and the rest of the portal is unaffected.
const TYPES:Array<[string,string]>=[["confirmation","Confirmar se vocês têm meus dados"],["access","Receber uma cópia dos meus dados"],["correction","Corrigir meus dados"],["deletion","Apagar meus dados"],["anonymization","Anonimizar meus dados"],["portability","Levar meus dados para outro serviço"],["sharing_info","Saber com quem meus dados são compartilhados"],["consent_revocation","Retirar meus consentimentos"],["opposition","Me opor a um uso dos meus dados"],["automated_decision_review","Pedir revisão de uma decisão automática"]];
const STATUS:Record<string,string>={received:"Recebida",verifying:"Confirmando sua identidade",in_progress:"Em andamento",awaiting_approval:"Em análise",fulfilled:"Concluída",partially_fulfilled:"Concluída em parte",rejected_with_reason:"Não atendida",closed:"Encerrada"};
const errors:Record<string,string>={FEATURE_DISABLED:"",PRIVACY_NOT_INSTALLED:"",AUTH:"Sua sessão expirou. Entre de novo.",REQUEST_TYPE_INVALID:"Escolha o tipo de pedido.",PURPOSE_NOT_FOUND:"Essa opção não está mais disponível."};
const date=(v:unknown)=>v?new Date(String(v)).toLocaleDateString("pt-BR"):"—";

export function PrivacyPortalCenter({slug}:{slug:string}){
  const[data,setData]=useState<any>(null),[hidden,setHidden]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[type,setType]=useState("access"),[details,setDetails]=useState("");
  const load=useCallback(async()=>{const r=await fetch(`/api/customer-portal/${slug}/privacy`,{cache:"no-store"}),j=await r.json();if(r.status===403||r.status===503){setHidden(true);return}if(!r.ok)throw new Error(j.error);setData(j)},[slug]);
  useEffect(()=>{load().catch(e=>setMessage(errors[e.message]??"Não foi possível carregar sua central de privacidade."))},[load]);
  async function call(payload:any,done:string){setBusy(true);setMessage("");try{const r=await fetch(`/api/customer-portal/${slug}/privacy`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)}),j=await r.json();if(!r.ok)throw new Error(j.error);setMessage(done);await load();return j}catch(e:any){setMessage(errors[e.message]??"Não deu certo agora. Tente de novo em instantes.");return null}finally{setBusy(false)}}
  if(hidden)return null;
  if(!data)return message?<p>{message}</p>:null;
  const status=(purpose:string,channel:string)=>data.consents.find((c:any)=>c.purpose_key===purpose&&(c.channel===channel||c.channel==="any"))?.status==="granted";
  return <section className="portal-panel" aria-labelledby="privacy-center-title">
    <h2 id="privacy-center-title">Seus dados e sua privacidade</h2>
    <p>Aqui você vê e baixa seus dados, escolhe o que aceita receber e faz pedidos sobre seus dados. Mensagens sobre os seus pedidos continuam chegando normalmente.</p>
    <button disabled={busy} onClick={async()=>{const j=await call({action:"download_my_data",client_request_id:crypto.randomUUID()},"Pronto. O download começou; o link vale por pouco tempo.");if(j?.link?.url)window.location.assign(j.link.url)}}>Baixar meus dados</button>
    <h3>O que você aceita receber</h3>
    {data.purposes.map((p:any)=>(p.channels||["any"]).map((channel:string)=><label key={`${p.purpose_key}:${channel}`} className="portal-check"><input type="checkbox" disabled={busy} checked={status(p.purpose_key,channel)} onChange={e=>call({action:"set_consent",purpose_key:p.purpose_key,channel,granted:e.target.checked},e.target.checked?"Preferência salva.":"Pronto. Você não vai mais receber isso.")}/> {p.label}{(p.channels||[]).length>1?` (${channel==="email"?"e-mail":channel==="whatsapp"?"WhatsApp":channel})`:""}{p.text?<small> — {p.text}</small>:null}</label>))}
    <h3>Fazer um pedido</h3>
    <div className="portal-form"><label>O que você quer?<select value={type} onChange={e=>setType(e.target.value)}>{TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>Quer explicar melhor? (opcional)<textarea maxLength={1000} value={details} onChange={e=>setDetails(e.target.value)}/></label><button disabled={busy} onClick={async()=>{const j=await call({action:"create_request",type,details,client_request_id:crypto.randomUUID()},"Pedido enviado. Você acompanha o andamento aqui.");if(j)setDetails("")}}>Enviar pedido</button></div>
    {data.requests.length>0&&<><h3>Seus pedidos</h3><ul className="portal-list">{data.requests.map((r:any)=><li key={r.id}><strong>{TYPES.find(([v])=>v===r.request_type)?.[1]||r.request_type}</strong><span>{STATUS[r.status]||r.status} · aberto em {date(r.received_at)}{r.due_at&&!r.completed_at?` · prazo ${date(r.due_at)}`:""}</span>{r.rejection_reason&&<span>Motivo: {r.rejection_reason}</span>}{r.response&&<span>Resposta: {r.response}</span>}{(r.packages||[]).map((p:any)=><button key={p.id} disabled={busy} onClick={async()=>{const j=await call({action:"package_link",package_id:p.id},"Download iniciado.");if(j?.url)window.location.assign(j.url)}}>Baixar arquivo (até {date(p.expires_at)})</button>)}</li>)}</ul></>}
    {message&&<p role="status" className="portal-message">{message}</p>}
  </section>;
}
