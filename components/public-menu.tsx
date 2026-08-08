"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Addon = { name: string; price_cents: number };
export type MenuProduct = { id: string; name: string; description?: string; image_url?: string; price_cents: number; featured?: boolean; ingredients?: string[]; addon_options?: Addon[] };
export type MenuCategory = { id: string; name: string; description?: string; products: MenuProduct[] };
export type PublicMenu = {
  establishment: { id?: string; name: string; slug: string; description?: string; logo_url?: string; cover_url?: string; accent_color: string; secondary_color?: string };
  settings: { whatsapp?: string; delivery_enabled: boolean; pickup_enabled: boolean; minimum_order_cents?: number; estimated_minutes?: number; payment_methods?: string[] };
  banners?: { id: string; title: string; image_url: string; link_url?: string }[];
  categories: MenuCategory[];
  service_mode?: { mode: string; waiter_mode_enabled: boolean; table_service_enabled: boolean; counter_pickup_enabled: boolean; delivery_enabled: boolean; customer_self_order_enabled: boolean; waiter_call_enabled: boolean; bill_closing_enabled: boolean; accepted_payment_methods: string[]; active_waiters: number };
};
type CartItem = { key: string; product: MenuProduct; quantity: number; addons: Addon[]; removedIngredients: string[]; notes: string; unitPrice: number };
type QrTable = { table_id: string; table_number: string; table_name?: string; waiter_calls_enabled: boolean };

export function PublicMenuView({ menu, tableNumber, source }: { menu: PublicMenu; tableNumber?: string; source?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const cartStarted = useRef(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customizing, setCustomizing] = useState<MenuProduct | null>(null);
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);
  const [removedIngredients, setRemovedIngredients] = useState<string[]>([]);
  const [itemNotes, setItemNotes] = useState("");
  const [itemQuantity, setItemQuantity] = useState(1);
  const [checkout, setCheckout] = useState(false);
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState<{ number: number; total: number } | null>(null);
  const [qrTable, setQrTable] = useState<QrTable | null>(null);
  const [waiterOpen, setWaiterOpen] = useState(false);
  const [waiterMessage, setWaiterMessage] = useState("");
  const [fulfillment, setFulfillment] = useState(tableNumber ? "dine_in" : "");
  const service = menu.service_mode ?? { mode: "mixed", waiter_mode_enabled: true, table_service_enabled: true, counter_pickup_enabled: menu.settings.pickup_enabled, delivery_enabled: menu.settings.delivery_enabled, customer_self_order_enabled: true, waiter_call_enabled: true, bill_closing_enabled: true, accepted_payment_methods: menu.settings.payment_methods || [], active_waiters: 0 };
  const selectedFulfillment = fulfillment || (service.table_service_enabled ? "dine_in" : service.counter_pickup_enabled ? "pickup" : "delivery");
  const total = useMemo(() => cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0), [cart]);
  const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
  const record = (event: string, productId?: string, orderId?: string, valueCents?: number) => { if (menu.establishment.slug !== "demo") void supabase.rpc("record_public_event", { requested_slug: menu.establishment.slug, requested_event: event, requested_product: productId ?? null, requested_order: orderId ?? null, requested_value_cents: valueCents ?? null }); };

  useEffect(() => {
    record("menu_view");
    if (source === "qr" || tableNumber) void supabase.rpc("record_qr_scan", { requested_slug: menu.establishment.slug, requested_table_number: tableNumber ?? null, requested_source: source === "qr" ? "qr" : "print", requested_user_agent: navigator.userAgent }).then(({ data }) => { if (data?.table_id) setQrTable(data as QrTable); });
  }, []);

  function openProduct(product: MenuProduct) { setCustomizing(product); setSelectedAddons([]); setRemovedIngredients([]); setItemNotes(""); setItemQuantity(1); }
  function addCustomized() {
    if (!customizing) return;
    const addons = (customizing.addon_options || []).filter(addon => selectedAddons.includes(addon.name));
    const key = `${customizing.id}-${crypto.randomUUID()}`;
    const unitPrice = customizing.price_cents + addons.reduce((sum, addon) => sum + addon.price_cents, 0);
    setCart(current => [...current, { key, product: customizing, quantity: itemQuantity, addons, removedIngredients, notes: itemNotes.trim(), unitPrice }]);
    record("product_added", customizing.id); if (!cartStarted.current) { cartStarted.current = true; record("cart_started"); }
    setCustomizing(null);
  }
  function changeQuantity(key: string, delta: number) { setCart(current => current.map(item => item.key === key ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item).filter(item => item.quantity > 0)); }

  async function order(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("Enviando o pedido para a cozinha..."); setCompleted(null);
    if (menu.establishment.slug === "demo") return setMessage("Esta é uma loja demonstrativa. Crie sua conta para receber pedidos reais.");
    const data = new FormData(event.currentTarget); const buyerName = String(data.get("name")); const chosenFulfillment = String(data.get("fulfillment")); const tableLabel = String(data.get("table_label") || "").trim();
    if (chosenFulfillment === "dine_in" && buyerName.trim().split(/\s+/).length < 2) return setMessage("Informe nome e sobrenome para identificar a mesa.");
    if (chosenFulfillment === "dine_in" && !tableLabel) return setMessage("Informe o número ou nome da mesa onde você está.");
    const { data: result, error } = await supabase.rpc("place_public_order", { requested_slug: menu.establishment.slug, buyer_name: buyerName, buyer_phone: String(data.get("phone")), requested_fulfillment: chosenFulfillment, requested_items: cart.map(item => ({ product_id: item.product.id, quantity: item.quantity, addons: item.addons.map(addon => ({ name: addon.name })), removed_ingredients: item.removedIngredients, notes: item.notes })), order_notes: String(data.get("notes") || ""), requested_table_number: chosenFulfillment === "dine_in" ? tableLabel : null, requested_source: source === "qr" || qrTable ? "qr" : "direct", requested_payment: String(data.get("payment") || "") });
    if (error) return setMessage(error.message);
    record("order_whatsapp", undefined, result.order_id, result.total_cents);
    setCompleted({ number: result.order_number, total: result.total_cents }); setMessage(`Pedido #${result.order_number} enviado para a cozinha com sucesso.`); setCart([]); cartStarted.current = false;
  }

  async function callWaiter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWaiterMessage("Enviando chamado..."); const data = new FormData(event.currentTarget);
    const label = qrTable?.table_number || String(data.get("table_label") || "").trim();
    const { data: result, error } = await supabase.rpc("create_waiter_call", { requested_slug: menu.establishment.slug, requested_table_number: label, requested_note: String(data.get("note") || "") });
    setWaiterMessage(error ? error.message : result?.duplicate ? "Seu chamado já está aguardando atendimento." : `Garçom chamado para a mesa ${label}!`);
  }

  return <main className="menu-page" style={{ "--wine": menu.establishment.accent_color, "--paper": menu.establishment.secondary_color ?? "#f5efe5" } as React.CSSProperties}>
    <header className="menu-cover" style={menu.establishment.cover_url ? { backgroundImage: `linear-gradient(120deg,rgba(28,14,13,.84),rgba(109,38,39,.72)),url(${menu.establishment.cover_url})` } : undefined}>{menu.establishment.logo_url && <img className="menu-logo" src={menu.establishment.logo_url} alt="" />}<span className="kicker">CARDÁPIO DIGITAL</span><h1>{menu.establishment.name}</h1><p>{menu.establishment.description || "Escolha, personalize e envie seu pedido direto para a cozinha."}</p>{menu.settings.estimated_minutes && <small>Tempo estimado: {menu.settings.estimated_minutes} min</small>}</header>
    {(service.waiter_call_enabled && service.waiter_mode_enabled && service.active_waiters > 0) && <button className="floating-waiter-button" onClick={() => setWaiterOpen(true)}>🔔 Chamar garçom</button>}
    <section className="service-mode-notice"><div><small>ATENDIMENTO</small><strong>{service.waiter_mode_enabled ? "Peça pelo celular ou chame um garçom." : "Faça seu pedido pelo celular."}</strong></div><div>{service.customer_self_order_enabled && <span>Pedido direto à cozinha</span>}{service.counter_pickup_enabled && <span>Retirada no balcão</span>}{service.delivery_enabled && <span>Entrega</span>}{service.table_service_enabled && <span>Atendimento na mesa</span>}</div>{service.waiter_mode_enabled && service.active_waiters === 0 && <p>Nenhum garçom está ativo agora; o pedido pelo celular continua disponível.</p>}</section>
    {menu.banners?.length ? <section className="menu-banners">{menu.banners.map(banner => <a key={banner.id} href={banner.link_url || "#"} style={{ backgroundImage: `url(${banner.image_url})` }}><span>{banner.title}</span></a>)}</section> : null}
    <section className="menu-content">{menu.categories.filter(category => category.products.length).map(category => <div className="menu-category" key={category.id}><div className="menu-category-title"><h2>{category.name}</h2>{category.description && <p>{category.description}</p>}</div><div className="product-grid">{category.products.map(product => <article className="product-card" key={product.id}><div className="product-info"><h3>{product.name}</h3><p>{product.description}</p><strong>{money(product.price_cents)}</strong>{service.customer_self_order_enabled && <button className="add-button" onClick={() => openProduct(product)}>Escolher e personalizar +</button>}</div><div className="product-image" style={product.image_url ? { backgroundImage: `url(${product.image_url})` } : undefined} /></article>)}</div></div>)}</section>
    {service.customer_self_order_enabled && cart.length > 0 && <button className="cart-bar" onClick={() => { record("checkout_started", undefined, undefined, total); setCheckout(true); }}><span>{cart.reduce((sum, item) => sum + item.quantity, 0)} itens</span><b>Ver pedido · {money(total)}</b></button>}

    {customizing && <div className="checkout-overlay" onClick={() => setCustomizing(null)}><aside className="customize-card" onClick={event => event.stopPropagation()}><button className="checkout-close" onClick={() => setCustomizing(null)}>×</button><span className="kicker">PERSONALIZE SEU ITEM</span><h2>{customizing.name}</h2><strong>{money(customizing.price_cents)}</strong>{customizing.ingredients?.length ? <fieldset><legend>Deseja retirar algo?</legend>{customizing.ingredients.map(ingredient => <label key={ingredient}><input type="checkbox" checked={removedIngredients.includes(ingredient)} onChange={event => setRemovedIngredients(current => event.target.checked ? [...current, ingredient] : current.filter(value => value !== ingredient))} /> Sem {ingredient}</label>)}</fieldset> : null}{customizing.addon_options?.length ? <fieldset><legend>Acrescente algo a mais</legend>{customizing.addon_options.map(addon => <label key={addon.name}><input type="checkbox" checked={selectedAddons.includes(addon.name)} onChange={event => setSelectedAddons(current => event.target.checked ? [...current, addon.name] : current.filter(value => value !== addon.name))} /><span>{addon.name}</span><b>+ {money(addon.price_cents)}</b></label>)}</fieldset> : null}<div className="field"><label>OBSERVAÇÃO DO ITEM</label><textarea value={itemNotes} onChange={event => setItemNotes(event.target.value)} maxLength={300} placeholder="Ex.: ponto da carne, molho separado..." /></div><div className="customize-footer"><div className="quantity-control"><button onClick={() => setItemQuantity(value => Math.max(1, value - 1))}>−</button><b>{itemQuantity}</b><button onClick={() => setItemQuantity(value => Math.min(20, value + 1))}>+</button></div><button className="button dark" onClick={addCustomized}>Adicionar · {money((customizing.price_cents + (customizing.addon_options || []).filter(addon => selectedAddons.includes(addon.name)).reduce((sum, addon) => sum + addon.price_cents, 0)) * itemQuantity)}</button></div></aside></div>}

    {checkout && <div className="checkout-overlay" onClick={() => setCheckout(false)}><aside className="checkout-card" onClick={event => event.stopPropagation()}><button className="checkout-close" onClick={() => setCheckout(false)}>×</button><h2>Finalizar pedido</h2><div className="cart-lines">{cart.map(item => <div className="cart-line" key={item.key}><div><b>{item.quantity}× {item.product.name}</b>{item.addons.length > 0 && <small>+ {item.addons.map(addon => addon.name).join(", ")}</small>}{item.removedIngredients.length > 0 && <small>Sem {item.removedIngredients.join(", ")}</small>}</div><strong>{money(item.unitPrice * item.quantity)}</strong><div className="mini-quantity"><button onClick={() => changeQuantity(item.key, -1)}>−</button><button onClick={() => changeQuantity(item.key, 1)}>+</button></div></div>)}</div><form className="form" onSubmit={order}><div className="field"><label>{selectedFulfillment === "dine_in" ? "NOME E SOBRENOME" : "SEU NOME"}</label><input name="name" required maxLength={120} autoComplete="name" placeholder="Ex.: Maria Oliveira" /></div><div className="field"><label>WHATSAPP</label><input name="phone" required type="tel" /></div><div className="field"><label>COMO DESEJA RECEBER?</label><select name="fulfillment" value={selectedFulfillment} onChange={event => setFulfillment(event.target.value)}>{service.table_service_enabled && <option value="dine_in">Consumir no local</option>}{service.counter_pickup_enabled && <option value="pickup">Retirar no balcão</option>}{service.delivery_enabled && <option value="delivery">Receber em casa</option>}</select></div>{selectedFulfillment === "dine_in" && <div className="field"><label>NÚMERO OU NOME DA MESA</label><input name="table_label" required maxLength={40} defaultValue={qrTable?.table_number || tableNumber || ""} placeholder="Ex.: 12 ou Varanda 3" /><small>A mesa é criada automaticamente quando o pedido é enviado.</small></div>}<div className="field"><label>FORMA DE PAGAMENTO</label><select name="payment">{service.accepted_payment_methods.map(method => <option value={method} key={method}>{method === "pix" ? "Pix" : method === "cash" ? "Dinheiro" : method === "credit_card" ? "Cartão de crédito" : "Cartão de débito"}</option>)}</select></div><div className="field"><label>OBSERVAÇÕES GERAIS</label><textarea name="notes" /></div>{message && <div className={completed ? "form-message form-success" : "form-message"}>{message}</div>}{completed ? <button type="button" className="button dark wide" onClick={() => setCheckout(false)}>Concluir</button> : <button className="button dark wide">Enviar para a cozinha · {money(total)}</button>}<small className="checkout-help">Ao confirmar, o pedido entra imediatamente na tela da cozinha.</small></form></aside></div>}

    {waiterOpen && <div className="checkout-overlay" onClick={() => setWaiterOpen(false)}><aside className="waiter-modal" onClick={event => event.stopPropagation()}><button className="checkout-close" onClick={() => setWaiterOpen(false)}>×</button><span className="kicker">ATENDIMENTO NA MESA</span><h2>Chamar garçom</h2><form className="form" onSubmit={callWaiter}>{!qrTable && <div className="field"><label>NÚMERO OU NOME DA MESA</label><input name="table_label" required maxLength={40} placeholder="Ex.: 12 ou Varanda 3" /></div>}<div className="field"><label>OBSERVAÇÃO (OPCIONAL)</label><textarea name="note" maxLength={300} placeholder="Ex.: Preciso de mais guardanapos." /></div>{waiterMessage && <div className={waiterMessage.includes("chamado") ? "form-message form-success" : "form-message"}>{waiterMessage}</div>}<button className="button dark wide">Confirmar chamado</button></form></aside></div>}
  </main>;
}
