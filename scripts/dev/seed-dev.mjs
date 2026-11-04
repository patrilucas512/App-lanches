// Fictitious data for the masterapp-dev project. It refuses to run against any other project.
// Usage: node scripts/dev/seed-dev.mjs. The owner password goes to .env.test-login.local, ignored by git.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";

const DEV_REF = "bfmrcvjxbmxxmdustrgo";
const PRODUCTION_REF = "qjwmjwubtgqginwhmajv";
const LOGIN_FILE = ".env.test-login.local";
const OWNER_EMAIL = "dono.teste@masterapp-dev.test";
const STORE_SLUG = "lanchonete-teste";
const MENU = [
  ["X-Burger Teste", 2490, "Pão, hambúrguer e queijo."],
  ["X-Salada Teste", 2790, "Pão, hambúrguer, queijo, alface e tomate."],
  ["Batata Frita Teste", 1590, "Porção de batata frita."],
  ["Refrigerante Teste", 690, "Lata de 350 ml."],
  ["Brownie Teste", 1190, "Brownie de chocolate."],
];

const env = parseEnv(readFileSync(".env.local", "utf8"));
const url = env.NEXT_PUBLIC_SUPABASE_URL || "";
const publishable = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = env.SUPABASE_SECRET_KEY;
if (url.includes(PRODUCTION_REF) || !url.includes(DEV_REF)) throw new Error("Este script só roda no masterapp-dev.");
if (!publishable || !secret) throw new Error("Defina a chave publishable e SUPABASE_SECRET_KEY no .env.local.");

const session = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, session);
const must = ({ data, error }, step) => { if (error) throw new Error(`${step}: ${error.message}`); return data; };

async function ensureOwner() {
  const { users } = must(await admin.auth.admin.listUsers(), "listar usuários");
  const existing = users.find((user) => user.email === OWNER_EMAIL);
  if (existing && existsSync(LOGIN_FILE)) return parseEnv(readFileSync(LOGIN_FILE, "utf8")).DEV_OWNER_PASSWORD;
  const password = `Dev-${randomBytes(12).toString("base64url")}`;
  if (existing) must(await admin.auth.admin.updateUserById(existing.id, { password }), "redefinir senha");
  else must(await admin.auth.admin.createUser({ email: OWNER_EMAIL, password, email_confirm: true, user_metadata: { full_name: "Dono Teste", phone: "(11) 90000-0001" } }), "criar usuário");
  writeFileSync(LOGIN_FILE, `# Login fictício do masterapp-dev.\nDEV_OWNER_EMAIL=${OWNER_EMAIL}\nDEV_OWNER_PASSWORD=${password}\n`);
  return password;
}

// create_establishment predates the required establishments.organization_id and fails for a new
// user, so this runs the same steps and also creates the organization.
async function createStoreLikeOnboarding() {
  const { users } = must(await admin.auth.admin.listUsers(), "listar usuários");
  const userId = users.find((user) => user.email === OWNER_EMAIL).id;
  const { id: planId } = must(await admin.from("plans").select("id").eq("code", "starter").single(), "ler plano");
  const { id: organizationId } = must(await admin.from("organizations").insert({ name: "Lanchonete Teste", slug: STORE_SLUG, created_by: userId, is_test_organization: true }).select("id").single(), "criar organização");
  const { id: store } = must(await admin.from("establishments").insert({ name: "Lanchonete Teste", slug: STORE_SLUG, email: OWNER_EMAIL, organization_id: organizationId }).select("id").single(), "criar estabelecimento");
  must(await admin.from("organization_members").insert({ organization_id: organizationId, user_id: userId, role: "owner", all_stores: true, active: true }), "vincular dono à organização");
  must(await admin.from("establishment_members").insert({ establishment_id: store, user_id: userId, role: "owner" }), "vincular dono à loja");
  must(await admin.from("establishment_settings").insert({ establishment_id: store }), "criar configurações");
  must(await admin.from("subscriptions").insert({ establishment_id: store, organization_id: organizationId, plan_id: planId, status: "trialing", billing_cycle: "monthly", trial_ends_at: new Date(Date.now() + 14 * 864e5).toISOString() }), "criar assinatura");
  must(await admin.from("business_hours").insert([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ establishment_id: store, weekday, opens_at: "00:00", closes_at: "23:59", closed: false }))), "criar horários");
  return store;
}

async function ensureStore(password) {
  const owner = createClient(url, publishable, session);
  must(await owner.auth.signInWithPassword({ email: OWNER_EMAIL, password }), "entrar como dono");
  const { data: found } = await admin.from("establishments").select("id,onboarding_completed").eq("slug", STORE_SLUG).maybeSingle();
  if (found?.onboarding_completed) return found.id;
  const id = found?.id || await createStoreLikeOnboarding();
  must(await owner.rpc("complete_establishment_onboarding", { payload: {
    establishment: { name: "Lanchonete Teste", description: "Loja fictícia para desenvolvimento.", phone: "(11) 90000-0001", logo_url: "", cover_url: "", accent_color: "#E85D04", secondary_color: "#1F2937", city: "São Paulo", state: "SP" },
    settings: { whatsapp: "(11) 90000-0001", address: { street: "Rua de Teste, 100", city: "São Paulo", state: "SP" }, pickup_enabled: true, delivery_enabled: true, minimum_order_cents: 0, estimated_minutes: 40, payment_methods: ["cash", "pix"] },
    operation: { opens_at: "00:00", closes_at: "23:59" },
    delivery_zone: { name: "Centro (teste)", fee_cents: 500, free_delivery_above_cents: 0 },
    // Left empty because this RPC also inserts categories and products without organization_id.
    product: { category: "", name: "", description: "", price_cents: 0, image_url: "", active: true },
  } }), "concluir onboarding");
  return id;
}

async function ensureMenu(store) {
  const { organization_id: organizationId } = must(await admin.from("establishments").select("organization_id").eq("id", store).single(), "ler organização");
  const { data: category } = await admin.from("categories").select("id").eq("establishment_id", store).eq("name", "Lanches").maybeSingle();
  const { id: categoryId } = category || must(await admin.from("categories").insert({ establishment_id: store, organization_id: organizationId, name: "Lanches", active: true, sort_order: 0 }).select("id").single(), "criar categoria");
  for (const [index, [name, price, description]] of MENU.entries()) {
    const { data: found } = await admin.from("products").select("id").eq("establishment_id", store).eq("name", name).maybeSingle();
    if (!found) must(await admin.from("products").insert({ establishment_id: store, organization_id: organizationId, category_id: categoryId, name, description, price_cents: price, active: true, sort_order: index }), `criar ${name}`);
  }
  return organizationId;
}

async function ensureTable(store) {
  const { data: found } = await admin.from("restaurant_tables").select("id").eq("establishment_id", store).eq("table_number", "1").maybeSingle();
  if (!found) must(await admin.from("restaurant_tables").insert({ establishment_id: store, table_number: "1", table_name: "Mesa 1", sector: "Salão", is_active: true }), "criar mesa");
}

async function ensureDriver(store) {
  let { data: role } = await admin.from("staff_roles").select("id").eq("establishment_id", store).eq("system_key", "driver").maybeSingle();
  if (!role) role = must(await admin.from("staff_roles").insert({ establishment_id: store, name: "Entregador", system_key: "driver" }).select("id").single(), "criar função de entregador");
  const { data: found } = await admin.from("custom_staff_members").select("id").eq("establishment_id", store).eq("name", "Entregador Teste").maybeSingle();
  const member = found || must(await admin.from("custom_staff_members").insert({ establishment_id: store, role_id: role.id, name: "Entregador Teste", phone: "(11) 90000-0002", status: "active", employment_type: "fixed", payment_cycle: "monthly" }).select("id").single(), "criar colaborador");
  const { data: profile } = await admin.from("driver_profiles").select("id").eq("custom_staff_member_id", member.id).maybeSingle();
  if (!profile) must(await admin.from("driver_profiles").insert({ establishment_id: store, custom_staff_member_id: member.id, phone: "(11) 90000-0002", vehicle_type: "motorcycle", vehicle_model: "Moto Teste", vehicle_plate: "TST0A00", approval_status: "approved", active: true, driver_kind: "fixed" }), "criar entregador");
}

// The core E2E (Phase 97C) covers the customer portal, which answers 404 while the store has no enabled config.
async function ensurePortal(store) {
  const { data: found } = await admin.from("customer_portal_configs").select("establishment_id").eq("establishment_id", store).maybeSingle();
  if (found) return void must(await admin.from("customer_portal_configs").update({ enabled: true }).eq("establishment_id", store), "ligar portal do cliente");
  const { data: establishment } = await admin.from("establishments").select("organization_id").eq("id", store).single();
  must(await admin.from("customer_portal_configs").insert({ establishment_id: store, organization_id: establishment.organization_id, enabled: true }), "ligar portal do cliente");
}

// Fase 98D: garçom, cozinha, caixa e entregador com login, criados pelo mesmo caminho da tela do dono
// (manage_waiter, manage_kitchen_operator, custom_staff_members) e ativados pela função de ativação real
// (activate-*-access), como o funcionário faz ao abrir o convite. As senhas vão para o .env.test-login.local.
const STAFF = {
  waiter: { name: "Garcom Teste", phone: "(11) 90000-0003", env: "DEV_WAITER" },
  kitchen: { name: "Cozinha Teste", phone: "(11) 90000-0004", env: "DEV_KITCHEN" },
  cashier: { name: "Caixa Teste", phone: "(11) 90000-0005", env: "DEV_CASHIER" },
  driver: { name: "Entregador Teste", phone: "(11) 90000-0002", env: "DEV_DRIVER" },
};

function saveLogin(values) {
  const current = existsSync(LOGIN_FILE) ? parseEnv(readFileSync(LOGIN_FILE, "utf8")) : {};
  const next = { ...current, ...values };
  writeFileSync(LOGIN_FILE, `# Login fictício do masterapp-dev.\n${Object.entries(next).map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
}

async function ensureStaffRecords(store, owner) {
  const ids = {};
  const { data: waiter } = await admin.from("waiters").select("id").eq("establishment_id", store).eq("name", STAFF.waiter.name).maybeSingle();
  ids.waiter = waiter?.id || must(await owner.rpc("manage_waiter", { requested_establishment_id: store, requested_waiter_id: null, requested_values: {
    name: STAFF.waiter.name, phone: STAFF.waiter.phone, email: "", sector: "Salão", status: "active", active_now: true, shift_start: "", shift_end: "",
    employment_type: "fixed", work_date: "", payment_cycle: "monthly",
    permissions: { open_tables: true, create_orders: true, close_bills: true, register_payments: true, apply_discount: false, cancel_items: false },
  } }), "criar garçom").id;
  const { data: cook } = await admin.from("kitchen_operators").select("id").eq("establishment_id", store).eq("name", STAFF.kitchen.name).maybeSingle();
  ids.kitchen = cook?.id || must(await owner.rpc("manage_kitchen_operator", { requested_establishment_id: store, requested_operator_id: null, requested_values: {
    name: STAFF.kitchen.name, phone: STAFF.kitchen.phone, status: "active", access_type: "fixed", work_date: "", payment_cycle: "monthly", device_mode: "dedicated",
    permissions: { accept_orders: true, print_orders: true, mark_ready: true },
  } }), "criar operador da cozinha").id;
  let { data: cashierRole } = await admin.from("staff_roles").select("id").eq("establishment_id", store).eq("financial_role", true).limit(1).maybeSingle();
  if (!cashierRole) cashierRole = must(await owner.from("staff_roles").insert({ establishment_id: store, name: "Caixa", description: "Operador de caixa", color: "#7b2326", financial_role: true }).select("id").single(), "criar função de caixa");
  const { data: cashier } = await admin.from("custom_staff_members").select("id").eq("establishment_id", store).eq("name", STAFF.cashier.name).maybeSingle();
  ids.cashier = cashier?.id || must(await owner.from("custom_staff_members").insert({ establishment_id: store, role_id: cashierRole.id, name: STAFF.cashier.name, phone: STAFF.cashier.phone, status: "active", employment_type: "fixed", payment_cycle: "monthly" }).select("id").single(), "criar operador de caixa").id;
  ids.driver = must(await admin.from("custom_staff_members").select("id").eq("establishment_id", store).eq("name", STAFF.driver.name).single(), "ler entregador").id;
  return ids;
}

async function ensureStaffLogins(store, ownerPassword) {
  const owner = createClient(url, publishable, session);
  must(await owner.auth.signInWithPassword({ email: OWNER_EMAIL, password: ownerPassword }), "entrar como dono");
  const ids = await ensureStaffRecords(store, owner);
  const saved = existsSync(LOGIN_FILE) ? parseEnv(readFileSync(LOGIN_FILE, "utf8")) : {};
  const invite = { waiter: ["create_waiter_invite", "requested_waiter_id"], kitchen: ["create_kitchen_invite", "requested_operator_id"],
    cashier: ["create_cashier_invite", "requested_member_id"], driver: ["create_driver_invite", "requested_member_id"] };
  const tables = { waiter: "waiters", kitchen: "kitchen_operators", cashier: "custom_staff_members", driver: "custom_staff_members" };
  const logins = {};
  for (const [kind, staff] of Object.entries(STAFF)) {
    const { data: row } = await admin.from(tables[kind]).select("user_id").eq("id", ids[kind]).single();
    if (row?.user_id && saved[`${staff.env}_PASSWORD`]) continue;
    const [rpc, arg] = invite[kind];
    const created = must(await owner.rpc(rpc, { [arg]: ids[kind] }), `convite ${kind}`);
    const token = typeof created === "string" ? created : created?.token;
    const password = `Dev-${randomBytes(12).toString("base64url")}`;
    const response = await fetch(`${url}/functions/v1/activate-${kind}-access`, {
      method: "POST", headers: { "content-type": "application/json", apikey: publishable, authorization: `Bearer ${publishable}`, origin: "http://localhost:3000" },
      body: JSON.stringify({ token, password }),
    });
    if (!response.ok) throw new Error(`ativar ${kind}: ${response.status} ${(await response.text()).slice(0, 200)}`);
    logins[`${staff.env}_NAME`] = staff.name;
    logins[`${staff.env}_PASSWORD`] = password;
    saveLogin(logins);
  }
  return Object.keys(STAFF);
}

// Fase 98B: a loja de teste roda no plano Piloto, o mesmo que a loja piloto vai usar.
async function ensurePilotPlan(store) {
  const { data: pilot } = await admin.from("plans").select("id").eq("code", "piloto").maybeSingle();
  if (!pilot) return console.warn("Plano Piloto ausente: aplique a migration 20261104131000_phase98b_pilot_plan.");
  must(await admin.from("subscriptions").update({ plan_id: pilot.id }).eq("establishment_id", store), "mudar para o plano Piloto");
}

const password = await ensureOwner();
const store = await ensureStore(password);
await ensureMenu(store);
await ensureTable(store);
await ensureDriver(store);
await ensurePortal(store);
await ensurePilotPlan(store);
await ensureStaffLogins(store, password);
const totals = {};
for (const table of ["products", "restaurant_tables", "driver_profiles"]) totals[table] = (await admin.from(table).select("id", { count: "exact", head: true }).eq("establishment_id", store)).count;
console.log(JSON.stringify({ store: STORE_SLUG, owner: OWNER_EMAIL, loginFile: LOGIN_FILE, ...totals }));
