"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type MenuProduct = { id: string; name: string; description?: string; image_url?: string; price_cents: number; featured?: boolean };
export type MenuCategory = { id: string; name: string; description?: string; products: MenuProduct[] };
export type PublicMenu = {
  establishment: { id: string; name: string; slug: string; description?: string; logo_url?: string; cover_url?: string; accent_color: string; secondary_color?: string };
  settings: { whatsapp?: string; delivery_enabled: boolean; pickup_enabled: boolean; minimum_order_cents?: number; estimated_minutes?: number; payment_methods?: string[] };
  banners?: { id: string; title: string; image_url: string; link_url?: string }[];
  categories: MenuCategory[];
};
type CompletedOrder = { orderId: string; orderNumber: number; totalCents: number; whatsappUrl: string };

export function PublicMenuView({ menu }: { menu: PublicMenu }) {
  const supabase = useMemo(() => createClient(), []);
  const cartStarted = useRef(false);
  const [cart, setCart] = useState<Record<string, { product: MenuProduct; quantity: number }>>({});
  const [checkout, setCheckout] = useState(false);
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState<CompletedOrder | null>(null);
  const items = Object.values(cart);
  const total = useMemo(() => items.reduce((sum, item) => sum + item.product.price_cents * item.quantity, 0), [items]);
  const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
  const record = (event: string, productId?: string, orderId?: string, valueCents?: number) => {
    if (menu.establishment.slug !== "demo") void supabase.rpc("record_public_event", {
      requested_slug: menu.establishment.slug, requested_event: event,
      requested_product: productId ?? null, requested_order: orderId ?? null,
      requested_value_cents: valueCents ?? null,
    });
  };
  useEffect(() => { record("menu_view"); }, []);
  function add(product: MenuProduct) {
    record("product_added", product.id);
    if (!cartStarted.current) { cartStarted.current = true; record("cart_started"); }
    setCart(current => ({ ...current, [product.id]: { product, quantity: (current[product.id]?.quantity ?? 0) + 1 } }));
  }
  function openCheckout() { record("checkout_started", undefined, undefined, total); setCheckout(true); }
  function whatsappMessage(orderNumber: number, buyerName: string, fulfillment: string, notes: string) {
    const lines = [
      `Olá! Quero confirmar o pedido #${orderNumber} no ${menu.establishment.name}.`,
      "", ...items.map(item => `${item.quantity}x ${item.product.name} — ${money(item.product.price_cents * item.quantity)}`),
      "", `Total: ${money(total)}`, `Cliente: ${buyerName}`,
      `Recebimento: ${fulfillment === "delivery" ? "Entrega" : "Retirada"}`,
    ];
    if (notes) lines.push(`Observações: ${notes}`);
    return lines.join("\n");
  }
  async function order(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("Preparando seu pedido...");
    if (menu.establishment.slug === "demo") return setMessage("Esta é uma loja demonstrativa. Crie sua conta para receber pedidos reais.");
    if (!menu.settings.whatsapp) return setMessage("O estabelecimento ainda não configurou o WhatsApp de pedidos.");
    const data = new FormData(event.currentTarget);
    const buyerName = String(data.get("name"));
    const fulfillment = String(data.get("fulfillment"));
    const notes = String(data.get("notes") || "");
    const { data: result, error } = await supabase.rpc("place_public_order", {
      requested_slug: menu.establishment.slug,
      buyer_name: buyerName,
      buyer_phone: String(data.get("phone")),
      requested_fulfillment: fulfillment,
      requested_items: items.map(item => ({ product_id: item.product.id, quantity: item.quantity })),
      order_notes: notes,
    });
    if (error) return setMessage(error.message);
    const number = String(menu.settings.whatsapp).replace(/\D/g, "");
    const text = whatsappMessage(result.order_number, buyerName, fulfillment, notes);
    setCompleted({
      orderId: result.order_id, orderNumber: result.order_number, totalCents: result.total_cents,
      whatsappUrl: `https://wa.me/${number}?text=${encodeURIComponent(text)}`,
    });
    setMessage("Pedido preparado. Falta somente confirmar o envio no WhatsApp.");
  }
  function sendToWhatsApp() {
    if (!completed) return;
    record("order_whatsapp", undefined, completed.orderId, completed.totalCents);
    window.open(completed.whatsappUrl, "_blank", "noopener,noreferrer");
    setMessage("WhatsApp aberto. O pedido será enviado quando você confirmar no aplicativo.");
    setCart({}); cartStarted.current = false;
  }
  return <main className="menu-page" style={{ "--wine": menu.establishment.accent_color, "--paper": menu.establishment.secondary_color ?? "#f5efe5" } as React.CSSProperties}>
    <header className="menu-cover" style={menu.establishment.cover_url ? { backgroundImage: `linear-gradient(120deg,rgba(28,14,13,.84),rgba(109,38,39,.72)),url(${menu.establishment.cover_url})` } : undefined}>
      {menu.establishment.logo_url && <img className="menu-logo" src={menu.establishment.logo_url} alt="" />}
      <span className="kicker">CARDÁPIO DIGITAL</span><h1>{menu.establishment.name}</h1>
      <p>{menu.establishment.description || `${menu.settings.delivery_enabled ? "Entrega e retirada" : "Retirada disponível"} · pedido direto, seguro e sem comissão`}</p>
      {menu.settings.estimated_minutes && <small>Tempo estimado: {menu.settings.estimated_minutes} min</small>}
    </header>
    {menu.banners?.length ? <section className="menu-banners">{menu.banners.map(banner => <a key={banner.id} href={banner.link_url || "#"} style={{ backgroundImage: `url(${banner.image_url})` }}><span>{banner.title}</span></a>)}</section> : null}
    <section className="menu-content">{menu.categories.map(category => <div className="menu-category" key={category.id}><h2>{category.name}</h2>{category.description && <p>{category.description}</p>}<div className="product-grid">{category.products.map(product => <article className="product-card" key={product.id}><div className="product-info"><h3>{product.name}</h3><p>{product.description}</p><strong>{money(product.price_cents)}</strong><button className="add-button" onClick={() => add(product)}>Adicionar +</button></div><div className="product-image" style={product.image_url ? { backgroundImage: `url(${product.image_url})` } : undefined} /></article>)}</div></div>)}</section>
    {items.length > 0 && <button className="cart-bar" onClick={openCheckout}><span>{items.reduce((sum, item) => sum + item.quantity, 0)} itens</span><b>Ver pedido · {money(total)}</b></button>}
    {checkout && <div className="checkout-overlay" onClick={() => setCheckout(false)}><aside className="checkout-card" onClick={event => event.stopPropagation()}><button className="checkout-close" onClick={() => setCheckout(false)}>×</button><h2>Finalizar pedido</h2><div className="cart-lines">{items.map(item => <span key={item.product.id}>{item.quantity}× {item.product.name}<b>{money(item.product.price_cents * item.quantity)}</b></span>)}</div><form className="form" onSubmit={order}><div className="field"><label>SEU NOME</label><input name="name" required /></div><div className="field"><label>WHATSAPP</label><input name="phone" required type="tel" /></div><div className="field"><label>COMO QUER RECEBER?</label><select name="fulfillment">{menu.settings.pickup_enabled && <option value="pickup">Retirar no local</option>}{menu.settings.delivery_enabled && <option value="delivery">Entrega</option>}</select></div><div className="field"><label>OBSERVAÇÕES</label><textarea name="notes" /></div>{message && <div className={completed ? "form-message form-success" : "form-message"}>{message}</div>}{completed ? <button type="button" className="button whatsapp wide" onClick={sendToWhatsApp}>Enviar pedido no WhatsApp →</button> : <button className="button dark wide">Preparar pedido · {money(total)}</button>}<small className="checkout-help">O pedido só será enviado após sua confirmação no WhatsApp.</small></form></aside></div>}
  </main>;
}
