"use client";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Row=Record<string,any>;
// O catálogo (saas_features) vem do banco; estes nomes e textos ficaram em inglês lá. A chave não muda.
const FEATURE_TEXT:Record<string,{name:string;description:string}>={
 feature_management:{name:"Gestão de funções",description:"Cadastro, configuração e avaliação segura das funções."},
 feature_management_advanced_rollouts:{name:"Gestão de funções · liberação gradual avançada",description:"Liberação de teste, liberação em etapas e verificação de saúde."},
 feature_management_ai:{name:"Gestão de funções · IA assistiva",description:"Copiloto explicativo sem poder de publicação."},
};
// O que acontece quando a loja passa do limite ou não tem a função no plano.
const FALLBACK:Record<string,string>={upgrade_prompt:"Sugere trocar de plano",block_create:"Bloqueia novos cadastros",block_send:"Bloqueia envios",block_upload:"Bloqueia envio de arquivos",read_only:"Fica só para consulta",human_handoff:"Passa para atendimento humano",rate_limit:"Limita a quantidade de uso"};
const featureName=(feature:Row)=>FEATURE_TEXT[feature.key]?.name??feature.name;
const featureDescription=(feature:Row)=>FEATURE_TEXT[feature.key]?.description??(feature.description||FALLBACK[feature.fallback_behavior]||feature.fallback_behavior);
export function SaasPlanFeatureEditor({planId,features,values}:{planId:string;features:Row[];values:Row[]}){
 const[index,setIndex]=useState<Record<string,Row>>(Object.fromEntries(values.map(x=>[x.feature_key,x])));const[message,setMessage]=useState("");
 async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();const f=new FormData(event.currentTarget);const rows=features.map(feature=>({plan_id:planId,feature_key:feature.key,enabled:f.get(`${feature.key}:enabled`)==="on",limit_value:f.get(`${feature.key}:limit`)===""?null:Number(f.get(`${feature.key}:limit`)),config:index[feature.key]?.config||{}}));const{error}=await createClient().from("saas_plan_features").upsert(rows,{onConflict:"plan_id,feature_key"});setMessage(error?.message||"Catálogo de recursos salvo e aplicado.");}
 return <details className="sa-plan-feature-editor"><summary>Configurar recursos e limites centralizados</summary><form onSubmit={save}><div className="sa-feature-grid">{features.map(feature=><label key={feature.key}><span><input name={`${feature.key}:enabled`} type="checkbox" defaultChecked={index[feature.key]?.enabled??false}/><b>{featureName(feature)}</b><small>{featureDescription(feature)}</small></span>{feature.value_type!=="boolean"&&<input name={`${feature.key}:limit`} type="number" min="0" step="any" placeholder="Ilimitado" defaultValue={index[feature.key]?.limit_value??""}/>}</label>)}</div><button className="sa-button">Salvar recursos</button>{message&&<small>{message}</small>}</form></details>
}

