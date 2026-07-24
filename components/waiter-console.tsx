"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { createPixPayload } from "@/lib/pix";

type Table = { id: string; table_number: string; table_name?: string | null; sector?: string | null; status: string };
type Session = {
  id: string; table_id: string; waiter_id: string; customer_name?: string | null; people_count: number;
  opening_note?: string | null; status: string; opened_at: string; subtotal_cents: number;
  service_fee_cents: number; discount_cents: number; total_cents: number; payment_status: string;
};
type Variation = { id: string; name: string; price_delta_cents: number; active: boolean };
type Addon = { id: string; name: string; price_cents: number; active: boolean };
type Product = {
  id: string; name: string; description?: string | null; image_url?: string | null; price_cents: number; category_id?: string | null;
  product_variations?: Variation[]; product_addon_groups?: { addon_groups?: { id: string; name: string; addons?: Addon[] }[] | null }[];
};
type CartItem = { key: string; product: Product; quantity: number; variationId: string; addonIds: string[]; removed: string[]; notes: string };
type PixData = {
  pix_key: string; receiver_name: string; receiver_document_masked?: string; receiver_city: string;
  institution_name?: string; amount_cents: number; establishment_name: string; table_number: string; session_id: string;
};

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const labels: Record<string, string> = {
  free: "Livre", occupied: "Ocupada", awaiting_order: "Aguardando pedido", order_sent: "Pedido enviado",
  preparing: "Em preparo", ready: "Pronto", awaiting_payment: "Aguardando pagamento", paid: "Paga", blocked: "Bloqueada",
};

function addonsFor(product: Product) {
  return (product.product_addon_groups || []).flatMap(link =>
    (link.addon_groups || []).flatMap(group => (group.addons || []).filter(addon => addon.active))
  );
}

export function WaiterConsole({ establishmentId, establishmentName, userId, role, initialTables, initialSessions, products, categories }: {
  establishmentId: string; establishmentName: string; userId: string; role: string;
  initialTables: Table[]; initialSessions: Session[]; products: Product[]; categories: { id: string; name: string }[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [tables, setTables] = useState(initialTables);
  const [sessions, setSessions] = useState(initialSessions);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [openTableId, setOpenTableId] = useState<string | null>(null);
  const [customProduct, setCustomProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [pix, setPix] = useState<(PixData & { payload: string; qr: string }) | null>(null);
  const [receipt, setReceipt] = useState<{ method: string; amount: number; date: string } | null>(null);
  const selectedTable = tables.find(table => table.id === selectedTableId);
  const selectedSession = sessions.find(session => session.table_id === selectedTableId);

  async function refresh() {
    const [{ data: nextTables }, { data: nextSessions }] = await Promise.all([
      supabase.from("restaurant_tables").select("*").eq("establishment_id", establishmentId).eq("is_active", true).order("table_number"),
      supabase.from("table_sessions").select("*").eq("establishment_id", establishmentId).in("status", ["open", "awaiting_payment", "paid"]),
    ]);
    if (nextTables) setTables(nextTables as Table[]);
    if (nextSessions) setSessions(nextSessions as Session[]);
  }
  useEffect(() => {
    const channel = supabase.channel(`waiter-operation-${establishmentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_tables", filter: `establishment_id=eq.${establishmentId}` }, () => { void refresh(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "table_sessions", filter: `establishment_id=eq.${establishmentId}` }, () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [establishmentId, supabase]);

  function chooseTable(table: Table) {
    setMessage(""); setReceipt(null); setPix(null);
    if (table.status === "free") setOpenTableId(table.id);
    else if (table.status !== "blocked") setSelectedTableId(table.id);
  }
  async function openTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!openTableId) return; setBusy(true);
    const form = new FormData(event.currentTarget);
    const { data, error } = await supabase.rpc("open_table_session", {
      requested_table_id: openTableId,
      requested_customer_name: String(form.get("customer") || "") || null,
      requested_people_count: Number(form.get("people") || 1),
      requested_opening_note: String(form.get("note") || "") || null,
    });
    if (error) setMessage(error.message);
    else { setSelectedTableId(openTableId); setOpenTableId(null); setSessions(current => [...current, data as Session]); await refresh(); }
    setBusy(false);
  }
  function addCustomized(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!customProduct) return;
    const form = new FormData(event.currentTarget);
    setCart(current => [...current, {
      key: crypto.randomUUID(), product: customProduct, quantity: Number(form.get("quantity") || 1),
      variationId: String(form.get("variation") || ""), addonIds: form.getAll("addons").map(String),
      removed: String(form.get("removed") || "").split(",").map(value => value.trim()).filter(Boolean),
      notes: String(form.get("notes") || ""),
    }]);
    setCustomProduct(null);
  }
  function itemPrice(item: CartItem) {
    const variation = item.product.product_variations?.find(value => value.id === item.variationId);
    const addons = addonsFor(item.product).filter(addon => item.addonIds.includes(addon.id));
    return (item.product.price_cents + (variation?.price_delta_cents || 0) + addons.reduce((sum, addon) => sum + addon.price_cents, 0)) * item.quantity;
  }
  const cartTotal = cart.reduce((sum, item) => sum + itemPrice(item), 0);
  async function sendOrder() {
    if (!selectedSession || !cart.length || !confirm("Enviar este pedido para a cozinha?")) return;
    setBusy(true); setMessage("");
    const { error } = await supabase.rpc("submit_table_order", {
      requested_session_id: selectedSession.id,
      requested_items: cart.map(item => ({
        product_id: item.product.id, quantity: item.quantity, variation_id: item.variationId || null,
        addon_ids: item.addonIds, removed_ingredients: item.removed, notes: item.notes,
      })),
      requested_notes: null,
    });
    if (error) setMessage(error.message);
    else { setCart([]); setMessage("Pedido enviado para a cozinha."); await refresh(); }
    setBusy(false);
  }
  async function closeAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedSession || !confirm("Confirmar fechamento desta conta?")) return;
    setBusy(true); const form = new FormData(event.currentTarget);
    const { error } = await supabase.rpc("request_table_closure", {
      requested_session_id: selectedSession.id,
      requested_service_percent: Number(form.get("service") || 0),
      requested_discount_cents: Math.round(Number(String(form.get("discount") || "0").replace(",", ".")) * 100),
    });
    if (error) setMessage(error.message); else { await refresh(); setPaymentOpen(true); }
    setBusy(false);
  }
  async function generatePix() {
    if (!selectedSession) return; setBusy(true); setMessage("");
    const { data, error } = await supabase.rpc("get_table_pix_data", { requested_session_id: selectedSession.id });
    if (error) { setMessage(error.message); setBusy(false); return; }
    const info = data as PixData;
    const payload = createPixPayload({
      key: info.pix_key, name: info.receiver_name, city: info.receiver_city, amountCents: info.amount_cents,
      txid: info.session_id.replaceAll("-", "").slice(0, 25), description: `MESA ${info.table_number}`,
    });
    const qr = await QRCode.toDataURL(payload, { width: 600, margin: 2, errorCorrectionLevel: "M" });
    setPix({ ...info, payload, qr }); setBusy(false);
  }
  async function confirmPayment(method: string) {
    if (!selectedSession || !confirm("Você conferiu e recebeu o pagamento?")) return;
    setBusy(true);
    const { error } = await supabase.rpc("confirm_table_payment", {
      requested_session_id: selectedSession.id, requested_payment_method: method,
      requested_pix_payload: method === "pix" ? pix?.payload || null : null,
    });
    if (error) setMessage(error.message);
    else { setReceipt({ method, amount: selectedSession.total_cents, date: new Date().toISOString() }); await refresh(); }
    setBusy(false);
  }
  async function releaseTable() {
    if (!selectedSession || !confirm("Liberar a mesa para uma nova conta?")) return;
    const { error } = await supabase.rpc("release_table_session", { requested_session_id: selectedSession.id });
    if (error) setMessage(error.message); else { setPaymentOpen(false); setSelectedTableId(null); setReceipt(null); setPix(null); await refresh(); }
  }
  async function downloadReceipt() {
    if (!receipt || !selectedSession || !selectedTable) return;
    const { jsPDF } = await import("jspdf"); const pdf = new jsPDF();
    pdf.setFontSize(20); pdf.text(establishmentName, 20, 25); pdf.setFontSize(11);
    const lines = [`Comprovante interno`, `Mesa: ${selectedTable.table_number}`, `Conta: ${selectedSession.id}`,
      `Forma: ${receipt.method}`, `Valor: ${money(receipt.amount)}`, `Data: ${new Date(receipt.date).toLocaleString("pt-BR")}`];
    lines.forEach((line, index) => pdf.text(line, 20, 42 + index * 8)); pdf.save(`comprovante-mesa-${selectedTable.table_number}.pdf`);
  }
  const visibleProducts = products.filter(product =>
    (category === "all" || product.category_id === category) &&
    product.name.toLowerCase().includes(search.toLowerCase())
  );
  const openedFor = selectedSession ? Math.max(0, Math.floor((Date.now() - new Date(selectedSession.opened_at).getTime()) / 60000)) : 0;

  return <div className="waiter-console">
    <section className="table-operations-grid">
      {tables.map(table => {
        const session = sessions.find(value => value.table_id === table.id);
        return <button key={table.id} className={`operation-table status-${table.status} ${selectedTableId === table.id ? "selected" : ""}`} onClick={() => chooseTable(table)}>
          <small>{table.sector || "MESA"}</small><strong>{table.table_number}</strong><span>{labels[table.status] || table.status}</span>
          {session && <><b>{money(session.total_cents || session.subtotal_cents)}</b><em>{session.waiter_id === userId ? "Sua mesa" : "Equipe"} · {session.people_count} pessoa(s)</em></>}
        </button>;
      })}
    </section>
    {!tables.length && <div className="empty"><b>Nenhuma mesa ativa.</b><span>O proprietário pode cadastrar mesas em QR Codes.</span></div>}

    {selectedTable && selectedSession && <div className="waiter-workspace">
      <section className="panel table-account-head">
        <div><small>MESA {selectedTable.table_number}</small><h2>{selectedSession.customer_name || "Cliente não informado"}</h2><p>Aberta há {openedFor} min · {selectedSession.people_count} pessoa(s) · {labels[selectedTable.status]}</p></div>
        <div><small>PARCIAL</small><strong>{money(selectedSession.total_cents || selectedSession.subtotal_cents)}</strong><button className="button outline" onClick={() => setSelectedTableId(null)}>Trocar mesa</button></div>
      </section>
      {selectedSession.status === "open" && <div className="waiter-order-layout">
        <section className="panel internal-menu">
          <div className="menu-tools"><input placeholder="Buscar produto..." value={search} onChange={event => setSearch(event.target.value)} /><div><button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>Todos</button>{categories.map(value => <button key={value.id} className={category === value.id ? "active" : ""} onClick={() => setCategory(value.id)}>{value.name}</button>)}</div></div>
          <div className="internal-product-grid">{visibleProducts.map(product => <article key={product.id}>
            {product.image_url ? <img src={product.image_url} alt="" /> : <div className="product-placeholder">MV</div>}
            <div><h3>{product.name}</h3><p>{product.description}</p><strong>{money(product.price_cents)}</strong></div>
            <button onClick={() => setCustomProduct(product)}>Adicionar</button>
          </article>)}</div>
        </section>
        <aside className="panel waiter-cart"><h2>Pedido da mesa</h2>{cart.length ? <div>{cart.map(item => <article key={item.key}><span>{item.quantity}× {item.product.name}</span><b>{money(itemPrice(item))}</b><button onClick={() => setCart(current => current.filter(value => value.key !== item.key))}>Remover</button>{item.notes && <small>{item.notes}</small>}</article>)}</div> : <div className="empty compact"><span>Adicione itens do cardápio.</span></div>}<footer><span>Total do envio</span><strong>{money(cartTotal)}</strong></footer><button className="button dark wide" disabled={!cart.length || busy} onClick={sendOrder}>Enviar para cozinha</button></aside>
      </div>}
      {selectedSession.status === "open" && <form className="panel close-account" onSubmit={closeAccount}>
        <div><h2>Fechar conta</h2><p>O valor só será marcado como pago após sua confirmação manual.</p></div>
        <div className="field"><label>TAXA DE SERVIÇO</label><select name="service" defaultValue="10"><option value="0">Sem taxa</option><option value="10">10%</option><option value="12">12%</option></select></div>
        {role !== "attendant" && <div className="field"><label>DESCONTO (R$)</label><input name="discount" inputMode="decimal" defaultValue="0,00" /></div>}
        <button className="button dark" disabled={busy || selectedSession.subtotal_cents <= 0}>Fechar conta</button>
      </form>}
      {["awaiting_payment", "paid"].includes(selectedSession.status) && <button className="button dark wide payment-launch" onClick={() => setPaymentOpen(true)}>{selectedSession.status === "paid" ? "Ver comprovante e liberar mesa" : "Abrir pagamento"}</button>}
    </div>}

    {openTableId && <div className="checkout-overlay"><form className="waiter-modal form" onSubmit={openTable}><button type="button" className="checkout-close" onClick={() => setOpenTableId(null)}>×</button><small>ABRIR MESA</small><h2>Mesa {tables.find(value => value.id === openTableId)?.table_number}</h2><div className="field"><label>NOME DO CLIENTE (OPCIONAL)</label><input name="customer" /></div><div className="field"><label>QUANTIDADE DE PESSOAS</label><input name="people" type="number" min="1" max="99" defaultValue="1" /></div><div className="field"><label>OBSERVAÇÃO INICIAL</label><textarea name="note" /></div><button className="button dark wide" disabled={busy}>Abrir mesa</button></form></div>}
    {customProduct && <div className="checkout-overlay"><form className="waiter-modal form product-customizer" onSubmit={addCustomized}><button type="button" className="checkout-close" onClick={() => setCustomProduct(null)}>×</button><small>PERSONALIZAR ITEM</small><h2>{customProduct.name}</h2>{(customProduct.product_variations || []).filter(value => value.active).length > 0 && <div className="field"><label>VARIAÇÃO</label><select name="variation"><option value="">Padrão</option>{customProduct.product_variations?.filter(value => value.active).map(value => <option key={value.id} value={value.id}>{value.name} {value.price_delta_cents ? `+ ${money(value.price_delta_cents)}` : ""}</option>)}</select></div>}{addonsFor(customProduct).length > 0 && <div className="field"><label>ADICIONAIS</label><div className="addon-options">{addonsFor(customProduct).map(addon => <label key={addon.id}><input type="checkbox" name="addons" value={addon.id} /> {addon.name} · {money(addon.price_cents)}</label>)}</div></div>}<div className="field"><label>RETIRAR INGREDIENTES</label><input name="removed" placeholder="Ex.: cebola, tomate" /></div><div className="field"><label>OBSERVAÇÃO</label><textarea name="notes" placeholder="Ex.: ponto da carne" /></div><div className="field"><label>QUANTIDADE</label><input name="quantity" type="number" min="1" max="99" defaultValue="1" /></div><button className="button dark wide">Adicionar ao pedido</button></form></div>}
    {paymentOpen && selectedSession && selectedTable && <div className="checkout-overlay"><section className="waiter-modal payment-modal"><button className="checkout-close" onClick={() => setPaymentOpen(false)}>×</button><small>PAGAMENTO · MESA {selectedTable.table_number}</small><h2>{money(selectedSession.total_cents)}</h2><div className="account-values"><span>Subtotal <b>{money(selectedSession.subtotal_cents)}</b></span><span>Taxa de serviço <b>{money(selectedSession.service_fee_cents)}</b></span><span>Desconto <b>- {money(selectedSession.discount_cents)}</b></span></div>
      {selectedSession.status === "awaiting_payment" && <>{!pix ? <div className="payment-methods"><button className="button dark" disabled={busy} onClick={generatePix}>Gerar Pix oficial</button><button className="button outline" onClick={() => confirmPayment("cash")}>Dinheiro recebido</button><button className="button outline" onClick={() => confirmPayment("credit_card")}>Crédito presencial</button><button className="button outline" onClick={() => confirmPayment("debit_card")}>Débito presencial</button></div> : <div className="pix-payment"><img src={pix.qr} alt="QR Code Pix" /><h3>{pix.receiver_name}</h3><p>{pix.receiver_document_masked} {pix.institution_name && `· ${pix.institution_name}`}</p><div className="security-warning">Confira no aplicativo do banco se o destinatário é: <b>{pix.receiver_name}</b>.</div><textarea readOnly value={pix.payload} /><button className="button outline wide" onClick={() => navigator.clipboard.writeText(pix.payload)}>Copiar Pix Copia e Cola</button><button className="button dark wide" disabled={busy} onClick={() => confirmPayment("pix")}>Confirmar pagamento recebido</button><small>Gerar o QR Code não confirma o pagamento. Confira antes de continuar.</small></div>}</>}
      {selectedSession.status === "paid" && <div className="receipt-box"><b>Pagamento confirmado</b><p>Conta paga e bloqueada para novos lançamentos.</p><button className="button outline wide" onClick={downloadReceipt}>Baixar comprovante</button><button className="button outline wide" onClick={() => window.print()}>Imprimir</button><button className="button dark wide" onClick={releaseTable}>Fechar e liberar mesa</button></div>}
    </section></div>}
    {message && <div className={message.includes("enviado") ? "form-message form-success sticky-message" : "form-message sticky-message"}>{message}</div>}
  </div>;
}
