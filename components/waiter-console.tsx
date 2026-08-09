"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
type ServiceMode = {
  bill_closing_enabled: boolean; card_proof_required: boolean; accepted_payment_methods: string[];
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

export function WaiterConsole({ establishmentId, establishmentName, userId, operatorName, role, initialTables, initialSessions, products, categories, serviceMode }: {
  establishmentId: string; establishmentName: string; userId: string; operatorName: string; role: string;
  initialTables: Table[]; initialSessions: Session[]; products: Product[]; categories: { id: string; name: string }[]; serviceMode: ServiceMode;
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
  const [focusMenuAfterOpening, setFocusMenuAfterOpening] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [pix, setPix] = useState<(PixData & { payload: string; qr: string }) | null>(null);
  const [receipt, setReceipt] = useState<{ method: string; amount: number; date: string; waiterName: string; cashReceived?: number | null; cashChange?: number | null } | null>(null);
  const [cardMethod, setCardMethod] = useState<"credit_card" | "debit_card" | null>(null);
  const [cashOpen, setCashOpen] = useState(false);
  const [cashReceived, setCashReceived] = useState("");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const productSearchRef = useRef<HTMLInputElement>(null);
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
  useEffect(() => {
    if (!focusMenuAfterOpening || !selectedTable || selectedSession?.status !== "open") return;
    const timer = window.setTimeout(() => {
      workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      productSearchRef.current?.focus({ preventScroll: true });
      setFocusMenuAfterOpening(false);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [focusMenuAfterOpening, selectedSession?.status, selectedTable]);

  function chooseTable(table: Table) {
    setMessage(""); setReceipt(null); setPix(null);
    if (table.status !== "blocked") setSelectedTableId(table.id);
  }
  async function openTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!openTableId) return; setBusy(true);
    const form = new FormData(event.currentTarget);
    const customerName = String(form.get("customer") || "").trim();
    if (customerName.split(/\s+/).length < 2) {
      setMessage("Informe o nome e sobrenome da pessoa responsável pela mesa.");
      setBusy(false);
      return;
    }
    const { data, error } = await supabase.rpc("open_table_session_by_label", {
      requested_table_label: String(form.get("table_label") || ""),
      requested_customer_name: customerName,
      requested_people_count: Number(form.get("people") || 1),
      requested_opening_note: String(form.get("note") || "") || null,
    });
    if (error) setMessage(error.message);
    else {
      const session = data as Session;
      setSelectedTableId(session.table_id);
      setOpenTableId(null);
      setSessions(current => [...current, session]);
      await refresh();
      setSearch("");
      setCategory("all");
      setMessage("Atendimento aberto. Escolha os itens do cardápio e envie para a cozinha.");
      setFocusMenuAfterOpening(true);
    }
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
  async function registerPayment(method: string, options?: {
    proofPath?: string | null; machine?: string; reference?: string; cashReceivedCents?: number | null; notes?: string;
  }) {
    if (!selectedSession || !confirm("Você conferiu e recebeu o pagamento?")) return false;
    setBusy(true);
    const { data, error } = await supabase.rpc("register_table_payment", {
      requested_session_id: selectedSession.id, requested_payment_method: method,
      requested_pix_payload: method === "pix" ? pix?.payload || null : null,
      requested_proof_path: options?.proofPath || null,
      requested_card_machine: options?.machine || null,
      requested_transaction_reference: options?.reference || null,
      requested_cash_received_cents: options?.cashReceivedCents ?? null,
      requested_notes: options?.notes || null,
      requested_device_info: navigator.userAgent,
    });
    if (error) setMessage(error.message);
    else {
      const payment = data as { waiter_name?: string | null; confirmed_at?: string | null; cash_received_cents?: number | null; cash_change_cents?: number | null };
      setReceipt({
        method,
        amount: selectedSession.total_cents,
        date: payment.confirmed_at || new Date().toISOString(),
        waiterName: payment.waiter_name || "Equipe",
        cashReceived: payment.cash_received_cents,
        cashChange: payment.cash_change_cents,
      });
      await refresh();
    }
    setBusy(false);
    return !error;
  }
  function moneyInputToCents(value: string) {
    const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
    return Math.round(Number(normalized) * 100);
  }
  async function registerCash(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSession) return;
    const cents = moneyInputToCents(cashReceived);
    if (!Number.isFinite(cents) || cents < selectedSession.total_cents) {
      setMessage("O valor recebido deve ser igual ou maior que o total da conta.");
      return;
    }
    const registered = await registerPayment("cash", { cashReceivedCents: cents });
    if (registered) {
      setCashOpen(false);
      setCashReceived("");
    }
  }
  async function registerCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedSession || !cardMethod) return;
    setBusy(true); setMessage("");
    const data = new FormData(event.currentTarget);
    const photo = data.get("proof");
    let path: string | null = null;
    if (photo instanceof File && photo.size > 0) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(photo.type)) { setMessage("Envie uma imagem JPG, PNG ou WebP."); setBusy(false); return; }
      if (photo.size > 5 * 1024 * 1024) { setMessage("A imagem deve ter no máximo 5 MB."); setBusy(false); return; }
      const extension = photo.name.split(".").pop()?.toLowerCase() || "jpg";
      path = `${establishmentId}/${selectedSession.id}/${userId}/${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("payment-proofs").upload(path, photo, { contentType: photo.type, upsert: false });
      if (uploadError) { setMessage(uploadError.message); setBusy(false); return; }
    }
    setBusy(false);
    await registerPayment(cardMethod, {
      proofPath: path, machine: String(data.get("machine") || ""), reference: String(data.get("reference") || ""), notes: String(data.get("notes") || ""),
    });
    setCardMethod(null);
  }
  async function releaseTable() {
    if (!selectedSession || !confirm("Liberar a mesa para uma nova conta?")) return;
    const { error } = await supabase.rpc("release_table_session", { requested_session_id: selectedSession.id });
    if (error) setMessage(error.message); else { setPaymentOpen(false); setSelectedTableId(null); setReceipt(null); setPix(null); await refresh(); }
  }
  async function openPayment() {
    if (!selectedSession) return;
    setPaymentOpen(true);
    if (selectedSession.status !== "paid") return;
    const { data } = await supabase.from("table_payments")
      .select("payment_method,amount_cents,confirmed_at,waiter_name,cash_received_cents,cash_change_cents")
      .eq("table_session_id", selectedSession.id)
      .eq("status", "confirmed")
      .order("confirmed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) setReceipt({
      method: data.payment_method,
      amount: data.amount_cents,
      date: data.confirmed_at,
      waiterName: data.waiter_name || "Equipe",
      cashReceived: data.cash_received_cents,
      cashChange: data.cash_change_cents,
    });
  }
  async function downloadReceipt() {
    if (!receipt || !selectedSession || !selectedTable) return;
    const { jsPDF } = await import("jspdf"); const pdf = new jsPDF();
    pdf.setFontSize(20); pdf.text(establishmentName, 20, 25); pdf.setFontSize(11);
    const lines = [`Comprovante interno`, `Mesa: ${selectedTable.table_number}`, `Conta: ${selectedSession.id}`,
      `Forma: ${receipt.method}`, `Valor: ${money(receipt.amount)}`, `Fechado por: ${receipt.waiterName}`,
      ...(receipt.method === "cash" ? [`Troco para: ${money(receipt.cashReceived || receipt.amount)}`, `Troco entregue: ${money(receipt.cashChange || 0)}`] : []),
      `Data: ${new Date(receipt.date).toLocaleString("pt-BR")}`];
    lines.forEach((line, index) => pdf.text(line, 20, 42 + index * 8)); pdf.save(`comprovante-mesa-${selectedTable.table_number}.pdf`);
  }
  const visibleProducts = products.filter(product =>
    (category === "all" || product.category_id === category) &&
    product.name.toLowerCase().includes(search.toLowerCase())
  );
  const operationalTables = tables.filter(table =>
    sessions.some(session => session.table_id === table.id)
  );
  // This live operational timer is recalculated on realtime updates and user actions.
  // eslint-disable-next-line react-hooks/purity
  const openedFor = selectedSession ? Math.max(0, Math.floor((Date.now() - new Date(selectedSession.opened_at).getTime()) / 60000)) : 0;

  return <div className="waiter-console">
    <section className="panel-title-row waiter-operation-heading">
      <div><h2>Atendimentos em andamento</h2><p>Informe a pessoa responsável e o número ou nome da mesa somente ao abrir a conta.</p></div>
      <button className="button dark" onClick={() => setOpenTableId("new")}>Abrir atendimento</button>
    </section>
    <section className="table-operations-grid">
      {operationalTables.map(table => {
        const session = sessions.find(value => value.table_id === table.id);
        return <button key={table.id} className={`operation-table status-${table.status} ${selectedTableId === table.id ? "selected" : ""}`} onClick={() => chooseTable(table)}>
          <small>{table.sector || "MESA"}</small><strong>{table.table_number}</strong><span>{labels[table.status] || table.status}</span>
          {session && <><b>{money(session.total_cents || session.subtotal_cents)}</b><em>{session.waiter_id === userId ? "Sua mesa" : "Equipe"} · {session.people_count} pessoa(s)</em></>}
        </button>;
      })}
    </section>
    {!operationalTables.length && <div className="empty"><b>Nenhum atendimento aberto.</b><span>Clique em “Abrir atendimento” quando uma pessoa ocupar uma mesa.</span></div>}

    {selectedTable && selectedSession && <div className="waiter-workspace" ref={workspaceRef}>
      <section className="panel table-account-head">
        <div><small>MESA {selectedTable.table_number}</small><h2>{selectedSession.customer_name || "Cliente não informado"}</h2><p>Aberta há {openedFor} min · {selectedSession.people_count} pessoa(s) · {labels[selectedTable.status]}</p></div>
        <div><small>PARCIAL</small><strong>{money(selectedSession.total_cents || selectedSession.subtotal_cents)}</strong><button className="button outline" onClick={() => setSelectedTableId(null)}>Trocar mesa</button></div>
      </section>
      {selectedSession.status === "open" && <div className="waiter-order-layout">
        <section className="panel internal-menu">
          <div className="menu-tools"><input ref={productSearchRef} placeholder="Buscar produto..." value={search} onChange={event => setSearch(event.target.value)} /><div><button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>Todos</button>{categories.map(value => <button key={value.id} className={category === value.id ? "active" : ""} onClick={() => setCategory(value.id)}>{value.name}</button>)}</div></div>
          <div className="internal-product-grid">{visibleProducts.map(product => <article key={product.id}>
            {product.image_url ? <img src={product.image_url} alt="" /> : <div className="product-placeholder">MV</div>}
            <div><h3>{product.name}</h3><p>{product.description}</p><strong>{money(product.price_cents)}</strong></div>
            <button onClick={() => setCustomProduct(product)}>Adicionar</button>
          </article>)}</div>
        </section>
        <aside className="panel waiter-cart"><h2>Pedido da mesa</h2>{cart.length ? <div>{cart.map(item => <article key={item.key}><span>{item.quantity}× {item.product.name}</span><b>{money(itemPrice(item))}</b><button onClick={() => setCart(current => current.filter(value => value.key !== item.key))}>Remover</button>{item.notes && <small>{item.notes}</small>}</article>)}</div> : <div className="empty compact"><span>Adicione itens do cardápio.</span></div>}<footer><span>Total do envio</span><strong>{money(cartTotal)}</strong></footer><button className="button dark wide" disabled={!cart.length || busy} onClick={sendOrder}>Enviar para cozinha</button></aside>
      </div>}
      {selectedSession.status === "open" && serviceMode.bill_closing_enabled && <form className="panel close-account" onSubmit={closeAccount}>
        <div><h2>Fechar conta</h2><p>O valor só será marcado como pago após sua confirmação manual.</p></div>
        <div className="payment-operator closing-operator"><small>RESPONSÁVEL PELO FECHAMENTO</small><strong>{operatorName}</strong><span>O nome será registrado automaticamente no histórico da conta.</span></div>
        <div className="field"><label>TAXA DE SERVIÇO</label><select name="service" defaultValue="10"><option value="0">Sem taxa</option><option value="10">10%</option><option value="12">12%</option></select></div>
        {role !== "attendant" && <div className="field"><label>DESCONTO (R$)</label><input name="discount" inputMode="decimal" defaultValue="0,00" /></div>}
        <button className="button dark" disabled={busy || selectedSession.subtotal_cents <= 0}>Fechar conta</button>
      </form>}
      {["awaiting_payment", "paid"].includes(selectedSession.status) && <button className="button dark wide payment-launch" onClick={openPayment}>{selectedSession.status === "paid" ? "Ver comprovante e liberar mesa" : "Abrir pagamento"}</button>}
    </div>}

    {openTableId && <div className="checkout-overlay"><form className="waiter-modal form" onSubmit={openTable}><button type="button" className="checkout-close" onClick={() => setOpenTableId(null)}>×</button><small>NOVO ATENDIMENTO</small><h2>Identificar a mesa</h2><p>Não é necessário cadastrar a mesa antes.</p><div className="field"><label>NÚMERO OU NOME DA MESA</label><input name="table_label" required maxLength={40} placeholder="Ex.: 12, Varanda 3 ou Mesa Família" /></div><div className="field"><label>NOME E SOBRENOME DO CLIENTE</label><input name="customer" required maxLength={120} autoComplete="name" placeholder="Ex.: Maria Oliveira" /></div><div className="field"><label>QUANTIDADE DE PESSOAS</label><input name="people" type="number" min="1" max="99" defaultValue="1" /></div><div className="field"><label>OBSERVAÇÃO INICIAL</label><textarea name="note" /></div><button className="button dark wide" disabled={busy}>{busy ? "Abrindo..." : "Abrir atendimento"}</button></form></div>}
    {customProduct && <div className="checkout-overlay"><form className="waiter-modal form product-customizer" onSubmit={addCustomized}><button type="button" className="checkout-close" onClick={() => setCustomProduct(null)}>×</button><small>PERSONALIZAR ITEM</small><h2>{customProduct.name}</h2>{(customProduct.product_variations || []).filter(value => value.active).length > 0 && <div className="field"><label>VARIAÇÃO</label><select name="variation"><option value="">Padrão</option>{customProduct.product_variations?.filter(value => value.active).map(value => <option key={value.id} value={value.id}>{value.name} {value.price_delta_cents ? `+ ${money(value.price_delta_cents)}` : ""}</option>)}</select></div>}{addonsFor(customProduct).length > 0 && <div className="field"><label>ADICIONAIS</label><div className="addon-options">{addonsFor(customProduct).map(addon => <label key={addon.id}><input type="checkbox" name="addons" value={addon.id} /> {addon.name} · {money(addon.price_cents)}</label>)}</div></div>}<div className="field"><label>RETIRAR INGREDIENTES</label><input name="removed" placeholder="Ex.: cebola, tomate" /></div><div className="field"><label>OBSERVAÇÃO</label><textarea name="notes" placeholder="Ex.: ponto da carne" /></div><div className="field"><label>QUANTIDADE</label><input name="quantity" type="number" min="1" max="99" defaultValue="1" /></div><button className="button dark wide">Adicionar ao pedido</button></form></div>}
    {paymentOpen && selectedSession && selectedTable && <div className="checkout-overlay"><section className="waiter-modal payment-modal"><button className="checkout-close" onClick={() => setPaymentOpen(false)}>×</button><small>PAGAMENTO · MESA {selectedTable.table_number}</small><h2>{money(selectedSession.total_cents)}</h2><div className="account-values"><span>Subtotal <b>{money(selectedSession.subtotal_cents)}</b></span><span>Taxa de serviço <b>{money(selectedSession.service_fee_cents)}</b></span><span>Desconto <b>- {money(selectedSession.discount_cents)}</b></span></div><div className="payment-operator"><small>GARÇOM RESPONSÁVEL</small><strong>{operatorName}</strong><span>Este nome ficará salvo no fechamento e no relatório administrativo.</span></div>
      {selectedSession.status === "awaiting_payment" && <>{!pix ? <div className="payment-methods">{serviceMode.accepted_payment_methods.includes("pix") && <button className="button dark" disabled={busy} onClick={generatePix}>Gerar Pix oficial</button>}{serviceMode.accepted_payment_methods.includes("cash") && <button className="button outline" onClick={() => { setCashReceived((selectedSession.total_cents / 100).toFixed(2).replace(".", ",")); setCashOpen(true); }}>Pagar em dinheiro e calcular troco</button>}{serviceMode.accepted_payment_methods.includes("credit_card") && <button className="button outline" onClick={() => setCardMethod("credit_card")}>Crédito presencial</button>}{serviceMode.accepted_payment_methods.includes("debit_card") && <button className="button outline" onClick={() => setCardMethod("debit_card")}>Débito presencial</button>}</div> : <div className="pix-payment"><img src={pix.qr} alt="QR Code Pix" /><h3>{pix.receiver_name}</h3><p>{pix.receiver_document_masked} {pix.institution_name && `· ${pix.institution_name}`}</p><div className="security-warning">Confira no aplicativo do banco se o destinatário é: <b>{pix.receiver_name}</b>.</div><textarea readOnly value={pix.payload} /><button className="button outline wide" onClick={() => navigator.clipboard.writeText(pix.payload)}>Copiar Pix Copia e Cola</button><button className="button dark wide" disabled={busy} onClick={() => registerPayment("pix")}>Confirmar pagamento recebido</button><small>Gerar o QR Code não confirma o pagamento. Confira antes de continuar.</small></div>}</>}
      {selectedSession.status === "paid" && <div className="receipt-box"><b>Pagamento confirmado</b><p>Conta paga e bloqueada para novos lançamentos.</p>{receipt && <div className="payment-operator"><small>CONTA FECHADA POR</small><strong>{receipt.waiterName}</strong>{receipt.method === "cash" && <span>Troco: {money(receipt.cashChange || 0)}</span>}</div>}<button className="button outline wide" disabled={!receipt} onClick={downloadReceipt}>Baixar comprovante</button><button className="button outline wide" onClick={() => window.print()}>Imprimir</button><button className="button dark wide" onClick={releaseTable}>Fechar e liberar mesa</button></div>}
    </section></div>}
    {cashOpen && selectedSession && <div className="checkout-overlay"><form className="waiter-modal form cash-payment-form" onSubmit={registerCash}><button type="button" className="checkout-close" onClick={() => setCashOpen(false)}>×</button><span className="kicker">PAGAMENTO EM DINHEIRO</span><h2>Troco para quanto?</h2><div className="cash-total"><span>Valor da conta</span><strong>{money(selectedSession.total_cents)}</strong></div><div className="field cash-received-field"><label>CLIENTE PRECISA DE TROCO PARA (R$)</label><input value={cashReceived} onChange={event => setCashReceived(event.target.value)} onFocus={event => event.currentTarget.select()} inputMode="decimal" autoFocus required placeholder="Ex.: 200,00" /><small>Exemplo: conta de R$ 100,00 e troco para R$ 200,00 = devolver R$ 100,00.</small></div><div className="cash-change"><span>VALOR CERTO DO TROCO</span><strong>{money(Math.max(0, moneyInputToCents(cashReceived) - selectedSession.total_cents || 0))}</strong><small>Pegue este valor no caixa e leve ao cliente.</small></div><button className="button dark wide" disabled={busy || !Number.isFinite(moneyInputToCents(cashReceived)) || moneyInputToCents(cashReceived) < selectedSession.total_cents}>{busy ? "Registrando..." : "Confirmar pagamento e troco"}</button></form></div>}
    {cardMethod && selectedSession && <div className="checkout-overlay"><form className="waiter-modal form card-payment-form" onSubmit={registerCard}><button type="button" className="checkout-close" onClick={() => setCardMethod(null)}>×</button><span className="kicker">PAGAMENTO PRESENCIAL</span><h2>{cardMethod === "credit_card" ? "Cartão de crédito" : "Cartão de débito"}</h2><div className="security-warning"><b>Atenção:</b> envie apenas a foto do comprovante da maquininha. Nunca fotografe o cartão do cliente.</div><label className="photo-picker card-proof-picker"><input name="proof" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required={serviceMode.card_proof_required} /><span className="photo-picker-icon">▣</span><span><b>Abrir câmera e fotografar comprovante</b><small>{serviceMode.card_proof_required ? "Obrigatório neste estabelecimento" : "Opcional"} · câmera traseira · até 5 MB</small></span></label><div className="field"><label>MÁQUINA UTILIZADA (OPCIONAL)</label><input name="machine" placeholder="Ex.: Stone 02" /></div><div className="field"><label>REFERÊNCIA DA TRANSAÇÃO (OPCIONAL)</label><input name="reference" maxLength={80} /></div><div className="field"><label>OBSERVAÇÃO</label><textarea name="notes" /></div><button className="button dark wide" disabled={busy}>{busy ? "Registrando..." : `Confirmar ${money(selectedSession.total_cents)}`}</button></form></div>}
    {message && <div className={message.includes("enviado") ? "form-message form-success sticky-message" : "form-message sticky-message"}>{message}</div>}
  </div>;
}
