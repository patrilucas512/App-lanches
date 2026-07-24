"use client";

import { FormEvent, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type MenuProduct = { id: string; name: string; description?: string; image_url?: string; price_cents: number; featured?: boolean };
export type MenuCategory = { id: string; name: string; description?: string; products: MenuProduct[] };
export type PublicMenu = { establishment: { name: string; slug: string; accent_color: string }; settings: { delivery_enabled: boolean; pickup_enabled: boolean }; categories: MenuCategory[] };

export function PublicMenuView({ menu }: { menu: PublicMenu }) {
  const [cart, setCart] = useState<Record<string, { product: MenuProduct; quantity: number }>>({});
  const [checkout, setCheckout] = useState(false);
  const [message, setMessage] = useState("");
  const items = Object.values(cart);
  const total = useMemo(() => items.reduce((sum, item) => sum + item.product.price_cents * item.quantity, 0), [items]);
  const money = (cents: number) => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100);
  function add(product: MenuProduct) { setCart(current => ({ ...current, [product.id]: { product, quantity: (current[product.id]?.quantity ?? 0) + 1 } })); }
  async function order(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("Enviando pedido...");
    if (menu.establishment.slug === "demo") return setMessage("Esta é uma loja demonstrativa. Crie sua conta para receber pedidos reais.");
    const data = new FormData(event.currentTarget);
    const supabase = createClient();
    const { data: result, error } = await supabase.rpc("place_public_order", {
      requested_slug: menu.establishment.slug,
      buyer_name: String(data.get("name")),
      buyer_phone: String(data.get("phone")),
      requested_fulfillment: String(data.get("fulfillment")),
      requested_items: items.map(item => ({ product_id: item.product.id, quantity: item.quantity })),
      order_notes: String(data.get("notes") || ""),
    });
    if (error) return setMessage(error.message);
    setMessage(`Pedido #${result.order_number} recebido! Total ${money(result.total_cents)}.`);
    setCart({});
  }
  return <main className="menu-page" style={{ "--wine": menu.establishment.accent_color } as React.CSSProperties}>
    <header className="menu-cover"><span className="kicker">CARDÁPIO DIGITAL</span><h1>{menu.establishment.name}</h1><p>{menu.settings.delivery_enabled ? "Entrega disponível" : "Retirada disponível"} · pedido seguro e sem comissão</p></header>
    <section className="menu-content">{menu.categories.map(category => <div className="menu-category" key={category.id}><h2>{category.name}</h2>{category.description && <p>{category.description}</p>}<div className="product-grid">{category.products.map(product => <article className="product-card" key={product.id}><div className="product-info"><h3>{product.name}</h3><p>{product.description}</p><strong>{money(product.price_cents)}</strong><button className="add-button" onClick={() => add(product)}>Adicionar +</button></div><div className="product-image" style={product.image_url ? { backgroundImage: `url(${product.image_url})` } : undefined} /></article>)}</div></div>)}</section>
    {items.length > 0 && <button className="cart-bar" onClick={() => setCheckout(true)}><span>{items.reduce((sum,item)=>sum+item.quantity,0)} itens</span><b>Ver pedido · {money(total)}</b></button>}
    {checkout && <div className="checkout-overlay" onClick={() => setCheckout(false)}><aside className="checkout-card" onClick={event => event.stopPropagation()}><button className="checkout-close" onClick={() => setCheckout(false)}>×</button><h2>Finalizar pedido</h2><div className="cart-lines">{items.map(item => <span key={item.product.id}>{item.quantity}× {item.product.name}<b>{money(item.product.price_cents*item.quantity)}</b></span>)}</div><form className="form" onSubmit={order}><div className="field"><label>SEU NOME</label><input name="name" required /></div><div className="field"><label>WHATSAPP</label><input name="phone" required /></div><div className="field"><label>COMO QUER RECEBER?</label><select name="fulfillment"><option value="pickup">Retirar no local</option>{menu.settings.delivery_enabled && <option value="delivery">Entrega</option>}</select></div><div className="field"><label>OBSERVAÇÕES</label><textarea name="notes" /></div>{message && <div className={message.includes("recebido") ? "form-message form-success" : "form-message"}>{message}</div>}<button className="button dark wide">Confirmar · {money(total)}</button></form></aside></div>}
  </main>;
}
