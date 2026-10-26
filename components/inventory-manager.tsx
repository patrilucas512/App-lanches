"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AdminButton, AdminField, AdminInput, AdminSelect, AdminModal, AdminBadge } from "@/components/admin-ui";

type Item = { id:string; name:string; sku?:string|null; unit:string; balance:number; minimum:number; maximum?:number|null; safety_stock?:number; average_cost_cents?:number; last_cost_cents?:number; block_insufficient:boolean; track_stock?:boolean; auto_disable_on_stockout?:boolean; internally_produced?:boolean; warehouse_type?:string; active:boolean };
type Product = {id:string;name:string};
type Recipe = {stock_item_id:string;quantity:number;recipe_unit?:string;addon_name:string;removable_name:string;inventory_items?:{name:string;unit:string}};
type Movement = {id:string;quantity:number;balance_after:number;kind:string;reason:string;actor_name:string;actor_id:string|null;source_kind:string|null;created_at:string;inventory_items:{name:string;unit:string}};
const fmt=(n:number)=>Number(n).toLocaleString("pt-BR",{maximumFractionDigits:4});
const kinds:Record<string,string>={entry:"Entrada",loss:"Perda",adjust_in:"Ajuste de entrada",adjust_out:"Ajuste de saída",sale:"Baixa de pedido",return:"Devolução por cancelamento"};
const units:Record<string,string>={un:"Unidade",g:"Grama",kg:"Quilograma",ml:"Mililitro",l:"Litro",pacote:"Pacote",caixa:"Caixa",porcao:"Porção"};
const blank={id:"",name:"",sku:"",unit:"un",balance:0,minimum:0,maximum:null,safety_stock:0,block_insufficient:false,track_stock:true,auto_disable_on_stockout:false,internally_produced:false,warehouse_type:"store",active:true};

export function InventoryManager({establishmentId}:{establishmentId:string}) {
 const db=useMemo(()=>createClient(),[]);
 const [tab,setTab]=useState("items"),[search,setSearch]=useState(""),[page,setPage]=useState(0),[count,setCount]=useState(0);
 const [lowOnly,setLowOnly]=useState(false);
 const [items,setItems]=useState<Item[]>([]),[history,setHistory]=useState<Movement[]>([]);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
 const [editing,setEditing]=useState<Item|null>(null),[moving,setMoving]=useState<Item|null>(null),[archiving,setArchiving]=useState<Item|null>(null);
 const requestKey=useRef("");
 const [productSearch,setProductSearch]=useState(""),[products,setProducts]=useState<Product[]>([]),[product,setProduct]=useState<Product|null>(null);
 const [stockSearch,setStockSearch]=useState(""),[options,setOptions]=useState<Item[]>([]),[recipe,setRecipe]=useState<Recipe[]>([]);
 const [recipeBusy,setRecipeBusy]=useState(false);
 const generation=useRef(0);
 const load=useCallback(async()=>{
  const current=++generation.current;setLoading(true);setError("");
  if(tab==="recipes"){setLoading(false);return;}
  if(tab==="items"){
   let query=db.from("inventory_items").select("*",{count:"exact"}).eq("establishment_id",establishmentId);
   if(lowOnly)query=query.eq("needs_restock",true);
   if(search.trim())query=query.ilike("name",`%${search.trim()}%`);
   const {data,error,count}=await query.order("active",{ascending:false}).order("name").range(page*20,page*20+19);
   if(current!==generation.current)return;
   if(error)setError(error.message);else{setItems((data||[]) as Item[]);setCount(count||0);}
  }else{
   let query=db.from("inventory_movements").select("id,quantity,balance_after,kind,reason,actor_name,actor_id,source_kind,created_at,inventory_items(name,unit)",{count:"exact"}).eq("establishment_id",establishmentId);
   if(search.trim())query=query.ilike("reason",`%${search.trim()}%`);
   const {data,error,count}=await query.order("created_at",{ascending:false}).order("id",{ascending:false}).range(page*20,page*20+19);
   if(current!==generation.current)return;
   if(error)setError(error.message);else{setHistory((data||[]) as unknown as Movement[]);setCount(count||0);}
  }
  setLoading(false);
 },[db,establishmentId,page,search,tab,lowOnly]);
 useEffect(()=>{const timer=setTimeout(()=>void load(),250);return()=>{clearTimeout(timer);generation.current++;};},[load]);
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==="visible"&&!busy&&!editing&&!moving&&!archiving)void load();},30000);return()=>clearInterval(timer);},[load,busy,editing,moving,archiving]);
 useEffect(()=>{
  if(tab!=="recipes")return;let disposed=false;
  const timer=setTimeout(async()=>{
   const {data,error}=await db.from("products").select("id,name").eq("establishment_id",establishmentId).ilike("name",`%${productSearch.trim()}%`).order("name").limit(40);
   if(!disposed){if(error)setError(error.message);else setProducts(data||[]);}
  },200);return()=>{disposed=true;clearTimeout(timer);};
 },[db,establishmentId,productSearch,tab]);
 useEffect(()=>{
  if(tab!=="recipes")return;let disposed=false;
  const timer=setTimeout(async()=>{
   const {data,error}=await db.from("inventory_items").select("*").eq("establishment_id",establishmentId).eq("active",true).ilike("name",`%${stockSearch.trim()}%`).order("name").limit(40);
   if(!disposed){if(error)setError(error.message);else setOptions((data||[]) as Item[]);}
  },200);return()=>{disposed=true;clearTimeout(timer);};
 },[db,establishmentId,stockSearch,tab]);
 async function saveItem(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!editing||busy)return;setBusy(true);setError("");
  const {error}=await db.rpc("inventory_save_item_v2",{requested_establishment_id:establishmentId,requested_item_id:editing.id||null,requested_payload:{name:editing.name,sku:editing.sku||"",unit:editing.unit,minimum:editing.minimum,maximum:editing.maximum??"",safety_stock:editing.safety_stock||0,block_insufficient:editing.block_insufficient,track_stock:editing.track_stock!==false,auto_disable_on_stockout:Boolean(editing.auto_disable_on_stockout),internally_produced:Boolean(editing.internally_produced),warehouse_type:editing.warehouse_type||"store",active:editing.active}});
  if(error)setError(error.message);else{setEditing(null);setMessage("Item salvo. Registre uma entrada para informar o saldo físico.");await load();}setBusy(false);
 }
 async function adjust(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!moving||busy)return;setBusy(true);setError("");
  const data=new FormData(e.currentTarget);
  const {error}=await db.rpc("inventory_adjust",{tenant:establishmentId,item_id:moving.id,amount:Number(data.get("amount")),movement_kind:String(data.get("kind")),note:String(data.get("reason")),request_key:requestKey.current});
  if(error)setError(error.message);else{setMoving(null);setMessage("Movimentação registrada no histórico.");await load();}setBusy(false);
 }
 async function archive(){
  if(!archiving||busy)return;setBusy(true);setError("");
  const i=archiving;
  const {error}=await db.rpc("inventory_save_item",{tenant:establishmentId,item_id:i.id,item_name:i.name,item_unit:i.unit,item_minimum:i.minimum,block_stock:i.block_insufficient,is_active:!i.active});
  if(error)setError(error.message);else{setArchiving(null);setMessage(i.active?"Item arquivado. Histórico preservado.":"Item reativado.");await load();}setBusy(false);
 }
 async function selectProduct(p:Product){
  setProduct(p);setRecipe([]);setRecipeBusy(true);setError("");
  const {data,error}=await db.from("inventory_recipes").select("stock_item_id,quantity,addon_name,removable_name,inventory_items(name,unit)").eq("establishment_id",establishmentId).eq("product_id",p.id).order("id");
  if(error){setError(error.message);setProduct(null);}else setRecipe((data||[]) as unknown as Recipe[]);setRecipeBusy(false);
 }
 async function saveRecipe(){
  if(!product||busy||recipeBusy)return;setBusy(true);setError("");
  const {error}=await db.rpc("inventory_save_recipe_v2",{requested_establishment_id:establishmentId,requested_product_id:product.id,requested_recipe:recipe.map(({stock_item_id,quantity,recipe_unit,addon_name,removable_name,inventory_items})=>({stock_item_id,quantity,unit:recipe_unit||inventory_items?.unit,addon_name,removable_name}))});
  if(error)setError(error.message);else setMessage("Ficha técnica salva. Aplicada somente a novos pedidos.");setBusy(false);
 }
 function changeRecipe(index:number,values:Partial<Recipe>){setRecipe(rows=>rows.map((r,i)=>i===index?{...r,...values}:r));}
 return <section className="inventory-manager">
  <div className="inventory-note"><b>Comece pelo saldo físico</b><p>Cadastre o item, registre uma entrada e vincule-o aos produtos em Fichas técnicas. Para uma bebida, vincule 1 unidade. Para um lanche, informe o consumo de cada ingrediente na unidade cadastrada.</p><p>O saldo disponível desconta pedidos criados, inclusive Pix aguardando pagamento. Cancelar antes do preparo devolve o consumo. Após preparo ou estorno no caixa, confira os itens e registre o ajuste manual. Vendas antigas e produtos sem vínculo não movimentam estoque.</p></div>
  <nav className="inventory-tabs" aria-label="Áreas do estoque">{[["items","Saldo e reposição"],["recipes","Fichas técnicas"],["history","Histórico"]].map(([value,label])=><AdminButton key={value} variant={tab===value?"primary":"secondary"} onClick={()=>{setTab(value);setPage(0);setSearch("");setError("");setMessage("");}}>{label}</AdminButton>)}</nav>
  {message&&<p role="status" className="form-message">{message}</p>}
  {tab==="items"&&<label><input type="checkbox" checked={lowOnly} onChange={e=>{setLowOnly(e.target.checked);setPage(0);}}/> Mostrar apenas itens que precisam de reposição</label>}
  {error&&<div role="alert" className="form-message">{error} <AdminButton variant="secondary" onClick={()=>void load()}>Tentar novamente</AdminButton></div>}
  {tab!=="recipes"&&<div className="inventory-toolbar"><AdminInput aria-label="Buscar no estoque" placeholder={tab==="items"?"Buscar item ou ingrediente...":"Buscar motivo da movimentação..."} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/><AdminButton variant="secondary" onClick={()=>void load()}>Atualizar</AdminButton>{tab==="items"&&<AdminButton onClick={()=>{setError("");setEditing({...blank});}}>+ Novo item</AdminButton>}</div>}
  {loading?<p role="status">Carregando estoque...</p>:tab==="items"?<div className="inventory-table"><table><thead><tr><th>Item</th><th>Saldo disponível</th><th>Mínimo</th><th>Situação</th><th>Ações</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td><b>{i.name}</b><small>{i.block_insufficient?"Bloqueia pedido sem saldo":"Permite saldo negativo"}</small></td><td>{fmt(i.balance)} {i.unit}</td><td>{fmt(i.minimum)} {i.unit}</td><td><AdminBadge tone={!i.active?"neutral":Number(i.balance)<=Number(i.minimum)?"warning":"success"}>{!i.active?"Arquivado":Number(i.balance)<=Number(i.minimum)?"Repor estoque":"Disponível"}</AdminBadge></td><td><div className="button-row"><AdminButton size="small" onClick={()=>{requestKey.current=crypto.randomUUID();setError("");setMoving(i);}}>Movimentar</AdminButton><AdminButton size="small" variant="secondary" onClick={()=>{setError("");setEditing({...i});}}>Editar</AdminButton><AdminButton size="small" variant="ghost" onClick={()=>{setError("");setArchiving(i);}}>{i.active?"Arquivar":"Reativar"}</AdminButton></div></td></tr>)}</tbody></table>{!items.length&&<p className="empty-state">Nenhum item encontrado. Cadastre o primeiro item para começar.</p>}</div>:tab==="history"?<div className="inventory-table"><table><thead><tr><th>Data / responsável</th><th>Item</th><th>Movimento</th><th>Quantidade</th><th>Saldo após</th><th>Motivo</th></tr></thead><tbody>{history.map(m=><tr key={m.id}><td>{new Date(m.created_at).toLocaleString("pt-BR")}<small>{m.actor_name}{m.actor_id?" · "+m.actor_id.slice(0,8):""}</small></td><td>{m.inventory_items?.name}</td><td>{kinds[m.kind]}<small>{m.source_kind==="pos"?"Caixa":m.source_kind==="table"?"Garçom":m.source_kind==="order"?"Cardápio":"Manual"}</small></td><td>{Number(m.quantity)>0?"+":""}{fmt(m.quantity)} {m.inventory_items?.unit}</td><td>{fmt(m.balance_after)}</td><td>{m.reason}</td></tr>)}</tbody></table>{!history.length&&<p className="empty-state">Nenhuma movimentação encontrada.</p>}</div>:null}
  {tab!=="recipes"&&<footer className="inventory-pagination"><AdminButton variant="secondary" disabled={!page||loading} onClick={()=>setPage(p=>p-1)}>Anterior</AdminButton><span>Página {page+1} · {count} registros</span><AdminButton variant="secondary" disabled={(page+1)*20>=count||loading} onClick={()=>setPage(p=>p+1)}>Próxima</AdminButton></footer>}
  {tab==="recipes"&&<div className="inventory-recipes"><section className="panel"><h2>Escolha o produto</h2><AdminInput aria-label="Buscar produto para ficha técnica" placeholder="Buscar produto..." value={productSearch} onChange={e=>setProductSearch(e.target.value)}/><small>Até 40 resultados por busca. Refine pelo nome.</small><div className="inventory-product-list">{products.map(p=><AdminButton key={p.id} variant={p.id===product?.id?"primary":"secondary"} disabled={recipeBusy||busy} onClick={()=>void selectProduct(p)}>{p.name}</AdminButton>)}</div></section>
   <section className="panel"><h2>{product?.name||"Ficha técnica"}</h2>{!product?<p>Selecione um produto para definir a baixa automática.</p>:recipeBusy?<p role="status">Carregando ficha...</p>:<>
    <p>Quantidade por unidade vendida. A conversão entre kg/g e l/ml é automática; conversões de pacote, caixa e porção usam a regra cadastrada do insumo.</p>
    <AdminInput aria-label="Buscar insumo para adicionar" placeholder="Buscar item do estoque..." value={stockSearch} onChange={e=>setStockSearch(e.target.value)}/>
    <AdminSelect aria-label="Adicionar insumo à ficha" value="" onChange={e=>{const i=options.find(i=>i.id===e.target.value);if(i)setRecipe(rows=>[...rows,{stock_item_id:i.id,quantity:1,addon_name:"",removable_name:"",inventory_items:{name:i.name,unit:i.unit}}]);}}><option value="">+ Adicionar item (até 40 resultados por busca)</option>{options.map(i=><option value={i.id} key={i.id}>{i.name} · {i.unit}</option>)}</AdminSelect>
    {recipe.map((r,index)=><div className="inventory-recipe-row" key={index}><b>{r.inventory_items?.name} ({r.inventory_items?.unit})</b><AdminField label="Quantidade"><AdminInput type="number" min="0.0001" step="0.0001" value={r.quantity} onChange={e=>changeRecipe(index,{quantity:Number(e.target.value)})}/></AdminField><AdminField label="Unidade usada"><AdminSelect value={r.recipe_unit||r.inventory_items?.unit||"un"} onChange={e=>changeRecipe(index,{recipe_unit:e.target.value})}>{Object.entries(units).map(([key,label])=><option key={key} value={key}>{label}</option>)}</AdminSelect></AdminField><AdminField label="Quando consumir"><AdminSelect value={r.addon_name?"addon":r.removable_name?"removable":"always"} onChange={e=>changeRecipe(index,{addon_name:e.target.value==="addon"?"Nome do adicional":"",removable_name:e.target.value==="removable"?"Nome do ingrediente":""})}><option value="always">Sempre</option><option value="addon">Adicional escolhido</option><option value="removable">Ingrediente retirável</option></AdminSelect></AdminField>{(r.addon_name||r.removable_name)&&<AdminField label="Nome exato no cardápio"><AdminInput value={r.addon_name||r.removable_name} onChange={e=>changeRecipe(index,r.addon_name?{addon_name:e.target.value}:{removable_name:e.target.value})}/></AdminField>}<AdminButton variant="danger" size="small" onClick={()=>setRecipe(rows=>rows.filter((_,i)=>i!==index))}>Remover vínculo</AdminButton></div>)}
    {!recipe.length&&<p>Sem vínculos: este produto não movimenta estoque.</p>}<AdminButton disabled={busy||recipe.some(r=>!(r.quantity>0))} onClick={()=>void saveRecipe()}>{busy?"Salvando...":"Salvar ficha técnica"}</AdminButton>
   </>}</section></div>}
  <AdminModal open={!!editing} title={editing?.id?"Editar item":"Novo item de estoque"} onClose={()=>!busy&&setEditing(null)}>{editing&&<form className="form" onSubmit={saveItem}><AdminField label="Nome"><AdminInput required minLength={2} maxLength={120} value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></AdminField><AdminField label="SKU"><AdminInput value={editing.sku||""} onChange={e=>setEditing({...editing,sku:e.target.value})}/></AdminField><AdminField label="Unidade de controle"><AdminSelect value={editing.unit} disabled={Boolean(editing.id)} onChange={e=>setEditing({...editing,unit:e.target.value})}>{Object.entries(units).map(([key,label])=><option key={key} value={key}>{label} ({key})</option>)}</AdminSelect></AdminField><AdminField label="Estoque mínimo"><AdminInput required type="number" min="0" step="0.0001" value={editing.minimum} onChange={e=>setEditing({...editing,minimum:Number(e.target.value)})}/></AdminField><AdminField label="Estoque máximo"><AdminInput type="number" min="0" step="0.0001" value={editing.maximum??""} onChange={e=>setEditing({...editing,maximum:e.target.value===""?null:Number(e.target.value)})}/></AdminField><AdminField label="Estoque de segurança"><AdminInput type="number" min="0" step="0.0001" value={editing.safety_stock||0} onChange={e=>setEditing({...editing,safety_stock:Number(e.target.value)})}/></AdminField><AdminField label="Local"><AdminSelect value={editing.warehouse_type||"store"} onChange={e=>setEditing({...editing,warehouse_type:e.target.value})}><option value="store">Unidade</option><option value="central">Depósito central</option></AdminSelect></AdminField><label><input type="checkbox" checked={editing.block_insufficient} onChange={e=>setEditing({...editing,block_insufficient:e.target.checked})}/> Bloquear novos pedidos quando não houver saldo</label><label><input type="checkbox" checked={editing.track_stock!==false} onChange={e=>setEditing({...editing,track_stock:e.target.checked})}/> Controlar saldo</label><label><input type="checkbox" checked={Boolean(editing.auto_disable_on_stockout)} onChange={e=>setEditing({...editing,auto_disable_on_stockout:e.target.checked})}/> Permitir indisponibilidade automática quando a ficha estiver completa</label><label><input type="checkbox" checked={Boolean(editing.internally_produced)} onChange={e=>setEditing({...editing,internally_produced:e.target.checked})}/> Insumo produzido internamente</label><p>O saldo só muda por movimentação auditada. Comece registrando uma entrada.</p>{error&&<p role="alert">{error}</p>}<AdminButton type="submit" disabled={busy}>{busy?"Salvando...":"Salvar item"}</AdminButton></form>}</AdminModal>
  <AdminModal open={!!moving} title={`Movimentar ${moving?.name||""}`} onClose={()=>!busy&&setMoving(null)}>{moving&&<form className="form" onSubmit={adjust}><p>Saldo disponível: {fmt(moving.balance)} {moving.unit}</p><AdminField label="Tipo"><AdminSelect name="kind">{["entry","loss","adjust_in","adjust_out"].map(k=><option key={k} value={k}>{kinds[k]}</option>)}</AdminSelect></AdminField><AdminField label={`Quantidade em ${moving.unit}`}><AdminInput required name="amount" type="number" min="0.0001" step="0.0001"/></AdminField><AdminField label="Motivo / documento"><AdminInput required name="reason" minLength={3} maxLength={500} placeholder="Ex.: compra recebida, nota 123"/></AdminField>{error&&<p role="alert">{error}</p>}<AdminButton type="submit" disabled={busy}>{busy?"Registrando...":"Registrar movimentação"}</AdminButton></form>}</AdminModal>
  <AdminModal open={!!archiving} title={archiving?.active?"Arquivar item?":"Reativar item?"} onClose={()=>!busy&&setArchiving(null)}><p>O histórico será preservado. Para arquivar, o saldo deve estar zerado e o item não pode estar vinculado a produtos.</p>{error&&<p role="alert">{error}</p>}<div className="button-row"><AdminButton variant="secondary" onClick={()=>setArchiving(null)}>Cancelar</AdminButton><AdminButton disabled={busy} onClick={()=>void archive()}>Confirmar</AdminButton></div></AdminModal>
 </section>;
}
