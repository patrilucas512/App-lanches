"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Addon = { name: string; price_cents: number };
export type MenuProduct = { id: string; name: string; description?: string; image_url?: string; price_cents: number; featured?: boolean; ingredients?: string[]; addon_options?: Addon[] };
export type MenuCategory = { id: string; name: string; description?: string; products: MenuProduct[] };
export type PublicMenu = {
  establishment: { id?: string; name: string; slug: string; description?: string; logo_url?: string; cover_url?: string; accent_color: string; secondary_color?: string };
  settings: { whatsapp?: string; delivery_enabled: boolean; pickup_enabled: boolean; estimated_minutes?: number; payment_methods?: string[] };
  banners?: { id: string; title: string; image_url: string; link_url?: string }[];
  categories: MenuCategory[];
  service_mode?: { mode: string; waiter_mode_enabled: boolean; table_service_enabled: boolean; counter_pickup_enabled: boolean; delivery_enabled: boolean; customer_self_order_enabled: boolean; waiter_call_enabled: boolean; bill_closing_enabled: boolean; accepted_payment_methods: string[]; active_waiters: number };
};
type CartItem = { key: string; product: MenuProduct; quantity: number; addons: Addon[]; removedIngredients: string[]; unitPrice: number };
type QrTable = { table_id: string; table_number: string; table_name?: string; waiter_calls_enabled: boolean };
type TrackedItem = { id: string; product_name: string; quantity: number; addons: Addon[]; removed_ingredients: string[] };
type OrderTracking = { order_number: number; status: string; kitchen_status?: string; fulfillment_type: string; created_at: string; updated_at: string; estimated_minutes: number; table_number?: string; started_at?: string; ready_at?: string; delivered_at?: string; items: TrackedItem[] };

const statusOrder = ["received", "preparing", "ready", "delivered"];

export function PublicMenuView({ menu, tableNumber, source }: { menu: PublicMenu; tableNumber?: string; source?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const cartStarted = useRef(false);
  const audioContext = useRef<AudioContext | null>(null);
  const alertedReady = useRef(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customizingKey, setCustomizingKey] = useState<string | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [message, setMessage] = useState("");
  const [qrTable, setQrTable] = useState<QrTable | null>(null);
  const [waiterOpen, setWaiterOpen] = useState(false);
  const [waiterMessage, setWaiterMessage] = useState("");
  const [trackingToken, setTrackingToken] = useState(() => typeof window === "undefined" ? "" : window.localStorage.getItem(`mesa-viva:${menu.establishment.slug}:pedido`) || "");
  const [tracking, setTracking] = useState<OrderTracking | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const service = menu.service_mode ?? { mode: "mixed", waiter_mode_enabled: true, table_service_enabled: true, counter_pickup_enabled: menu.settings.pickup_enabled, delivery_enabled: menu.settings.delivery_enabled, customer_self_order_enabled: true, waiter_call_enabled: true, bill_closing_enabled: true, accepted_payment_methods: menu.settings.payment_methods || [], active_waiters: 0 };
  const travelEnabled = service.counter_pickup_enabled || service.delivery_enabled;
  const defaultFulfillment = service.table_service_enabled ? "dine_in" : "pickup";
  const [fulfillment, setFulfillment] = useState(tableNumber && service.table_service_enabled ? "dine_in" : defaultFulfillment);
  const total = useMemo(() => cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0), [cart]);
  const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
  const record = (event: string, productId?: string, orderId?: string, valueCents?: number) => { if (menu.establishment.slug !== "demo") void supabase.rpc("record_public_event", { requested_slug: menu.establishment.slug, requested_event: event, requested_product: productId ?? null, requested_order: orderId ?? null, requested_value_cents: valueCents ?? null }); };

  useEffect(() => {
    record("menu_view");
    if (source === "qr" || tableNumber) void supabase.rpc("record_qr_scan", { requested_slug: menu.establishment.slug, requested_table_number: tableNumber ?? null, requested_source: source === "qr" ? "qr" : "print", requested_user_agent: navigator.userAgent }).then(({ data }) => { if (data?.table_id) setQrTable(data as QrTable); });
  }, []);

  function readyAlert() {
    if (alertedReady.current) return;
    alertedReady.current = true;
    if (navigator.vibrate) navigator.vibrate([1000, 350, 1000, 350, 1000, 350, 1000, 350, 1000]);
    const context = audioContext.current;
    if (!context) return;
    void context.resume();
    let count = 0;
    const beep = () => {
      const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.connect(gain); gain.connect(context.destination); oscillator.frequency.value = count % 2 ? 740 : 980; gain.gain.value = .12;
      oscillator.start(); oscillator.stop(context.currentTime + .55); count += 1;
    };
    beep(); const timer = window.setInterval(() => { if (count >= 10) window.clearInterval(timer); else beep(); }, 1000);
  }

  useEffect(() => {
    if (!trackingToken) return;
    let active = true;
    const refresh = async () => {
      const { data } = await supabase.rpc("get_public_order_status", { requested_tracking_token: trackingToken });
      if (!active || !data) return;
      const next = data as OrderTracking; setTracking(next);
      if ((next.kitchen_status === "ready" || next.status === "ready") && !alertedReady.current) readyAlert();
    };
    void refresh(); const poll = window.setInterval(refresh, 3000); const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; window.clearInterval(poll); window.clearInterval(clock); };
  }, [trackingToken, supabase]);

  function add(product: MenuProduct) {
    const existing = cart.find(item => item.product.id === product.id && !item.addons.length && !item.removedIngredients.length);
    if (existing) setCart(current => current.map(item => item.key === existing.key ? { ...item, quantity: Math.min(20, item.quantity + 1) } : item));
    else setCart(current => [...current, { key: crypto.randomUUID(), product, quantity: 1, addons: [], removedIngredients: [], unitPrice: product.price_cents }]);
    record("product_added", product.id); if (!cartStarted.current) { cartStarted.current = true; record("cart_started"); }
  }
  function changeQuantity(key: string, delta: number) { setCart(current => current.map(item => item.key === key ? { ...item, quantity: Math.max(0, Math.min(20, item.quantity + delta)) } : item).filter(item => item.quantity > 0)); }
  function toggleIngredient(key: string, ingredient: string) { setCart(current => current.map(item => item.key !== key ? item : { ...item, removedIngredients: item.removedIngredients.includes(ingredient) ? item.removedIngredients.filter(value => value !== ingredient) : [...item.removedIngredients, ingredient] })); }
  function toggleAddon(key: string, addon: Addon) { setCart(current => current.map(item => { if (item.key !== key) return item; const exists = item.addons.some(value => value.name === addon.name); const addons = exists ? item.addons.filter(value => value.name !== addon.name) : [...item.addons, addon]; return { ...item, addons, unitPrice: item.product.price_cents + addons.reduce((sum, value) => sum + value.price_cents, 0) }; })); }

  async function order(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("Enviando o pedido para a cozinha...");
    if (menu.establishment.slug === "demo") return setMessage("Esta é uma loja demonstrativa. Crie sua conta para receber pedidos reais.");
    if (!audioContext.current) audioContext.current = new AudioContext(); void audioContext.current.resume(); alertedReady.current = false;
    const data = new FormData(event.currentTarget); const buyerName = String(data.get("name") || "").trim(); const chosenFulfillment = String(data.get("fulfillment")); const tableLabel = String(data.get("table_label") || "").trim();
    if (buyerName.split(/\s+/).length < 2) return setMessage("Informe seu nome e sobrenome para identificar o pedido.");
    if (chosenFulfillment === "dine_in" && !tableLabel) return setMessage("Informe o número ou nome da mesa onde você está.");
    const { data: result, error } = await supabase.rpc("place_public_order", { requested_slug: menu.establishment.slug, buyer_name: buyerName, buyer_phone: String(data.get("phone") || ""), requested_fulfillment: chosenFulfillment, requested_items: cart.map(item => ({ product_id: item.product.id, quantity: item.quantity, addons: item.addons.map(addon => ({ name: addon.name })), removed_ingredients: item.removedIngredients })), order_notes: null, requested_table_number: chosenFulfillment === "dine_in" ? tableLabel : null, requested_source: source === "qr" || qrTable ? "qr" : "direct", requested_payment: String(data.get("payment") || "") });
    if (error) return setMessage(error.message);
    record("order_whatsapp", undefined, result.order_id, result.total_cents);
    const token = String(result.tracking_token); window.localStorage.setItem(`mesa-viva:${menu.establishment.slug}:pedido`, token); setTrackingToken(token); setCheckout(false); setCart([]); cartStarted.current = false; setMessage("");
  }

  async function callWaiter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWaiterMessage("Enviando chamado..."); const data = new FormData(event.currentTarget); const label = qrTable?.table_number || String(data.get("table_label") || "").trim();
    const { data: result, error } = await supabase.rpc("create_waiter_call", { requested_slug: menu.establishment.slug, requested_table_number: label, requested_note: String(data.get("note") || "") });
    setWaiterMessage(error ? error.message : result?.duplicate ? "Seu chamado já está aguardando atendimento." : `Garçom chamado para a mesa ${label}!`);
  }

  const currentStatus = tracking?.kitchen_status || (tracking?.status === "completed" ? "delivered" : tracking?.status) || "received";
  const stageIndex = Math.max(0, statusOrder.indexOf(currentStatus));
  const countdownStart = tracking?.started_at || tracking?.created_at;
  const secondsRemaining = tracking && countdownStart ? Math.max(0, tracking.estimated_minutes * 60 - Math.floor((now - new Date(countdownStart).getTime()) / 1000)) : 0;
  const minutesLabel = `${String(Math.floor(secondsRemaining / 60)).padStart(2, "0")}:${String(secondsRemaining % 60).padStart(2, "0")}`;

  return <main className="menu-page" style={{ "--wine": menu.establishment.accent_color, "--paper": menu.establishment.secondary_color ?? "#f5efe5" } as React.CSSProperties}>
    <header className="menu-cover" style={menu.establishment.cover_url ? { backgroundImage: `linear-gradient(120deg,rgba(28,14,13,.84),rgba(109,38,39,.72)),url(${menu.establishment.cover_url})` } : undefined}>{menu.establishment.logo_url && <img className="menu-logo" src={menu.establishment.logo_url} alt="" />}<span className="kicker">CARDÁPIO DIGITAL</span><h1>{menu.establishment.name}</h1><p>{menu.establishment.description || "Escolha seus itens e envie o pedido direto para a cozinha."}</p>{menu.settings.estimated_minutes && <small>Tempo estimado: {menu.settings.estimated_minutes} min</small>}</header>
    {(service.waiter_call_enabled && service.waiter_mode_enabled && service.active_waiters > 0) && <button className="floating-waiter-button" onClick={() => setWaiterOpen(true)}>🔔 Chamar garçom</button>}

    {tracking && <section className={`order-tracking tracking-${currentStatus}`} aria-live="polite"><div className="tracking-heading"><div><small>ACOMPANHE SEU PEDIDO</small><h2>Pedido #{tracking.order_number}</h2></div>{currentStatus === "preparing" && <div className="tracking-clock"><span>⏱</span><b>{minutesLabel}</b><small>tempo estimado</small></div>}{currentStatus === "ready" && <div className="tracking-ready-alert"><b>PRONTO!</b><span>{tracking.fulfillment_type === "dine_in" ? `A equipe levará até ${tracking.table_number ? `a mesa ${tracking.table_number}` : "sua mesa"}.` : "Retire seu pedido no balcão."}</span></div>}</div><div className="tracking-steps">{[["received","Recebido"],["preparing","Em preparo"],["ready","Pronto"],["delivered","Entregue"]].map(([status,label], index) => <div className={index <= stageIndex ? "active" : ""} key={status}><i>{index < stageIndex ? "✓" : index + 1}</i><span>{label}</span></div>)}</div><div className="tracking-items"><h3>Seu pedido</h3>{tracking.items.map(item => <div key={item.id}><b>{item.quantity}× {item.product_name}</b>{item.addons?.length > 0 && <small>+ {item.addons.map(addon => addon.name).join(", ")}</small>}{item.removed_ingredients?.length > 0 && <strong>SEM {item.removed_ingredients.join(", ")}</strong>}</div>)}</div></section>}

    {menu.banners?.length ? <section className="menu-banners">{menu.banners.map(banner => <a key={banner.id} href={banner.link_url || "#"} style={{ backgroundImage: `url(${banner.image_url})` }}><span>{banner.title}</span></a>)}</section> : null}
    <section className="menu-content">{menu.categories.filter(category => category.products.length).map(category => <div className="menu-category" key={category.id}><div className="menu-category-title"><h2>{category.name}</h2>{category.description && <p>{category.description}</p>}</div><div className="product-grid">{category.products.map(product => <article className="product-card" key={product.id}><div className="product-info"><h3>{product.name}</h3>{product.ingredients?.length ? <p className="product-ingredients"><b>Leva:</b> {product.ingredients.join(", ")}</p> : <p>{product.description}</p>}<strong>{money(product.price_cents)}</strong>{service.customer_self_order_enabled && <button className="add-button" onClick={() => add(product)}>Adicionar +</button>}</div><div className="product-image" style={product.image_url ? { backgroundImage: `url(${product.image_url})` } : undefined} /></article>)}</div></div>)}</section>
    {service.customer_self_order_enabled && cart.length > 0 && <button className="cart-bar" onClick={() => { record("checkout_started", undefined, undefined, total); setCheckout(true); }}><span>{cart.reduce((sum, item) => sum + item.quantity, 0)} itens</span><b>Ver pedido · {money(total)}</b></button>}

    {checkout && <div className="checkout-overlay" onClick={() => setCheckout(false)}><aside className="checkout-card" onClick={event => event.stopPropagation()}><button className="checkout-close" onClick={() => setCheckout(false)}>×</button><h2>Finalizar pedido</h2><div className="cart-lines">{cart.map(item => <div className="cart-line cart-line-custom" key={item.key}><div className="cart-line-heading"><div><b>{item.quantity}× {item.product.name}</b><small>{item.product.ingredients?.length ? `Leva: ${item.product.ingredients.join(", ")}` : item.product.description}</small></div><strong>{money(item.unitPrice * item.quantity)}</strong></div><div className="mini-quantity"><button type="button" onClick={() => changeQuantity(item.key, -1)}>−</button><b>{item.quantity}</b><button type="button" onClick={() => changeQuantity(item.key, 1)}>+</button></div>{(item.product.ingredients?.length || item.product.addon_options?.length) ? <button type="button" className="customize-toggle" onClick={() => setCustomizingKey(customizingKey === item.key ? null : item.key)}>Deseja retirar ou acrescentar algo no seu {item.product.name}?</button> : null}{customizingKey === item.key && <div className="inline-customizer">{item.product.ingredients?.length ? <fieldset><legend>Marque o que deseja retirar</legend>{item.product.ingredients.map(ingredient => <label key={ingredient}><input type="checkbox" checked={item.removedIngredients.includes(ingredient)} onChange={() => toggleIngredient(item.key, ingredient)} /><span>{ingredient}</span></label>)}</fieldset> : null}{item.product.addon_options?.length ? <fieldset><legend>Adicionais</legend>{item.product.addon_options.map(addon => <label key={addon.name}><input type="checkbox" checked={item.addons.some(value => value.name === addon.name)} onChange={() => toggleAddon(item.key, addon)} /><span>{addon.name}</span><b>+ {money(addon.price_cents)}</b></label>)}</fieldset> : null}</div>}{item.removedIngredients.length > 0 && <div className="cart-removed-highlight">SEM {item.removedIngredients.join(", ")}</div>}</div>)}</div><form className="form" onSubmit={order}><div className="field"><label>NOME E SOBRENOME</label><input name="name" required maxLength={120} autoComplete="name" placeholder="Ex.: Maria Oliveira" /></div><div className="field"><label>COMO DESEJA CONSUMIR?</label><select name="fulfillment" value={fulfillment} onChange={event => setFulfillment(event.target.value)}>{service.table_service_enabled && <option value="dine_in">Consumir no local</option>}{travelEnabled && <option value="pickup">Para viagem</option>}</select></div>{fulfillment === "dine_in" && <div className="field"><label>NÚMERO OU NOME DA MESA</label><input name="table_label" required maxLength={40} defaultValue={qrTable?.table_number || tableNumber || ""} placeholder="Ex.: 12 ou Varanda 3" /></div>}<div className="field"><label>FORMA DE PAGAMENTO</label><select name="payment">{service.accepted_payment_methods.map(method => <option value={method} key={method}>{method === "pix" ? "Pix" : method === "cash" ? "Dinheiro" : method === "credit_card" ? "Cartão de crédito" : "Cartão de débito"}</option>)}</select></div><div className="field optional-contact"><label>WHATSAPP (OPCIONAL)</label><input name="phone" type="tel" inputMode="tel" placeholder="(21) 99999-9999" /><small>Se você sair do estabelecimento, deixe seu contato para receber avisos sobre o andamento do pedido quando o serviço de mensagens estiver configurado.</small></div>{message && <div className="form-message">{message}</div>}<button className="button dark wide">Enviar para a cozinha · {money(total)}</button><small className="checkout-help">Depois de enviar, acompanhe o preparo e receba o alerta de pedido pronto neste cardápio.</small></form></aside></div>}

    {waiterOpen && <div className="checkout-overlay" onClick={() => setWaiterOpen(false)}><aside className="waiter-modal" onClick={event => event.stopPropagation()}><button className="checkout-close" onClick={() => setWaiterOpen(false)}>×</button><span className="kicker">ATENDIMENTO NA MESA</span><h2>Chamar garçom</h2><form className="form" onSubmit={callWaiter}>{!qrTable && <div className="field"><label>NÚMERO OU NOME DA MESA</label><input name="table_label" required maxLength={40} placeholder="Ex.: 12 ou Varanda 3" /></div>}<div className="field"><label>MOTIVO (OPCIONAL)</label><textarea name="note" maxLength={300} placeholder="Ex.: Preciso de mais guardanapos." /></div>{waiterMessage && <div className={waiterMessage.includes("chamado") ? "form-message form-success" : "form-message"}>{waiterMessage}</div>}<button className="button dark wide">Confirmar chamado</button></form></aside></div>}
  </main>;
}
