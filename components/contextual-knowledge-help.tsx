"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect,useState } from "react";

type HelpArticle={id:string;title:string;summary?:string;article_type:string;current_version:number};
export function ContextualKnowledgeHelp({storeId}:{storeId:string}){
 const pathname=usePathname(),[open,setOpen]=useState(false),[loading,setLoading]=useState(false),[articles,setArticles]=useState<HelpArticle[]>([]);
 useEffect(()=>{if(!open)return;const controller=new AbortController();setLoading(true);fetch(`/api/knowledge?store_id=${encodeURIComponent(storeId)}&context_route=${encodeURIComponent(pathname)}`,{signal:controller.signal,cache:"no-store"}).then(r=>r.json()).then(x=>setArticles(Array.isArray(x.articles)?x.articles:[])).catch(()=>setArticles([])).finally(()=>setLoading(false));return()=>controller.abort()},[open,pathname,storeId]);
 return <><button className="knowledge-help-trigger" type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open} aria-controls="knowledge-help-panel">? Ajuda</button>{open&&<aside id="knowledge-help-panel" className="knowledge-help-panel" aria-label="Ajuda contextual"><header><div><small>AJUDA DESTA TELA</small><h2>Procedimentos relacionados</h2></div><button type="button" onClick={()=>setOpen(false)} aria-label="Fechar">×</button></header>{loading?<p>Buscando conteúdo autorizado…</p>:articles.length?<div className="knowledge-help-list">{articles.map(a=><Link href={`/painel/conhecimento/${a.id}`} key={a.id}><b>{a.title}</b><span>{a.summary||"Abrir procedimento"}</span><small>{a.article_type} · versão {a.current_version}</small></Link>)}</div>:<p>Nenhum procedimento publicado foi relacionado a esta tela.</p>}<Link className="knowledge-help-all" href="/painel/conhecimento">Abrir Central de Conhecimento</Link></aside>}</>;
}
