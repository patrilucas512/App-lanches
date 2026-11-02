/* eslint-disable @typescript-eslint/no-explicit-any */
import {COMMS_PRIORITIES,COMMS_TYPES,mustData} from "./core.ts";
import {commsAudit} from "./server.ts";

export const DEFAULT_TEMPLATES=[
  {template_key:"mudanca_cardapio",name:"Mudança de cardápio",announcement_type:"menu_change",priority:"important",requires_ack:false,ack_hours:null,title_template:"Cardápio: mudança em {{item}}",body_template:"A partir de {{data}}, {{item}} muda no cardápio.\n\nO que muda:\n{{detalhes}}\n\nConfira o preparo e avise a equipe do turno."},
  {template_key:"procedimento",name:"Novo procedimento",announcement_type:"procedure_change",priority:"mandatory",requires_ack:true,ack_hours:72,title_template:"Novo procedimento: {{procedimento}}",body_template:"A partir de {{data}}, passa a valer o procedimento {{procedimento}}.\n\nO que fazer:\n{{detalhes}}\n\nConfirme a leitura até o prazo."},
  {template_key:"abertura_loja",name:"Abertura de loja",announcement_type:"store_opening",priority:"important",requires_ack:false,ack_hours:null,title_template:"Abertura da unidade {{unidade}}",body_template:"A unidade {{unidade}} abre em {{data}}.\n\nO que muda para a sua equipe:\n{{detalhes}}"},
  {template_key:"recall_alimentar",name:"Recall de segurança alimentar",announcement_type:"recall_food_safety",priority:"urgent",requires_ack:true,ack_hours:4,title_template:"Recall: {{item}}",body_template:"Recall de segurança alimentar: {{item}}, lote {{lote}}.\n\nFaça agora:\n1. Separe e bloqueie o item.\n2. Não venda nem use o item.\n3. Registre a quantidade localizada na tela de Qualidade.\n\nConfirme a leitura até o prazo. Cada unidade precisa confirmar."},
  {template_key:"manutencao",name:"Manutenção",announcement_type:"maintenance",priority:"important",requires_ack:false,ack_hours:null,title_template:"Manutenção em {{unidade}}: {{data}}",body_template:"Em {{data}}, haverá manutenção na unidade {{unidade}}.\n\nO que muda na operação:\n{{detalhes}}"},
  {template_key:"crise",name:"Comunicado de crise",announcement_type:"crisis",priority:"urgent",requires_ack:true,ack_hours:4,title_template:"Atenção: {{situacao}}",body_template:"Situação: {{situacao}}.\n\nO que sabemos agora:\n{{detalhes}}\n\nO que fazer:\n{{instrucoes}}\n\nNão comente fora da equipe. Novas informações virão por este canal."},
] as const;

const variablesOf=(...texts:string[])=>[...new Set(texts.flatMap(x=>[...x.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map(m=>m[1])))];

// A variable with no value stays visible as [item]. It should stop a person reading the draft, not vanish from the text.
export function renderTemplate(template:{title_template:string;body_template:string},values:Record<string,unknown>={}){
  const missing=new Set<string>(),fill=(text:string)=>text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g,(_,key)=>{const value=values[key];if(value==null||String(value).trim()===""){missing.add(key);return`[${key}]`}return String(value).slice(0,2000)});
  const title=fill(template.title_template),body=fill(template.body_template);
  return{title,body,missing:[...missing]};
}

export async function ensureTemplates(admin:any,organizationId:string){
  await admin.from("comms_templates").upsert(DEFAULT_TEMPLATES.map(x=>({...x,organization_id:organizationId,version:1,status:"active",system_default:true,variables:variablesOf(x.title_template,x.body_template)})),{onConflict:"organization_id,template_key,version",ignoreDuplicates:true});
}

export async function activeTemplate(admin:any,organizationId:string,key:string){
  await ensureTemplates(admin,organizationId);
  const{data}=await admin.from("comms_templates").select("*").eq("organization_id",organizationId).eq("template_key",key).eq("status","active").order("version",{ascending:false}).limit(1).maybeSingle();
  if(!data)throw new Error("TEMPLATE_NOT_FOUND");
  return data;
}

// Saving is always a new version, so an announcement made from an old one still points at the text it really used.
export async function saveTemplate(ctx:any,input:any){
  if(!ctx.permissions?.includes("comms:manage_templates"))throw new Error("FORBIDDEN");
  const key=String(input.template_key||input.name||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,50),title=String(input.title_template||"").trim(),body=String(input.body_template||"").trim(),name=String(input.name||"").trim();
  if(key.length<2||name.length<2||title.length<3||body.length<3)throw new Error("TEMPLATE_INVALID");
  if(!(COMMS_TYPES as readonly string[]).includes(input.announcement_type)||!(COMMS_PRIORITIES as readonly string[]).includes(input.priority))throw new Error("TEMPLATE_INVALID");
  const{data:last}=await ctx.admin.from("comms_templates").select("id,version").eq("organization_id",ctx.organizationId).eq("template_key",key).order("version",{ascending:false}).limit(1).maybeSingle();
  const data=mustData(await ctx.admin.from("comms_templates").insert({organization_id:ctx.organizationId,template_key:key,version:(last?.version||0)+1,name,announcement_type:input.announcement_type,priority:input.priority,requires_ack:Boolean(input.requires_ack),ack_hours:input.ack_hours?Number(input.ack_hours):null,title_template:title,body_template:body,variables:variablesOf(title,body),owner_user_id:ctx.actorId}).select().single(),"salvar modelo");
  if(last)await ctx.admin.from("comms_templates").update({status:"retired"}).eq("organization_id",ctx.organizationId).eq("template_key",key).lt("version",data.version);
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"template_saved",resourceType:"comms_template",resourceId:data.id,metadata:{template_key:key,version:data.version}});
  return{template:data};
}

export function deadlineFromTemplate(template:{ack_hours?:number|null},now=new Date()){return template.ack_hours?new Date(now.getTime()+template.ack_hours*36e5).toISOString():null}

const ATTACHMENT_TYPES=["application/pdf","image/png","image/jpeg","image/webp"];
export const ATTACHMENT_MAX_BYTES=20971520;

export async function requestAttachmentUpload(ctx:any,input:{id:string;fileName:string;mimeType:string;sizeBytes:number}){
  if(!ctx.permissions?.includes("comms:create"))throw new Error("FORBIDDEN");
  const{data:a}=await ctx.admin.from("network_announcements").select("id,status,store_id").eq("id",input.id).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!a)throw new Error("ANNOUNCEMENT_NOT_FOUND");
  if(a.status!=="draft")throw new Error("STATUS_INVALID");
  if(!ATTACHMENT_TYPES.includes(input.mimeType))throw new Error("ATTACHMENT_TYPE_INVALID");
  const size=Number(input.sizeBytes);
  if(!(size>0&&size<=ATTACHMENT_MAX_BYTES))throw new Error("ATTACHMENT_TOO_LARGE");
  const name=String(input.fileName||"arquivo").replace(/[^\w.\- ]+/g,"_").slice(0,200),path=`${ctx.organizationId}/${a.id}/${crypto.randomUUID()}-${name}`;
  const{data:signed,error}=await ctx.admin.storage.from("internal-communications").createSignedUploadUrl(path);
  if(error)throw new Error(error.message);
  const attachment=mustData(await ctx.admin.from("comms_attachments").insert({organization_id:ctx.organizationId,announcement_id:a.id,storage_path:path,file_name:name,mime_type:input.mimeType,size_bytes:size,uploaded_by:ctx.actorId}).select("id,file_name,mime_type,size_bytes").single(),"registrar anexo");
  return{attachment,uploadUrl:signed.signedUrl,token:signed.token};
}

// An attachment follows the announcement's audience. Its link lasts five minutes and is issued only after this check.
export async function attachmentLink(ctx:any,input:{attachmentId:string}){
  const{data:file}=await ctx.admin.from("comms_attachments").select("*").eq("id",input.attachmentId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!file)throw new Error("ATTACHMENT_NOT_FOUND");
  const{data:receipt}=await ctx.admin.from("network_announcement_recipients").select("user_id").eq("announcement_id",file.announcement_id).eq("user_id",ctx.actorId).maybeSingle();
  if(!receipt){
    const{data:a}=await ctx.admin.from("network_announcements").select("store_id,scope_type,created_by").eq("id",file.announcement_id).single(),own=a?.created_by===ctx.actorId,sameStore=ctx.allStores||(a?.store_id&&ctx.storeIds?.includes(a.store_id));
    if(!(ctx.permissions?.includes("comms:view")&&(own||sameStore)))throw new Error("ATTACHMENT_NOT_FOUND");
  }
  const{data,error}=await ctx.admin.storage.from("internal-communications").createSignedUrl(file.storage_path,300);
  if(error)throw new Error(error.message);
  return{url:data.signedUrl,fileName:file.file_name};
}
