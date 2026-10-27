import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { secureHash } from "@/lib/customer-portal";

const money=(cents=0)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100);

export default async function MagicOrderPage({params}:{params:Promise<{slug:string;token:string}>}){
  const {slug,token}=await params;
  const {data,error}=await createAdminClient().rpc("get_customer_magic_order",{requested_slug:slug,requested_token_hash:secureHash(`magic:${token}`)});
  if(error||!data)notFound();
  const view=data as {store_name:string;accent_color:string;order:{order_number:number;status:string;total_cents:number;created_at:string;items:Array<{name:string;quantity:number;total_cents:number}>}};
  return <main className="customer-portal-login" style={{"--portal-accent":view.accent_color} as React.CSSProperties}><section className="portal-login-card"><div><p className="eyebrow">ACOMPANHAMENTO TEMPORÁRIO</p><h1>Pedido #{view.order.order_number}</h1><p>{view.store_name} · acesso válido somente para este pedido.</p></div><span className={`portal-status ${view.order.status}`}>{view.order.status}</span>{view.order.items.map((item,index)=><div className="portal-row" key={index}><span>{item.quantity}× {item.name}</span><b>{money(item.total_cents)}</b></div>)}<div className="portal-order-total"><span>Total</span><strong>{money(view.order.total_cents)}</strong></div><a href={`/conta/${slug}`}>Entrar na minha conta</a></section></main>;
}
