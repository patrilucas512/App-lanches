"use client";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Row=Record<string,any>;
export function SaasPlanFeatureEditor({planId,features,values}:{planId:string;features:Row[];values:Row[]}){
 const[index,setIndex]=useState<Record<string,Row>>(Object.fromEntries(values.map(x=>[x.feature_key,x])));const[message,setMessage]=useState("");
 async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();const f=new FormData(event.currentTarget);const rows=features.map(feature=>({plan_id:planId,feature_key:feature.key,enabled:f.get(`${feature.key}:enabled`)==="on",limit_value:f.get(`${feature.key}:limit`)===""?null:Number(f.get(`${feature.key}:limit`)),config:index[feature.key]?.config||{}}));const{error}=await createClient().from("saas_plan_features").upsert(rows,{onConflict:"plan_id,feature_key"});setMessage(error?.message||"Catálogo de recursos salvo e aplicado pelo EntitlementService.");}
 return <details className="sa-plan-feature-editor"><summary>Configurar recursos e limites centralizados</summary><form onSubmit={save}><div className="sa-feature-grid">{features.map(feature=><label key={feature.key}><span><input name={`${feature.key}:enabled`} type="checkbox" defaultChecked={index[feature.key]?.enabled??false}/><b>{feature.name}</b><small>{feature.description||feature.fallback_behavior}</small></span>{feature.value_type!=="boolean"&&<input name={`${feature.key}:limit`} type="number" min="0" step="any" placeholder="Ilimitado" defaultValue={index[feature.key]?.limit_value??""}/>}</label>)}</div><button className="sa-button">Salvar recursos</button>{message&&<small>{message}</small>}</form></details>
}

