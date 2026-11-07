"use client";

import { FormEvent, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { AdminBadge, AdminButton, AdminEmptyState, AdminField, AdminInput, AdminSelect, AdminSwitch, AdminTextarea } from "@/components/admin-ui";

type Row=Record<string,any>;
type Permissions={can_view:boolean;can_edit_personality:boolean;can_edit_knowledge:boolean;can_edit_rules:boolean;can_publish:boolean;can_view_metrics:boolean;can_view_costs:boolean;can_use_simulator:boolean};
// Atendente IA organizada em 3 áreas: passo a passo (configurar), acompanhar e opções avançadas.
const followTabs=["Resumo","Conversas","Perguntas sem resposta","Resultados"];
const commonQuestions=["Vocês entregam no meu bairro?","Qual o tempo de entrega?","Aceitam cartão na entrega?","Tem opção vegetariana?","Tem estacionamento?","Fazem pedido para retirar?"];
const handoffOptions:Array<[string,string,string]>=[["customer_requests_human","O cliente pedir para falar com uma pessoa","Recomendado"],["complaint","Reclamação","Recomendado"],["wrong_order","Pedido veio errado","Recomendado"],["late_order","Pedido atrasado","Recomendado"],["payment_problem","Problema com pagamento","Recomendado"],["refund","Pedido de reembolso","Recomendado"],["irritated","Cliente irritado","Recomendado"],["unknown","Ela não souber responder","Recomendado"]];
const versionLabel=(status:string)=>status==="published"?"No ar":status==="draft"?"Em edição":"Antiga";
const scenarios=["Quero ver o cardápio","Quero fazer um pedido","Qual é o horário de hoje?","Vocês entregam no Centro?","Meu pedido veio errado","Quero cancelar meu pedido","Vocês aceitam vale-alimentação Alelo?"];
const money=(cents:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format((Number(cents)||0)/100);

export function AIAttendantManager(props:{establishmentId:string;userId:string;permissions:Permissions;versions:Row[];connection:Row|null;metrics:Row;knowledge:Row[];faqs:Row[];rules:Row[];suggestions:Row[];analysis:Row[];alerts:Row[];entitlements:Row|null;members:Row[]}){
  const supabase=useMemo(()=>createClient(),[]);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState("");
  const [knowledge,setKnowledge]=useState(props.knowledge);const [faqs,setFaqs]=useState(props.faqs);const [rules,setRules]=useState(props.rules);const [metrics,setMetrics]=useState(props.metrics);
  const [conversationFilter,setConversationFilter]=useState("all");const [simMessage,setSimMessage]=useState("");const [simResult,setSimResult]=useState<Row|null>(null);
  const draft=props.versions.find(v=>v.status==="draft");const active=props.versions.find(v=>v.status==="published");const editing=draft||active;
  const isDraft=editing?.status==="draft";const status=props.connection?.status==="connected"&&props.connection?.ai_enabled?"active":props.connection?.last_error?"problem":"inactive";
  const resolution=Number(metrics.messages)?Math.round(Number(metrics.resolved||0)/Number(metrics.messages)*100):0;const estimatedCost=Number(metrics.estimated_cost_micros||0)/1_000_000;
  const filteredAnalysis=props.analysis.filter(item=>conversationFilter==="all"||item.resolution===conversationFilter||item.category===conversationFilter||(conversationFilter==="sale"&&Number(item.generated_sale_cents)>0));
  const [section,setSection]=useState<"passos"|"acompanhar"|"avancado">(props.connection?.ai_enabled&&active&&!draft?"acompanhar":"passos");const [step,setStep]=useState(()=>props.connection?.status!=="connected"?0:!String(editing?.introduction||"").trim()?1:props.knowledge.length+props.faqs.length===0?2:active&&!draft?0:4);const [seen,setSeen]=useState<number[]>([]);const [followTab,setFollowTab]=useState(followTabs[0]);const [faqQuestion,setFaqQuestion]=useState("");
  const show=(message:string)=>{setNotice(message);window.setTimeout(()=>setNotice(""),5000)};
  async function createDraft(){setBusy(true);const {error}=await supabase.rpc("create_ai_config_draft",{requested_establishment_id:props.establishmentId});setBusy(false);if(error)return show(error.message);window.location.reload();}
  async function updateConfig(values:Row){if(!draft){show("Clique em “Começar a editar” antes de mudar.");return false;}setBusy(true);const {error}=await supabase.from("ai_config_versions").update(values).eq("id",draft.id).eq("establishment_id",props.establishmentId);setBusy(false);show(error?error.message:"Salvo. Teste no último passo antes de ligar.");return !error;}
  async function publish(){if(!draft)return;setBusy(true);const {error}=await supabase.rpc("publish_ai_config",{requested_establishment_id:props.establishmentId,requested_config_id:draft.id,requested_summary:"Publicado pela Central da Atendente IA"});setBusy(false);if(error)return show(error.message);window.location.reload();}
  async function rollback(version:number){if(!window.confirm(`Restaurar a versão v${version}? Uma nova versão será publicada.`))return;setBusy(true);const {error}=await supabase.rpc("rollback_ai_config",{requested_establishment_id:props.establishmentId,requested_version:version});setBusy(false);if(error)return show(error.message);window.location.reload();}
  async function savePersonality(event:FormEvent<HTMLFormElement>){event.preventDefault();const f=new FormData(event.currentTarget);const ok=await updateConfig({attendant_name:String(f.get("attendant_name")),introduction:String(f.get("introduction")),style:String(f.get("style")),formality:Number(f.get("formality")),response_length:String(f.get("response_length")),emoji_level:String(f.get("emoji_level")),custom_tone:String(f.get("custom_tone"))});if(ok)goStep(2);}
  async function addKnowledge(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!draft)return show("Clique em “Começar a editar” antes de adicionar.");const f=new FormData(event.currentTarget);setBusy(true);const {data,error}=await supabase.from("ai_knowledge_items").insert({establishment_id:props.establishmentId,config_version_id:draft.id,title:String(f.get("title")),category:String(f.get("category")),content:String(f.get("content")),created_by:props.userId}).select().single();setBusy(false);if(error)return show(error.message);setKnowledge(v=>[data,...v]);event.currentTarget.reset();show("Texto adicionado. Ele vale depois que você ligar a atendente no passo 5.");}
  async function addFaq(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!draft)return show("Clique em “Começar a editar” antes de adicionar.");const f=new FormData(event.currentTarget);setBusy(true);const {data,error}=await supabase.from("ai_faqs").insert({establishment_id:props.establishmentId,config_version_id:draft.id,question:String(f.get("question")),answer:String(f.get("answer")),category:String(f.get("category")),variations:String(f.get("variations")||"").split("\n").map(v=>v.trim()).filter(Boolean),created_by:props.userId}).select().single();setBusy(false);if(error)return show(error.message);setFaqs(v=>[data,...v]);event.currentTarget.reset();show("Resposta adicionada. Ela vale depois que você ligar a atendente no passo 5.");}
  async function addRule(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!draft)return show("Clique em “Começar a editar” antes de adicionar.");const f=new FormData(event.currentTarget);setBusy(true);const {data,error}=await supabase.from("ai_custom_rules").insert({establishment_id:props.establishmentId,config_version_id:draft.id,name:String(f.get("name")),rule_type:String(f.get("rule_type")),condition_field:String(f.get("condition_field")),operator:String(f.get("operator")),condition_value:{value:String(f.get("condition_value"))},action:String(f.get("action")),response_text:String(f.get("response_text")||""),created_by:props.userId}).select().single();setBusy(false);if(error)return show(error.message);setRules(v=>[...v,data]);event.currentTarget.reset();show("Regra estruturada adicionada.");}
  async function remove(table:string,id:string,setter:(fn:(rows:Row[])=>Row[])=>void){if(!draft||!window.confirm("Excluir este item do rascunho?"))return;const {error}=await supabase.from(table).delete().eq("id",id).eq("establishment_id",props.establishmentId);if(error)return show(error.message);setter(rows=>rows.filter(row=>row.id!==id));}
  async function simulate(message=simMessage){if(!message.trim())return;setBusy(true);setSimResult(null);const response=await fetch("/api/whatsapp/ai/simulate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({establishment_id:props.establishmentId,message,config_id:editing?.id})});const result=await response.json();setBusy(false);if(!response.ok)return show(result.error||"Falha na simulação.");setSimResult({question:message,...result});setSimMessage("");}
  async function addSuggestion(item:Row){if(!draft)return show("Clique em “Começar a editar” no passo a passo para ensinar respostas.");const answer=window.prompt("Digite a resposta aprovada para esta pergunta:");if(!answer)return;const {error}=await supabase.from("ai_knowledge_items").insert({establishment_id:props.establishmentId,config_version_id:draft.id,title:item.normalized_topic,category:"Informações gerais",content:answer,created_by:props.userId});if(error)return show(error.message);await supabase.from("ai_learning_suggestions").update({status:"accepted",reviewed_by:props.userId,reviewed_at:new Date().toISOString()}).eq("id",item.id).eq("establishment_id",props.establishmentId);show("Resposta adicionada ao rascunho. Publique após testar.");}
  async function refreshMetrics(days:number){const {data,error}=await supabase.rpc("get_ai_dashboard",{requested_establishment_id:props.establishmentId,requested_days:days});if(error)return show(error.message);setMetrics(data||{});}
  async function savePermissions(member:Row,key:keyof Permissions,value:boolean){const current=member.ai_member_permissions?.[0]||{};const {error}=await supabase.rpc("set_ai_member_permissions",{requested_establishment_id:props.establishmentId,requested_user_id:member.user_id,requested_permissions:{...current,[key]:value}});show(error?error.message:"Permissão atualizada.");}

  const steps=[
    {title:"Conectar o WhatsApp",short:"WhatsApp",done:props.connection?.status==="connected"},
    {title:"Nome e jeito de falar",short:"Jeito de falar",done:Boolean(String(editing?.introduction||"").trim())},
    {title:"O que ela precisa saber",short:"Respostas",done:knowledge.length+faqs.length>0},
    {title:"Quando chamar você",short:"Chamar você",done:knowledge.length+faqs.length>0&&(seen.includes(3)||Boolean(active))},
    {title:"Testar e ligar",short:"Testar e ligar",done:Boolean(active)&&!draft},
  ];
  const readyCount=steps.filter(s=>s.done).length;
  const nextPending=steps.findIndex(s=>!s.done);
  const goStep=(index:number)=>{setSection("passos");setStep(index);setSeen(list=>list.includes(index)?list:[...list,index]);window.scrollTo({top:0,behavior:"smooth"});};
  const editLock=!isDraft&&<div className="ai-edit-lock"><div><b>Quer mudar alguma coisa?</b><p>Clique em “Começar a editar”. Suas mudanças ficam guardadas aqui e só vão para o WhatsApp quando você ligar a atendente no último passo.</p></div>{props.permissions.can_edit_personality&&<AdminButton onClick={createDraft} disabled={busy}>Começar a editar</AdminButton>}</div>;
  const stepFooter=(extra?:ReactNode)=><footer className="ai-step-footer">{step>0?<AdminButton variant="ghost" onClick={()=>goStep(step-1)}>← Voltar</AdminButton>:<span/>}<div>{extra}{step<steps.length-1&&<AdminButton variant="secondary" onClick={()=>goStep(step+1)}>Próximo passo →</AdminButton>}</div></footer>;

  return <section className="ai-console">
    {notice&&<div className="ai-notice" role="status">{notice}</div>}

    <section className="ai-status-card">
      <div className="ai-status-main">
        <div className={`ai-orb ${status}`}><span/></div>
        <div>
          <small>SUA ATENDENTE NO WHATSAPP</small>
          <h2>{active?.attendant_name||editing?.attendant_name||"Atendente virtual"}</h2>
          <p><AdminBadge tone={status==="active"?"success":status==="problem"?"warning":"danger"}>{status==="active"?"Ligada e atendendo":status==="problem"?"Com problema":"Desligada"}</AdminBadge> {props.connection?.display_phone_number?`· ${props.connection.display_phone_number}`:"· WhatsApp ainda não conectado"}</p>
        </div>
      </div>
      <div className="ai-status-progress">
        <span>{readyCount} de {steps.length} passos prontos</span>
        <div className="ai-progress-bar" aria-hidden="true"><i style={{width:`${readyCount/steps.length*100}%`}}/></div>
        {nextPending>=0?<AdminButton onClick={()=>goStep(nextPending)}>Continuar: {steps[nextPending].title}</AdminButton>:<p className="ai-all-done">Tudo pronto! Acompanhe as conversas em “Acompanhar”.</p>}
      </div>
      {draft&&<div className="ai-pending-changes"><span>Você tem mudanças que ainda não foram para o WhatsApp.</span>{props.permissions.can_publish&&<AdminButton size="small" onClick={()=>goStep(4)}>Revisar e ligar</AdminButton>}</div>}
    </section>

    <nav className="ai-sections" aria-label="Atendente IA">
      {([["passos","Passo a passo","Configure em 5 etapas"],["acompanhar","Acompanhar","Conversas e resultados"],["avancado","Opções avançadas","Regras, versões e equipe"]] as const).map(([key,label,hint])=><button key={key} className={section===key?"active":""} onClick={()=>setSection(key)}><b>{label}</b><small>{hint}</small></button>)}
    </nav>

    {section==="passos"&&<div className="ai-wizard">
      <ol className="ai-stepper">{steps.map((s,i)=><li key={s.title}><button className={`${i===step?"ai-step-current":""} ${s.done?"ai-step-done":""}`} onClick={()=>goStep(i)} aria-current={i===step?"step":undefined}><span className="ai-step-number">{s.done?"✓":i+1}</span><span><b>{s.title}</b><small>{s.done?"Pronto":i===step?"Você está aqui":"Pendente"}</small></span></button></li>)}</ol>

      <div className="ai-step-body">
        {step===0&&<section className="ai-panel ai-step">
          <header><div><small>PASSO 1 DE 5</small><h3>Conectar o WhatsApp</h3></div><AdminBadge tone={steps[0].done?"success":"warning"}>{steps[0].done?"Conectado":"Falta conectar"}</AdminBadge></header>
          <p className="ai-step-lead">A atendente responde os clientes pelo WhatsApp da sua loja. Primeiro, ligue o número do WhatsApp ao MasterApp.</p>
          {steps[0].done?<div className="ai-step-ok"><b>Tudo certo!</b><p>Número conectado: {props.connection?.display_phone_number||"—"} {props.connection?.verified_name?`(${props.connection.verified_name})`:""}</p>{!props.connection?.ai_enabled&&<p>Falta só uma coisa: na tela do WhatsApp, marque a opção <b>“Atendente com IA”</b>.</p>}</div>:<ol className="ai-howto"><li>Clique em <b>“Abrir tela do WhatsApp”</b>.</li><li>Siga as instruções para conectar o número da loja.</li><li>Marque a opção <b>“Atendente com IA”</b> e salve.</li><li>Volte aqui para o passo 2.</li></ol>}
          {props.connection?.last_error&&<p className="ai-alert">⚠ {props.connection.last_error}</p>}
          {stepFooter(<a className="admin-button admin-button-primary admin-button-medium" href="/painel/whatsapp">Abrir tela do WhatsApp</a>)}
        </section>}

        {step===1&&<form className="ai-form ai-panel ai-step" onSubmit={savePersonality}>
          <header><div><small>PASSO 2 DE 5</small><h3>Nome e jeito de falar</h3></div></header>
          <p className="ai-step-lead">Escolha como a atendente se chama e como ela conversa com os seus clientes.</p>
          {editLock}
          <div className="ai-form-grid">
            <AdminField label="Nome da atendente"><AdminInput name="attendant_name" defaultValue={editing?.attendant_name||"Maria"} required/></AdminField>
            <AdminField label="Jeito de falar"><AdminSelect name="style" defaultValue={editing?.style||"friendly"}><option value="friendly">Simpática</option><option value="professional">Profissional</option><option value="casual">Descontraída</option><option value="direct">Direta</option><option value="custom">Personalizada</option></AdminSelect></AdminField>
            <AdminField label="Como ela se apresenta" className="wide" hint="Exemplo: Oi! Eu sou a Maria, da Lanchonete do Zé. Posso te mostrar o cardápio?"><AdminTextarea name="introduction" defaultValue={editing?.introduction||""} rows={3} placeholder="Oi! Eu sou a Maria, da sua lanchonete. Como posso ajudar?"/></AdminField>
            <AdminField label="Tamanho das respostas"><AdminSelect name="response_length" defaultValue={editing?.response_length||"short"}><option value="short">Curtas</option><option value="medium">Médias</option><option value="detailed">Detalhadas</option></AdminSelect></AdminField>
            <AdminField label="Emojis"><AdminSelect name="emoji_level" defaultValue={editing?.emoji_level||"few"}><option value="none">Nenhum</option><option value="few">Poucos</option><option value="moderate">Moderados</option></AdminSelect></AdminField>
          </div>
          <details className="ai-more"><summary>Mais ajustes (opcional)</summary><div className="ai-form-grid"><AdminField label="Formalidade" hint="Para a esquerda: mais informal · para a direita: mais formal"><AdminInput name="formality" type="range" min="0" max="100" defaultValue={editing?.formality||45}/></AdminField><AdminField label="Instruções extras" className="wide" hint="Complementa o jeito de falar, mas nunca muda segurança, pagamentos ou dados oficiais."><AdminTextarea name="custom_tone" defaultValue={editing?.custom_tone||""} rows={3} placeholder="Ex.: sempre ofereça uma bebida junto com o lanche."/></AdminField></div></details>
          {stepFooter(<AdminButton type="submit" disabled={busy||!props.permissions.can_edit_personality||!isDraft}>Salvar e continuar</AdminButton>)}
        </form>}

        {step===2&&<section className="ai-panel ai-step">
          <header><div><small>PASSO 3 DE 5</small><h3>O que ela precisa saber</h3></div><AdminBadge tone={steps[2].done?"success":"warning"}>{faqs.length+knowledge.length} resposta(s)</AdminBadge></header>
          <p className="ai-step-lead">Preços, horários, taxas de entrega e formas de pagamento ela já pega do seu cardápio e das configurações da loja. Aqui você ensina o resto: as perguntas que os clientes sempre fazem.</p>
          {editLock}
          <div className="ai-quick-questions"><span>Toque numa pergunta comum para começar:</span>{commonQuestions.map(q=><button key={q} type="button" onClick={()=>setFaqQuestion(q)} disabled={!isDraft}>{q}</button>)}</div>
          <form className="ai-form-grid ai-faq-form" onSubmit={async e=>{await addFaq(e);setFaqQuestion("");}}>
            <input type="hidden" name="category" value="Informações gerais"/>
            <AdminField label="Pergunta do cliente" className="wide"><AdminInput name="question" value={faqQuestion} onChange={e=>setFaqQuestion(e.target.value)} placeholder="Ex.: Vocês têm opção vegetariana?" required/></AdminField>
            <AdminField label="Resposta da atendente" className="wide"><AdminTextarea name="answer" rows={3} placeholder="Ex.: Temos sim! O X-Salada Veggie é feito com hambúrguer de grão-de-bico." required/></AdminField>
            <details className="ai-more wide"><summary>Outras formas do cliente perguntar (opcional)</summary><AdminField label="Uma frase por linha"><AdminTextarea name="variations" rows={3} placeholder={"Tem lanche sem carne?\nVocês fazem vegano?"}/></AdminField></details>
            <div className="wide"><AdminButton type="submit" disabled={!isDraft||busy||!props.permissions.can_edit_knowledge}>Adicionar resposta</AdminButton></div>
          </form>
          {faqs.length>0&&<div className="ai-list">{faqs.map(item=><article key={item.id}><div><small>PERGUNTA</small><h3>{item.question}</h3><p>{item.answer}</p>{(item.variations||[]).length>0&&<span>{(item.variations||[]).join(" · ")}</span>}</div>{isDraft&&<button onClick={()=>remove("ai_faqs",item.id,setFaqs)}>Excluir</button>}</article>)}</div>}
          <details className="ai-more"><summary>Escrever um texto livre para ela (opcional)</summary>
            <p className="ai-step-lead">Use para informações que não são uma pergunta: a história da casa, as regras do delivery, os combos da semana.</p>
            <form className="ai-form-grid" onSubmit={addKnowledge}><AdminField label="Assunto"><AdminInput name="title" placeholder="Ex.: Regras do delivery" required/></AdminField><AdminField label="Tipo"><AdminInput name="category" list="ai-categories" defaultValue="Informações gerais" required/></AdminField><AdminField label="Texto" className="wide"><AdminTextarea name="content" rows={4} required/></AdminField><datalist id="ai-categories"><option>Atendimento</option><option>Entrega</option><option>Produtos</option><option>Pagamentos</option><option>Reservas</option><option>Regras</option><option>Informações gerais</option></datalist><div className="wide"><AdminButton type="submit" variant="secondary" disabled={busy||!props.permissions.can_edit_knowledge||!isDraft}>Adicionar texto</AdminButton></div></form>
            {knowledge.length>0&&<div className="ai-list">{knowledge.map(item=><article key={item.id}><div><small>{item.category}</small><h3>{item.title}</h3><p>{item.content}</p></div>{isDraft&&<button onClick={()=>remove("ai_knowledge_items",item.id,setKnowledge)}>Excluir</button>}</article>)}</div>}
          </details>
          {stepFooter()}
        </section>}

        {step===3&&<section className="ai-panel ai-step">
          <header><div><small>PASSO 4 DE 5</small><h3>Quando chamar você</h3></div><AdminBadge tone="neutral">Transferência Humana</AdminBadge></header>
          <p className="ai-step-lead">Em algumas situações é melhor uma pessoa da sua equipe responder. Marque quando a atendente deve passar a conversa para vocês. Já deixamos tudo marcado, que é o mais seguro.</p>
          {editLock}
          <div className="ai-toggle-list">{handoffOptions.map(([key,label,hint])=><label key={key}><span><b>{label}</b><small>{hint}</small></span><input type="checkbox" defaultChecked={editing?.handoff_rules?.[key]!==false} onChange={e=>updateConfig({handoff_rules:{...(editing?.handoff_rules||{}),[key]:e.target.checked}})} disabled={!isDraft||!props.permissions.can_edit_rules}/></label>)}</div>
          <p className="ai-method-note">Quando ela transfere, a conversa aparece na Caixa de Entrada para a sua equipe continuar.</p>
          {stepFooter()}
        </section>}

        {step===4&&<section className="ai-panel ai-step">
          <header><div><small>PASSO 5 DE 5</small><h3>Testar e ligar</h3></div></header>
          <p className="ai-step-lead">Converse com a atendente como se fosse um cliente. É só um teste: nenhum pedido, cobrança ou mensagem de verdade é criado.</p>
          <div className="ai-simulator"><section className="ai-chat"><div className="ai-chat-history">{simResult?<><div className="user-bubble">{simResult.question}</div><div className="assistant-bubble"><b>{editing?.attendant_name||"Atendente"}</b>{simResult.answer}</div></>:<p>Escreva uma pergunta ou toque num exemplo ao lado.</p>}</div><form onSubmit={e=>{e.preventDefault();void simulate()}}><AdminInput value={simMessage} onChange={e=>setSimMessage(e.target.value)} placeholder="Escreva como um cliente escreveria…"/><AdminButton type="submit" disabled={busy||!props.permissions.can_use_simulator}>Enviar</AdminButton></form></section><aside><h3>Exemplos para testar</h3>{scenarios.map(s=><button key={s} onClick={()=>simulate(s)} disabled={busy||!props.permissions.can_use_simulator}>{s}<span>Testar →</span></button>)}</aside></div>
          <div className="ai-go-live">
            {draft?<><div><b>{active?"Gostou das respostas? Envie as mudanças para o WhatsApp.":"Gostou das respostas? Ligue a atendente."}</b><p>A partir daí, ela passa a responder os seus clientes com o que você configurou.</p></div>{props.permissions.can_publish&&<AdminButton onClick={publish} disabled={busy}>{active?"Enviar mudanças para o WhatsApp":"Ligar atendente"}</AdminButton>}</>
            :active?<div><b>A atendente já está usando a configuração mais recente.</b><p>Para mudar algo, volte a qualquer passo e clique em “Começar a editar”.</p></div>
            :<div><b>Falta configurar.</b><p>Volte ao passo 2 e clique em “Começar a editar”.</p></div>}
          </div>
          {active&&!props.connection?.ai_enabled&&<p className="ai-alert">⚠ A atendente está pronta, mas ainda está desligada no WhatsApp. Abra a <a href="/painel/whatsapp">tela do WhatsApp</a> e marque “Atendente com IA”.</p>}
          {stepFooter()}
        </section>}
      </div>
    </div>}

    {section==="acompanhar"&&<>
      <nav className="ai-tabs" aria-label="Acompanhar">{followTabs.map(item=><button key={item} className={followTab===item?"active":""} onClick={()=>setFollowTab(item)}>{item}</button>)}</nav>

      {followTab==="Resumo"&&<><div className="ai-metric-grid">{[["Mensagens atendidas",metrics.messages||0],["Resolvidas pela IA",metrics.resolved||0],["Passadas para a equipe",metrics.handoffs||0],["Pedidos criados",metrics.orders||0],["Vendas geradas",metrics.sales||0],["Valor vendido",money(metrics.revenue_cents||0)],["Taxa de resolução",`${resolution}%`],["Tempo médio de resposta",`${metrics.average_response_ms||0} ms`]].map(([label,value])=><article key={String(label)}><small>{label}</small><strong>{value}</strong></article>)}</div><section className="ai-panel"><header><div><small>SAÚDE DO SISTEMA</small><h3>Está tudo funcionando?</h3></div></header><div className="ai-health-grid">{[["WhatsApp",props.connection?.status==="connected"],["Provider IA",!props.connection?.last_error],["Webhook",props.connection?.webhook_status==="verified"],["Pedidos",true],["Pagamentos",true],["Fila",true]].map(([label,ok])=><div key={String(label)}><span className={ok?"ok":"bad"}/><b>{label}</b><small>{ok?"OK":"Verificar"}</small></div>)}</div>{props.alerts.map(a=><p className="ai-alert" key={a.id}>⚠ {a.message}</p>)}</section></>}

      {followTab==="Conversas"&&<><div className="ai-toolbar"><div><small>QUALIDADE DO ATENDIMENTO</small><h3>Conversas analisadas</h3></div><AdminSelect value={conversationFilter} onChange={e=>setConversationFilter(e.target.value)}><option value="all">Todas</option><option value="ai_resolved">Resolvidas pela IA</option><option value="human_resolved">Atendidas por humano</option><option value="transferred">Transferidas</option><option value="unresolved">Não resolvidas</option><option value="order">Geraram pedido</option><option value="sale">Geraram venda</option></AdminSelect></div>{filteredAnalysis.length===0?<AdminEmptyState title="Nenhuma conversa ainda" description="Quando os clientes começarem a falar com a atendente, as conversas aparecem aqui."/>:<div className="ai-list">{filteredAnalysis.map(item=><article key={item.id}><div><small>{item.category} · {item.resolution}</small><h3>{item.whatsapp_conversations?.last_message_preview||"Conversa"}</h3><p>Confiança: {item.confidence?`${Math.round(item.confidence*100)}%`:"—"} · Fallbacks: {item.fallback_count} · Erros de tool: {item.tool_error_count}</p></div><AdminBadge tone={item.resolution==="ai_resolved"?"success":item.resolution==="unresolved"?"danger":"warning"}>{item.generated_sale_cents?money(item.generated_sale_cents):item.resolution}</AdminBadge></article>)}</div>}</>}

      {followTab==="Perguntas sem resposta"&&<><section className="ai-safety-banner"><b>Aprendizado assistido</b><p>Perguntas que os clientes fizeram e a atendente não soube responder. Escreva a resposta certa e ela aprende. A IA nunca muda nada sozinha.</p></section>{props.suggestions.filter(s=>s.status==="pending").length===0?<AdminEmptyState title="Nenhuma pergunta pendente" description="Quando a atendente não souber responder algo, a pergunta aparece aqui para você ensinar."/>:<div className="ai-list">{props.suggestions.filter(s=>s.status==="pending").map(item=><article key={item.id}><div><small>{item.occurrences} vez(es)</small><h3>{item.normalized_topic}</h3><p>“{item.sample_question}”</p></div><AdminButton size="small" onClick={()=>addSuggestion(item)} disabled={!isDraft||!props.permissions.can_edit_knowledge}>Ensinar resposta</AdminButton></article>)}</div>}{!isDraft&&<p className="ai-method-note">Para ensinar respostas, clique em “Começar a editar” no passo a passo.</p>}</>}

      {followTab==="Resultados"&&<><div className="ai-toolbar"><div><small>DESEMPENHO E VENDAS</small><h3>Resultados da atendente</h3></div><div className="ai-periods"><button onClick={()=>refreshMetrics(1)}>Hoje</button><button onClick={()=>refreshMetrics(7)}>7 dias</button><button onClick={()=>refreshMetrics(30)}>30 dias</button><button onClick={()=>refreshMetrics(365)}>Ano</button></div></div><div className="ai-metric-grid">{[["Resolução automática",`${resolution}%`],["Passadas para a equipe",metrics.handoffs||0],["Sem resposta",metrics.fallbacks||0],["Respostas com erro",metrics.errors||0],["Pedidos gerados",metrics.orders||0],["Vendas atribuídas",metrics.sales||0],["Valor vendido pela IA",money(metrics.revenue_cents||0)],["Ticket médio",metrics.sales?money(Number(metrics.revenue_cents)/Number(metrics.sales)):money(0)]].map(([label,value])=><article key={String(label)}><small>{label}</small><strong>{value}</strong></article>)}</div></>}
    </>}

    {section==="avancado"&&<>
      <section className="ai-safety-banner"><b>Opções avançadas</b><p>Você não precisa mexer aqui para a atendente funcionar. Use só se quiser regras específicas, voltar uma versão antiga ou dar acesso à equipe.</p></section>

      <details className="ai-panel ai-advanced"><summary><span><b>Regras específicas</b><small>Ex.: pedidos acima de R$ 300 passam para a equipe</small></span></summary>
        <section className="ai-safety-banner"><b>Segurança fixa do MasterApp</b><p>Isolamento por empresa, preços, pagamentos, permissões, reembolsos, tokens e banco não podem ser alterados aqui.</p></section>
        {editLock}
        <form className="ai-form" onSubmit={addRule}><div className="ai-form-grid"><AdminField label="Nome"><AdminInput name="name" required/></AdminField><AdminField label="Tipo"><AdminSelect name="rule_type"><option value="TRANSFER_TO_HUMAN">Passar para a equipe</option><option value="BLOCK_ACTION">Bloquear ação</option><option value="ASK_CONFIRMATION">Pedir confirmação</option><option value="INFORMATION">Informar</option></AdminSelect></AdminField><AdminField label="Quando"><AdminSelect name="condition_field"><option value="order_total">Total do pedido</option><option value="order_status">Status do pedido</option><option value="intent">Assunto</option><option value="message_contains">Mensagem contém</option><option value="quantity">Quantidade</option><option value="confidence">Confiança da resposta</option></AdminSelect></AdminField><AdminField label="Comparação"><AdminSelect name="operator"><option value="gt">Maior que</option><option value="gte">Maior ou igual</option><option value="eq">Igual</option><option value="contains">Contém</option><option value="in">Está entre</option></AdminSelect></AdminField><AdminField label="Valor"><AdminInput name="condition_value" required/></AdminField><AdminField label="Ação"><AdminSelect name="action"><option value="handoff">Transferir para humano</option><option value="block_cancel">Bloquear cancelamento</option><option value="block_reservation">Bloquear reserva</option><option value="confirm">Pedir confirmação</option><option value="inform">Informar regra</option></AdminSelect></AdminField><AdminField label="Resposta ao cliente" className="wide"><AdminTextarea name="response_text" rows={3}/></AdminField></div><AdminButton type="submit" disabled={!isDraft||busy||!props.permissions.can_edit_rules}>Adicionar regra</AdminButton></form>
        {rules.length>0&&<div className="ai-list">{rules.map(item=><article key={item.id}><div><small>{item.rule_type} · prioridade {item.priority}</small><h3>{item.name}</h3><p>{item.condition_field} {item.operator} {JSON.stringify(item.condition_value)} → {item.action}</p></div>{isDraft&&<button onClick={()=>remove("ai_custom_rules",item.id,setRules)}>Excluir</button>}</article>)}</div>}
        <div className="ai-confidence"><label>Confiança mínima: <b>{Math.round(Number(editing?.low_confidence_threshold||.65)*100)}%</b></label><p>Abaixo deste nível, a atendente confirma a intenção ou transfere para a equipe. Nunca executa ação sensível com ambiguidade.</p></div>
      </details>

      <details className="ai-panel ai-advanced"><summary><span><b>Versões anteriores</b><small>Volte para uma configuração antiga</small></span></summary><div className="ai-version-list">{props.versions.map(v=><div key={v.id}><span><b>v{v.version}</b><small>{versionLabel(v.status)} · {new Date(v.created_at).toLocaleString("pt-BR")}</small></span>{v.status==="archived"&&props.permissions.can_publish&&<AdminButton size="small" variant="secondary" onClick={()=>rollback(v.version)}>Restaurar</AdminButton>}</div>)}</div></details>

      {props.members.length>0&&<details className="ai-panel ai-advanced"><summary><span><b>Acesso da equipe</b><small>Quem pode ver e mudar a atendente</small></span></summary><div className="ai-permissions">{props.members.filter(m=>!['owner','manager'].includes(m.role)).map(member=><article key={member.user_id}><div><b>{member.profiles?.full_name||member.profiles?.email||"Funcionário"}</b><small>{member.role}</small></div>{([['can_view','Ver IA'],['can_edit_personality','Editar personalidade'],['can_edit_knowledge','Editar conhecimento'],['can_edit_rules','Editar regras'],['can_publish','Publicar'],['can_view_metrics','Ver métricas'],['can_view_costs','Ver custos'],['can_use_simulator','Usar simulador']] as Array<[keyof Permissions,string]>).map(([key,label])=><label key={key}>{label}<AdminSwitch checked={Boolean(member.ai_member_permissions?.[0]?.[key])} label={label} onCheckedChange={value=>savePermissions(member,key,value)}/></label>)}</article>)}</div></details>}

      <details className="ai-panel ai-advanced"><summary><span><b>Plano e limites</b><small>O que o seu plano inclui</small></span></summary><div className="ai-entitlements">{[["Atendente IA",props.entitlements?.ai_enabled],["Pedidos pela IA",props.entitlements?.ai_ordering_enabled],["Conhecimento avançado",props.entitlements?.advanced_knowledge_enabled],["CRM integrado",props.entitlements?.ai_crm_enabled],["Conversas/mês",props.entitlements?.max_ai_conversations_month||"Ilimitado"],["Mensagens/mês",props.entitlements?.max_ai_messages_month||"Ilimitado"],["Conhecimentos",props.entitlements?.max_knowledge_items||"Ilimitado"],["Ao atingir a quota",props.entitlements?.quota_behavior||"atendimento humano"]].map(([k,v])=><div key={String(k)}><span>{k}</span><b>{typeof v==="boolean"?(v?"Ativo":"Indisponível"):String(v)}</b></div>)}</div></details>

      {props.permissions.can_view_costs&&<details className="ai-panel ai-advanced"><summary><span><b>Consumo da IA</b><small>Chamadas, tokens e custo estimado</small></span></summary><div className="ai-cost-row"><div><span>Chamadas</span><b>{metrics.messages||0}</b></div><div><span>Tokens de entrada</span><b>{metrics.input_tokens||0}</b></div><div><span>Tokens de saída</span><b>{metrics.output_tokens||0}</b></div><div><span>Custo estimado</span><b>{estimatedCost.toLocaleString("pt-BR",{style:"currency",currency:"USD"})}</b></div><div><span>Custo por conversa</span><b>{Number(metrics.messages)?(estimatedCost/Number(metrics.messages)).toLocaleString("pt-BR",{style:"currency",currency:"USD"}):"—"}</b></div><div><span>Custo por pedido</span><b>{Number(metrics.orders)?(estimatedCost/Number(metrics.orders)).toLocaleString("pt-BR",{style:"currency",currency:"USD"}):"—"}</b></div></div><p className="ai-method-note">A estimativa só usa dados devolvidos pelo provider; nenhum valor de economia é inventado.</p></details>}

      {simResult?.technical&&<details className="ai-panel ai-advanced"><summary><span><b>Detalhes técnicos do último teste</b><small>Para suporte</small></span></summary><div className="ai-technical"><p>Intenção: <b>{simResult.technical.intent}</b></p><p>Tool: <b>{simResult.technical.tool}</b></p><p>Fonte: <b>{simResult.technical.source}</b></p><p>Versão: <b>{simResult.technical.config_version}</b></p><p>Alterações reais: <b>0</b></p></div></details>}
    </>}
  </section>;
}
