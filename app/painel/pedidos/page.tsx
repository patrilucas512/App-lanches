import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { WaiterConsole } from "@/components/waiter-console";
import { WaiterOrderTracker } from "@/components/waiter-order-tracker";
import { WeeklySalesReport } from "@/components/weekly-sales-report";
import { getDashboardContext } from "@/lib/dashboard";
import { currentWeekDateKeys, saoPauloDateKey } from "@/lib/business-hours";

export default async function OrdersPage() {
  const { supabase, establishment, member, userId } = await getDashboardContext();
  if (!["owner", "manager"].includes(member.role)) redirect("/painel/garcom");

  const recentDate = new Date(Date.now() - 9 * 86400000).toISOString();
  const [{ data: tables }, { data: sessions }, { data: products }, { data: categories }, { data: serviceMode }, { data: tickets }, { data: tableOrders }, { data: publicOrders }, { data: profile }, { data: weeklyPublicOrders }, { data: weeklyTableOrders }] = await Promise.all([
    supabase.from("restaurant_tables").select("*").eq("establishment_id", establishment.id).eq("is_active", true).order("table_number"),
    supabase.from("table_sessions").select("*").eq("establishment_id", establishment.id).in("status", ["open", "awaiting_payment", "paid"]),
    supabase.from("products").select("id,name,description,image_url,price_cents,category_id,product_variations(id,name,price_delta_cents,active),product_addon_groups(addon_groups(id,name,addons(id,name,price_cents,active)))").eq("establishment_id", establishment.id).eq("active", true).order("sort_order"),
    supabase.from("categories").select("id,name").eq("establishment_id", establishment.id).eq("active", true).order("sort_order"),
    supabase.from("service_modes").select("*").eq("establishment_id", establishment.id).single(),
    supabase.from("kitchen_tickets").select("*").eq("establishment_id", establishment.id).neq("status", "canceled").order("created_at", { ascending: false }).limit(100),
    supabase.from("table_orders").select("id,table_session_id,order_number,kitchen_status,created_at,table_order_items(total_cents),table_sessions(customer_name,restaurant_tables(table_number))").eq("establishment_id", establishment.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("orders").select("id,restaurant_table_id,order_number,customer_name,fulfillment_type,total_cents,status,created_at,restaurant_tables(table_number)").eq("establishment_id", establishment.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    supabase.from("orders").select("id,order_number,customer_name,total_cents,status,created_at,fulfillment_type,restaurant_tables(table_number),order_items(product_name,quantity,unit_price_cents,total_cents)").eq("establishment_id", establishment.id).gte("created_at", recentDate),
    supabase.from("table_orders").select("id,order_number,kitchen_status,created_at,table_order_items(product_name,quantity,unit_price_cents,total_cents),table_sessions(customer_name,restaurant_tables(table_number))").eq("establishment_id", establishment.id).gte("created_at", recentDate),
  ]);
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const weekKeys = currentWeekDateKeys();
  const weekDayNames = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
  const weeklyStats = weekKeys.map((dateKey, index) => {
    const publicDay = (weeklyPublicOrders || []).filter(order => order.status !== "canceled" && saoPauloDateKey(new Date(order.created_at)) === dateKey);
    const tableDay = (weeklyTableOrders || []).filter(order => order.kitchen_status !== "canceled" && saoPauloDateKey(new Date(order.created_at)) === dateKey);
    const publicTotal = publicDay.reduce((sum, order) => sum + order.total_cents, 0);
    const tableTotal = tableDay.reduce((sum, order) => sum + (order.table_order_items || []).reduce((itemSum, item) => itemSum + item.total_cents, 0), 0);
    const items = [...publicDay.flatMap(order => order.order_items || []), ...tableDay.flatMap(order => order.table_order_items || [])];
    const itemTotals = Array.from(items.reduce((grouped, item) => {
      const key = `${item.product_name}::${item.unit_price_cents}`;
      const current = grouped.get(key) || { name: item.product_name, quantity: 0, unitPriceCents: item.unit_price_cents, totalCents: 0 };
      current.quantity += item.quantity;
      current.totalCents += item.total_cents;
      grouped.set(key, current);
      return grouped;
    }, new Map<string, { name: string; quantity: number; unitPriceCents: number; totalCents: number }>()).values()).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
    const dayOrders = [
      ...publicDay.map(order => {
        const table = Array.isArray(order.restaurant_tables) ? order.restaurant_tables[0] : order.restaurant_tables;
        return { id: order.id, number: order.order_number, customer: order.customer_name, location: order.fulfillment_type === "dine_in" ? table?.table_number || "Salão" : order.fulfillment_type === "delivery" ? "Entrega" : "Balcão", totalCents: order.total_cents, status: order.status, createdAt: order.created_at };
      }),
      ...tableDay.map(order => {
        const session = Array.isArray(order.table_sessions) ? order.table_sessions[0] : order.table_sessions;
        const table = Array.isArray(session?.restaurant_tables) ? session?.restaurant_tables[0] : session?.restaurant_tables;
        return { id: order.id, number: order.order_number, customer: session?.customer_name || "Cliente do salão", location: table?.table_number || "Salão", totalCents: (order.table_order_items || []).reduce((sum, item) => sum + item.total_cents, 0), status: order.kitchen_status, createdAt: order.created_at };
      }),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { dateKey, label: weekDayNames[index], publicCount: publicDay.length, tableCount: tableDay.length, count: publicDay.length + tableDay.length, total: publicTotal + tableTotal, itemTotals, orders: dayOrders };
  });
  const todayKey = saoPauloDateKey(new Date());
  const validPublicOrders = (weeklyPublicOrders || []).filter(order => order.status !== "canceled" && weekKeys.includes(saoPauloDateKey(new Date(order.created_at))));
  const validTableOrders = (weeklyTableOrders || []).filter(order => order.kitchen_status !== "canceled" && weekKeys.includes(saoPauloDateKey(new Date(order.created_at))));
  const tableOrderTotal = (order: (typeof validTableOrders)[number]) => (order.table_order_items || []).reduce((sum, item) => sum + item.total_cents, 0);
  const counterOrders = validPublicOrders.filter(order => order.fulfillment_type !== "dine_in");
  const diningOrders = validPublicOrders.filter(order => order.fulfillment_type === "dine_in");
  const channelStats = [
    { label: "Cozinha", detail: "Todos os pedidos preparados", count: validPublicOrders.length + validTableOrders.length, total: validPublicOrders.reduce((sum, order) => sum + order.total_cents, 0) + validTableOrders.reduce((sum, order) => sum + tableOrderTotal(order), 0) },
    { label: "Balcão", detail: "Retirada e pedidos de entrega", count: counterOrders.length, total: counterOrders.reduce((sum, order) => sum + order.total_cents, 0) },
    { label: "Salão", detail: "Mesas e consumo no local", count: diningOrders.length + validTableOrders.length, total: diningOrders.reduce((sum, order) => sum + order.total_cents, 0) + validTableOrders.reduce((sum, order) => sum + tableOrderTotal(order), 0) },
  ];
  const historyRows = [
    ...(publicOrders || []).map(order => ({
      id: order.id, number: order.order_number, customer: order.customer_name, table: order.fulfillment_type === "dine_in" ? (Array.isArray(order.restaurant_tables) ? order.restaurant_tables[0]?.table_number : order.restaurant_tables?.table_number) || "Informada no pedido" : "—",
      totalCents: order.total_cents, status: order.status, createdAt: order.created_at,
    })),
    ...(tableOrders || []).map(order => {
      const session = Array.isArray(order.table_sessions) ? order.table_sessions[0] : order.table_sessions;
      const table = Array.isArray(session?.restaurant_tables) ? session?.restaurant_tables[0] : session?.restaurant_tables;
      return { id: order.id, number: order.order_number, customer: session?.customer_name || "Cliente do salão", table: table?.table_number || "Informada no atendimento", totalCents: (order.table_order_items || []).reduce((sum, item) => sum + item.total_cents, 0), status: order.kitchen_status, createdAt: order.created_at };
    }),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const historyTotal = historyRows.filter(order => order.status !== "canceled").reduce((sum, order) => sum + order.totalCents, 0);

  return <DashboardShell active="orders" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head">
      <div><small>OPERAÇÃO CENTRALIZADA</small><h1>Pedidos da loja.</h1><p>Acompanhe cozinha, balcão, salão, vendas e histórico em uma única área.</p></div>
      <span className="status-pill">Tempo real</span>
    </header>

    <section className="order-channel-grid" aria-label="Resumo dos canais de atendimento">
      {channelStats.map(channel => <article className="panel" key={channel.label}>
        <small>MODO {channel.label.toUpperCase()}</small><h2>{channel.label}</h2><p>{channel.detail}</p>
        <div><strong>{channel.count}</strong><span>pedidos</span><b>{money.format(channel.total / 100)}</b></div>
      </article>)}
    </section>

    <WeeklySalesReport days={weeklyStats} todayKey={todayKey} />

    <section id="mesas-e-pedidos">
      {serviceMode?.waiter_mode_enabled && <WaiterOrderTracker establishmentId={establishment.id} initial={{
        tickets: tickets || [],
        orders: tableOrders || [],
        sessions: (sessions || []).map(session => ({ id: session.id, table_id: session.table_id })),
        tables: (tables || []).map(table => ({ id: table.id, table_number: table.table_number })),
        publicOrders: publicOrders || [],
      }} />}

      {serviceMode?.waiter_mode_enabled && <WaiterConsole establishmentId={establishment.id} establishmentName={establishment.name} userId={userId}
        operatorName={profile?.full_name || "Administrador"}
        role={member.role} initialTables={tables || []} initialSessions={sessions || []}
        products={(products || []) as never[]} categories={categories || []}
        serviceMode={serviceMode as never} />}
    </section>

    <article className="panel" id="historico-pedidos">
      <header className="team-group-head"><div><small>HISTÓRICO</small><h2>Pedidos registrados</h2><p>Todos os pedidos do estabelecimento permanecem disponíveis para conferência.</p></div><div className="weekly-orders-total"><span>{historyRows.length} registrados</span><strong>{money.format(historyTotal / 100)}</strong></div></header>
      {historyRows.length
        ? <div className="team-report-scroll"><table className="table">
          <thead><tr><th>NÚMERO</th><th>CLIENTE</th><th>MESA</th><th>VALOR</th><th>STATUS</th><th>DATA</th></tr></thead>
          <tbody>{historyRows.map(order => <tr key={order.id}>
              <td>#{order.number}</td>
              <td>{order.customer}</td>
              <td>{order.table}</td>
              <td>{money.format(order.totalCents / 100)}</td>
              <td>{order.status}</td>
              <td>{new Date(order.createdAt).toLocaleDateString("pt-BR")}</td>
            </tr>)}</tbody>
        </table></div>
        : <div className="empty"><b>Nenhum pedido ainda.</b><span>Os pedidos reais da sua loja aparecerão aqui.</span></div>}
    </article>
  </DashboardShell>;
}
