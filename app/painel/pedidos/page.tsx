import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { WaiterConsole } from "@/components/waiter-console";
import { WaiterOrderTracker } from "@/components/waiter-order-tracker";
import { getDashboardContext } from "@/lib/dashboard";

export default async function OrdersPage() {
  const { supabase, establishment, member, userId } = await getDashboardContext();
  if (!["owner", "manager"].includes(member.role)) redirect("/painel/garcom");

  const [{ data: tables }, { data: sessions }, { data: products }, { data: categories }, { data: serviceMode }, { data: tickets }, { data: tableOrders }, { data: publicOrders }, { data: profile }] = await Promise.all([
    supabase.from("restaurant_tables").select("*").eq("establishment_id", establishment.id).eq("is_active", true).order("table_number"),
    supabase.from("table_sessions").select("*").eq("establishment_id", establishment.id).in("status", ["open", "awaiting_payment", "paid"]),
    supabase.from("products").select("id,name,description,image_url,price_cents,category_id,product_variations(id,name,price_delta_cents,active),product_addon_groups(addon_groups(id,name,addons(id,name,price_cents,active)))").eq("establishment_id", establishment.id).eq("active", true).order("sort_order"),
    supabase.from("categories").select("id,name").eq("establishment_id", establishment.id).eq("active", true).order("sort_order"),
    supabase.from("service_modes").select("*").eq("establishment_id", establishment.id).single(),
    supabase.from("kitchen_tickets").select("*").eq("establishment_id", establishment.id).neq("status", "canceled").order("created_at", { ascending: false }).limit(100),
    supabase.from("table_orders").select("id,table_session_id,order_number,created_at").eq("establishment_id", establishment.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("orders").select("id,restaurant_table_id,order_number,customer_name,fulfillment_type,total_cents,status,created_at,restaurant_tables(table_number)").eq("establishment_id", establishment.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

  return <DashboardShell active="orders" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head">
      <div><small>OPERAÇÃO CENTRALIZADA</small><h1>Pedidos e mesas.</h1><p>Controle o salão, os pedidos e os fechamentos em uma única área.</p></div>
      <span className="status-pill">Tempo real</span>
    </header>

    <section id="mesas-e-pedidos">
      {serviceMode?.waiter_mode_enabled ? <WaiterOrderTracker establishmentId={establishment.id} initial={{
        tickets: tickets || [],
        orders: tableOrders || [],
        sessions: (sessions || []).map(session => ({ id: session.id, table_id: session.table_id })),
        tables: (tables || []).map(table => ({ id: table.id, table_number: table.table_number })),
        publicOrders: publicOrders || [],
      }} /> : <section className="panel waiter-mode-off"><b>Modo garçom desativado</b><p>Os pedidos diretos continuam somente na cozinha e no balcão. Ative o modo garçom em Atendimento para controlar as mesas nesta área.</p></section>}

      <WaiterConsole establishmentId={establishment.id} establishmentName={establishment.name} userId={userId}
        operatorName={profile?.full_name || "Administrador"}
        role={member.role} initialTables={tables || []} initialSessions={sessions || []}
        products={(products || []) as never[]} categories={categories || []}
        serviceMode={serviceMode as never} />
    </section>

    <article className="panel" id="historico-pedidos">
      <header className="team-group-head"><div><small>HISTÓRICO</small><h2>Pedidos registrados</h2><p>Todos os pedidos do estabelecimento permanecem disponíveis para conferência.</p></div><span className="status-pill">{publicOrders?.length ?? 0} registrados</span></header>
      {publicOrders?.length
        ? <div className="team-report-scroll"><table className="table">
          <thead><tr><th>NÚMERO</th><th>CLIENTE</th><th>MESA</th><th>VALOR</th><th>STATUS</th><th>DATA</th></tr></thead>
          <tbody>{publicOrders.map(order => {
            const tableValue = Array.isArray(order.restaurant_tables)
              ? order.restaurant_tables[0]
              : order.restaurant_tables;
            return <tr key={order.id}>
              <td>#{order.order_number}</td>
              <td>{order.customer_name}</td>
              <td>{order.fulfillment_type === "dine_in" ? tableValue?.table_number || "Informada no pedido" : "—"}</td>
              <td>{money.format(order.total_cents / 100)}</td>
              <td>{order.status}</td>
              <td>{new Date(order.created_at).toLocaleDateString("pt-BR")}</td>
            </tr>;
          })}</tbody>
        </table></div>
        : <div className="empty"><b>Nenhum pedido ainda.</b><span>Os pedidos reais da sua loja aparecerão aqui.</span></div>}
    </article>
  </DashboardShell>;
}
