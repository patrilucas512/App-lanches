import { redirect } from "next/navigation";
import { PosConsole } from "@/components/pos-console";
import { createClient } from "@/lib/supabase/server";

export default async function PosPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/caixa/login");
  const { data: employee } = await supabase.from("custom_staff_members").select("id,establishment_id,name,status,employment_type,work_date,staff_roles!inner(financial_role)").eq("user_id", userId).eq("staff_roles.financial_role", true).maybeSingle();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  if (!employee || employee.status !== "active" || (employee.employment_type === "daily" && employee.work_date !== today)) redirect("/caixa/login");
  const { data: establishment } = await supabase.from("establishments").select("id,name").eq("id", employee.establishment_id).single();
  if (!establishment) redirect("/caixa/login");
  const [{ data: shift }, { data: registers }] = await Promise.all([
    supabase.from("cash_shifts").select("*,cash_registers(name)").eq("staff_member_id", employee.id).eq("status", "open").maybeSingle(),
    supabase.from("cash_registers").select("id,name,active").eq("establishment_id",establishment.id).eq("active",true).order("created_at"),
  ]);
  const openedAt = shift?.opened_at || new Date().toISOString();
  const [{ data: products }, { data: orders }, { data: orderItems }, { data: sales }, { data: payments }, { data: movements }, { data: paid }] = await Promise.all([
    supabase.from("products").select("id,name,price_cents,barcode,category_id").eq("establishment_id", establishment.id).eq("active", true).order("name"),
    supabase.from("orders").select("id,order_number,customer_name,total_cents,payment_method,created_at,status").eq("establishment_id", establishment.id).in("status", ["new", "accepted", "preparing", "ready"]).order("created_at"),
    supabase.from("order_items").select("order_id,product_name,quantity,total_cents").eq("establishment_id", establishment.id),
    shift ? supabase.from("pos_sales").select("id,sale_number,operator_name,payment_method,total_cents,created_at,source").eq("cash_shift_id", shift.id).eq("status", "completed").order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    supabase.from("table_payments").select("id,waiter_name,payment_method,amount_cents,table_number,confirmed_at,status").eq("establishment_id", establishment.id).eq("status", "confirmed").gte("confirmed_at", openedAt).order("confirmed_at", { ascending: false }),
    shift ? supabase.from("cash_movements").select("id,movement_type,category,payment_method,amount_cents,description,occurred_at,pos_sale_id").eq("cash_shift_id", shift.id).order("occurred_at", { ascending: false }) : Promise.resolve({ data: [] }),
    supabase.from("pos_sales").select("source_order_id").eq("establishment_id", establishment.id).eq("status", "completed").not("source_order_id", "is", null),
  ]);
  const paidIds = new Set((paid || []).map(item => item.source_order_id));
  const pending = (orders || []).filter(order => !paidIds.has(order.id)).map(order => ({ ...order, order_items: (orderItems || []).filter(item => item.order_id === order.id) }));
  const normalizedShift=shift?{...shift,cash_register_name:(shift.cash_registers as {name?:string}|null)?.name}:null;
  return <PosConsole establishmentName={establishment.name} employeeName={employee.name} registers={(registers||[]) as never[]} initialShift={normalizedShift as never} products={(products || []) as never[]} initialOrders={pending as never[]} tablePayments={(payments || []) as never[]} initialSales={(sales || []) as never[]} initialMovements={(movements || []) as never[]} />;
}
