import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DemandLoadService, OrderPromiseService } from "@/lib/capacity-management/core";

type CartItem={product_id?:string;quantity?:number};
type Body={action?:"reserve"|"commit"|"release";slug?:string;fulfillment?:string;items?:CartItem[];session_reference?:string;idempotency_key?:string;hold_id?:string;order_id?:string;tracking_token?:string};
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});
const safeId=(value:unknown)=>typeof value==="string"&&/^[0-9a-f-]{36}$/i.test(value)?value:"";

export async function POST(request:Request){
 try{
  const body=await request.json() as Body,admin=createAdminClient();
  if(!body.slug)return reply({error:"Estabelecimento não informado."},400);
  const{data:store}=await admin.from("establishments").select("id,organization_id,slug,active").eq("slug",body.slug).eq("active",true).maybeSingle();
  if(!store)return reply({error:"Estabelecimento não encontrado."},404);
  const org=store.organization_id||store.id;
  if(body.action==="commit"){
   const hold=safeId(body.hold_id),orderId=safeId(body.order_id),token=safeId(body.tracking_token),sessionHash=createHash("sha256").update(String(body.session_reference||"")).digest("hex");
   if(!hold||!orderId||!token)return reply({error:"Confirmação de capacidade incompleta."},400);
   const{data:order}=await admin.from("orders").select("id,tracking_token,establishment_id").eq("id",orderId).eq("tracking_token",token).eq("establishment_id",store.id).maybeSingle();
   if(!order)return reply({error:"Pedido não encontrado."},404);
   const{data:held}=await admin.from("capacity_slot_holds").select("id,slot_id,workload_reserved,status,store_id,session_reference_hash").eq("id",hold).eq("store_id",store.id).eq("session_reference_hash",sessionHash).maybeSingle();
   if(!held)return reply({error:"Reserva de capacidade não encontrada."},404);
   const{data:slot}=await admin.from("capacity_slots").select("id,starts_at,ends_at").eq("id",held.slot_id).single();
   const{data,error}=await admin.rpc("commit_capacity_slot_hold",{requested_hold:hold,requested_order:orderId,requested_org:org});
   if(error)return reply({committed:false,fallback:true,message:"Pedido confirmado; capacidade será reconciliada pela operação."});
   const promise=new OrderPromiseService().calculate({fulfillment:body.fulfillment==="delivery"?"delivery":"pickup",prepMin:Math.max(5,Math.ceil((Date.parse(slot.starts_at)-Date.now())/60000)),prepMax:Math.max(10,Math.ceil((Date.parse(slot.ends_at)-Date.now())/60000)),dispatchMin:body.fulfillment==="delivery"?5:0,travelMin:body.fulfillment==="delivery"?20:0,bufferMin:5,confidence:"medium"});
   await Promise.all([
    admin.from("orders").update({capacity_slot_id:slot.id,capacity_workload:held.workload_reserved,promised_ready_from:promise.window.from,promised_ready_to:promise.window.to,promised_delivery_from:body.fulfillment==="delivery"?promise.window.from:null,promised_delivery_to:body.fulfillment==="delivery"?promise.window.to:null,current_estimate_from:promise.window.from,current_estimate_to:promise.window.to}).eq("id",orderId),
    admin.from("order_promise_snapshots").upsert({organization_id:org,store_id:store.id,order_id:orderId,fulfillment_type:body.fulfillment||"pickup",original_ready_from:promise.window.from,original_ready_to:promise.window.to,original_delivery_from:body.fulfillment==="delivery"?promise.window.from:null,original_delivery_to:body.fulfillment==="delivery"?promise.window.to:null,current_estimate_from:promise.window.from,current_estimate_to:promise.window.to,confidence:promise.confidence,components:promise.components,source_version:"capacity_checkout_v1"},{onConflict:"store_id,order_id"})
   ]);
   return reply({committed:true,hold:data,promise});
  }
  if(body.action==="release"){
   const hold=safeId(body.hold_id);if(!hold)return reply({released:false});
   const{data:owned}=await admin.from("capacity_slot_holds").select("id,session_reference_hash").eq("id",hold).eq("store_id",store.id).maybeSingle();
   const sessionHash=createHash("sha256").update(String(body.session_reference||"")).digest("hex");
   if(!owned||owned.session_reference_hash!==sessionHash)return reply({released:false},404);
   await admin.rpc("release_capacity_slot_hold",{requested_hold:hold,requested_org:org});return reply({released:true});
  }
  const{data:flags}=await admin.from("store_feature_flags").select("capacity_management_enabled,capacity_slots_enabled,dynamic_order_promises_enabled").eq("establishment_id",store.id).maybeSingle();
  if(!flags?.capacity_management_enabled||!flags.capacity_slots_enabled)return reply({enabled:false,allow:true,fallback:"static_eta"});
  const items=(body.items||[]).filter(x=>safeId(x.product_id)&&Number(x.quantity)>0);
  if(!items.length)return reply({error:"Sacola vazia."},400);
  const ids=[...new Set(items.map(x=>String(x.product_id)))];
  const{data:profiles}=await admin.from("product_capacity_profiles").select("product_id,workload_units,estimated_prep_minutes,batchable,max_batch_size,profile_version").eq("store_id",store.id).in("product_id",ids).eq("review_status","approved").order("profile_version",{ascending:false});
  type Profile={product_id:string;workload_units:number;estimated_prep_minutes:number|null;batchable:boolean;max_batch_size:number|null;profile_version:number};
  const latest=new Map<string,Profile>();for(const p of (profiles||[]) as Profile[])if(!latest.has(p.product_id))latest.set(p.product_id,p);
  const workload=new DemandLoadService().orderWorkload(items.map(item=>{const p=latest.get(item.product_id);return{productId:String(item.product_id),quantity:Number(item.quantity),workloadUnits:Number(p?.workload_units||1),batchable:Boolean(p?.batchable),maxBatchSize:p?.max_batch_size||null}}));
  await Promise.all([admin.rpc("expire_capacity_slot_holds",{requested_store:store.id}),admin.rpc("refresh_capacity_slots",{requested_org:org,requested_store:store.id,requested_horizon_hours:8})]);
  const preferred=body.fulfillment==="delivery"?["delivery_dispatch","kitchen","store"]:body.fulfillment==="dine_in"?["dining_room","kitchen","store"]:["pickup","kitchen","store"];
  const{data:models}=await admin.from("capacity_models").select("resource_type,resource_id").eq("store_id",store.id).eq("active",true);
  const model=preferred.map(type=>(models||[]).find(m=>m.resource_type===type)).find(Boolean);
  if(!model)return reply({enabled:true,allow:true,fallback:"static_eta",confidence:"low"});
  const now=new Date().toISOString();let query=admin.from("capacity_slots").select("id,starts_at,ends_at,capacity_total,capacity_reserved,capacity_committed,status").eq("store_id",store.id).eq("resource_type",model.resource_type).gte("ends_at",now).in("status",["open","limited"]).order("starts_at").limit(12);query=model.resource_id?query.eq("resource_id",model.resource_id):query.is("resource_id",null);
  const{data:slots}=await query,slot=(slots||[]).find(s=>Number(s.capacity_total)-Number(s.capacity_reserved)-Number(s.capacity_committed)>=workload);
  if(!slot){const next=(slots||[]).find(s=>Number(s.capacity_total)>Number(s.capacity_committed));return reply({enabled:true,allow:false,reason:"capacity_full",message:next?`Próximo horário disponível após ${new Date(next.ends_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}.`:"A capacidade está completa no período. Tente novamente em alguns minutos.",next_available_at:next?.ends_at||null},409);}
  const session=String(body.session_reference||"");if(session.length<16||!body.idempotency_key)return reply({error:"Sessão de checkout inválida."},400);
  const{data:hold,error}=await admin.rpc("reserve_capacity_slot",{requested_slot:slot.id,requested_org:org,requested_store:store.id,requested_workload:workload,requested_session_hash:createHash("sha256").update(session).digest("hex"),requested_draft:String(body.idempotency_key),requested_idempotency:String(body.idempotency_key),requested_ttl_seconds:300});
  if(error)return reply({enabled:true,allow:false,reason:"capacity_changed",message:"Esse horário acabou de preencher. Escolha o próximo disponível."},409);
  const prep=(profiles||[]).reduce((m,p)=>Math.max(m,Number(p.estimated_prep_minutes||0)),0),wait=Math.max(0,Math.ceil((Date.parse(slot.starts_at)-Date.now())/60000)),promise=new OrderPromiseService().calculate({fulfillment:body.fulfillment==="delivery"?"delivery":"pickup",prepMin:Math.max(10,prep+wait),prepMax:Math.max(20,prep+wait+10),dispatchMin:body.fulfillment==="delivery"?5:0,travelMin:body.fulfillment==="delivery"?20:0,bufferMin:5,confidence:flags.dynamic_order_promises_enabled?"medium":"low"});
  return reply({enabled:true,allow:true,hold_id:hold.id,expires_at:hold.expires_at,workload,promise});
 }catch{return reply({enabled:false,allow:true,fallback:"conservative_static_eta",message:"Capacidade temporariamente indisponível; o pedido pode continuar com estimativa conservadora."});}
}
