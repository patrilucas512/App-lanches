import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { canDismiss, canSnooze } from "@/lib/notifications/core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE = ["unread", "read", "acknowledged", "in_progress", "snoozed"];
const R = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });

async function auth(storeId: string) {
  if (!UUID.test(storeId)) throw new Error("FORBIDDEN");
  const client = await createClient(), { data: claims } = await client.auth.getClaims(), userId = String(claims?.claims?.sub || "");
  if (!userId) throw new Error("AUTH");
  const { data: store } = await client.from("establishments").select("id,organization_id").eq("id", storeId).maybeSingle();
  if (!store) throw new Error("FORBIDDEN");
  const [{ data: local }, { data: org }] = await Promise.all([
    client.from("establishment_members").select("role,status").eq("establishment_id", storeId).eq("user_id", userId).eq("status", "active").maybeSingle(),
    client.from("organization_members").select("role,all_stores,active").eq("organization_id", store.organization_id).eq("user_id", userId).eq("active", true).maybeSingle(),
  ]);
  if (!local && !org) throw new Error("FORBIDDEN");
  const role = String(org?.role || local?.role || "viewer"), manage = ["owner", "admin", "manager"].includes(role), a = createAdminClient();
  let stores = [storeId];
  if (org?.all_stores) stores = (await a.from("establishments").select("id").eq("organization_id", store.organization_id)).data?.map((x: { id: string }) => x.id) || stores;
  return { a, userId, organizationId: store.organization_id, storeId, stores, role, manage };
}

function tabQuery(query: any, tab: string, userId: string) {
  if (tab === "action") return query.eq("requires_action", true).in("status", ACTIVE);
  if (tab === "critical") return query.eq("priority", "critical").in("status", ACTIVE);
  if (tab === "approvals") return query.eq("category", "approvals").in("status", ACTIVE);
  if (tab === "operation") return query.in("category", ["orders", "payments", "inventory", "operation"]).in("status", ACTIVE);
  if (tab === "system") return query.in("category", ["system", "security", "automation"]).in("status", ACTIVE);
  if (tab === "all") return query;
  return query.or(`recipient_user_id.eq.${userId},assigned_to.eq.${userId}`).in("status", ACTIVE);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url), c = await auth(String(url.searchParams.get("store_id") || ""));
    const tab = String(url.searchParams.get("tab") || "mine"), limit = Math.min(50, Math.max(10, Number(url.searchParams.get("limit") || 30)));
    let q: any = c.a.from("notification_inbox_items").select("*").eq("organization_id", c.organizationId).or(`store_id.is.null,store_id.in.(${c.stores.join(",")})`).order("created_at", { ascending: false }).limit(limit);
    q = tabQuery(q, tab, c.userId);
    for (const [key, column] of [["priority", "priority"], ["category", "category"], ["status", "status"], ["assignee", "assigned_to"]] as const) {
      const value = url.searchParams.get(key); if (value) q = q.eq(column, value);
    }
    const cursor = url.searchParams.get("cursor"); if (cursor) q = q.lt("created_at", cursor);
    const store = url.searchParams.get("unit"); if (store && c.stores.includes(store)) q = q.eq("store_id", store);
    const period = Number(url.searchParams.get("days") || 0); if (period > 0) q = q.gte("created_at", new Date(Date.now() - Math.min(365, period) * 86400000).toISOString());
    const [itemsR, unreadR, actionR, criticalR, preferencesR, viewsR, storesR] = await Promise.all([
      q,
      c.a.from("notification_inbox_items").select("id", { count: "exact", head: true }).eq("organization_id", c.organizationId).or(`store_id.is.null,store_id.in.(${c.stores.join(",")})`).or(`recipient_user_id.eq.${c.userId},assigned_to.eq.${c.userId}`).eq("status", "unread"),
      c.a.from("notification_inbox_items").select("id", { count: "exact", head: true }).eq("organization_id", c.organizationId).or(`store_id.is.null,store_id.in.(${c.stores.join(",")})`).eq("requires_action", true).in("status", ACTIVE),
      c.a.from("notification_inbox_items").select("id", { count: "exact", head: true }).eq("organization_id", c.organizationId).or(`store_id.is.null,store_id.in.(${c.stores.join(",")})`).eq("priority", "critical").in("status", ACTIVE),
      c.a.from("notification_user_preferences").select("*").eq("organization_id", c.organizationId).eq("user_id", c.userId),
      c.a.from("notification_saved_views").select("*").eq("organization_id", c.organizationId).eq("user_id", c.userId).order("pinned", { ascending: false }),
      c.a.from("establishments").select("id,name").eq("organization_id", c.organizationId).in("id", c.stores).order("name"),
    ]);
    if (itemsR.error) throw itemsR.error;
    const items = itemsR.data || [], assigneeIds = [...new Set(items.map((x: any) => x.assigned_to).filter(Boolean))];
    const profiles = assigneeIds.length ? (await c.a.from("profiles").select("id,full_name").in("id", assigneeIds)).data || [] : [];
    return R({ items, counts: { unread: unreadR.count || 0, action: actionR.count || 0, critical: criticalR.count || 0 }, preferences: preferencesR.data || [], saved_views: viewsR.data || [], stores: storesR.data || [], profiles, role: c.role, can_manage: c.manage, next_cursor: items.length === limit ? items.at(-1)?.created_at : null, realtime_table: "notification_inbox_items" });
  } catch (error: any) { const message = error?.message || "Falha"; return R({ error: message }, message === "AUTH" ? 401 : message === "FORBIDDEN" ? 403 : 500); }
}

async function audit(c: any, itemId: string | null, action: string, before: any, after: any, reason?: string) {
  await c.a.from("notification_audit_events").insert({ organization_id: c.organizationId, inbox_item_id: itemId, actor_user_id: c.userId, action, reason: reason || null, before_state: before || null, after_state: after || null, correlation_id: randomUUID() });
}

export async function POST(req: Request) {
  try {
    const body = await req.json(), c = await auth(String(body.store_id || "")), action = String(body.action || "");
    if (action === "preferences") {
      const category = String(body.category || "general"), payload = { organization_id: c.organizationId, user_id: c.userId, category, inbox_enabled: true, email_enabled: Boolean(body.email_enabled), push_enabled: body.push_enabled !== false, whatsapp_enabled: Boolean(body.whatsapp_enabled), digest_mode: body.digest_mode || "off", quiet_hours: body.quiet_hours || {}, priority_threshold: body.priority_threshold || "low", timezone: body.timezone || "America/Sao_Paulo", updated_at: new Date().toISOString() };
      const { data, error } = await c.a.from("notification_user_preferences").upsert(payload, { onConflict: "organization_id,user_id,category" }).select().single(); if (error) throw error; return R({ preference: data });
    }
    if (action === "save_view") {
      const { data, error } = await c.a.from("notification_saved_views").insert({ organization_id: c.organizationId, user_id: c.userId, name: String(body.name || "Minha visão").slice(0, 80), filters: body.filters || {}, pinned: Boolean(body.pinned) }).select().single(); if (error) throw error; return R({ view: data }, 201);
    }
    const ids = [...new Set((body.ids || [body.id]).filter((id: unknown) => typeof id === "string" && UUID.test(id as string)))].slice(0, 50) as string[];
    if (!ids.length) return R({ error: "Selecione uma notificação." }, 400);
    const { data: rows, error: rowsError } = await c.a.from("notification_inbox_items").select("*").eq("organization_id", c.organizationId).or(`store_id.is.null,store_id.in.(${c.stores.join(",")})`).in("id", ids); if (rowsError) throw rowsError;
    if ((rows || []).length !== ids.length) throw new Error("FORBIDDEN");
    const now = new Date().toISOString();
    if (action === "claim") {
      if (ids.length !== 1) return R({ error: "Assuma um item por vez." }, 400);
      const { data } = await c.a.from("notification_inbox_items").update({ assigned_to: c.userId, status: "in_progress" }).eq("id", ids[0]).eq("organization_id", c.organizationId).is("assigned_to", null).select().maybeSingle();
      if (!data) return R({ error: "Este item já foi assumido por outra pessoa." }, 409); await audit(c, ids[0], "claimed", rows?.[0], data); return R({ item: data });
    }
    let patch: Record<string, unknown> = {};
    if (action === "mark_read") patch = { status: "read", read_at: now };
    else if (action === "acknowledge") patch = { status: "acknowledged", acknowledged_at: now, read_at: now };
    else if (action === "assign") { const assignee = body.assignee_id === "self" ? c.userId : body.assignee_id || c.userId; if (!c.manage && assignee !== c.userId) throw new Error("FORBIDDEN"); if (!UUID.test(assignee)) return R({ error: "Responsável inválido." }, 400); patch = { assigned_to: assignee, status: "in_progress" }; }
    else if (action === "unassign") { if (!c.manage) throw new Error("FORBIDDEN"); patch = { assigned_to: null, status: "read" }; }
    else if (action === "snooze") {
      if ((rows || []).some((x: any) => !canSnooze(x.priority, x.metadata?.mandatory))) return R({ error: "Notificação crítica ou obrigatória não pode ser adiada." }, 409);
      const minutes = Math.min(10080, Math.max(5, Number(body.minutes || 60))); patch = { status: "snoozed", snoozed_until: new Date(Date.now() + minutes * 60000).toISOString() };
    }
    else if (action === "dismiss") { if ((rows || []).some((x: any) => !canDismiss(x.priority, x.requires_action))) return R({ error: "Este tipo exige tratamento e não pode ser descartado." }, 409); patch = { status: "dismissed", dismissed_at: now }; }
    else if (action === "resolve_inbox") patch = { status: "resolved", resolved_at: now };
    else if (action === "create_task") {
      if (ids.length !== 1) return R({ error: "Crie uma tarefa por notificação." }, 400); const item = rows?.[0];
      const { data: task, error } = await c.a.from("internal_tasks").insert({ title: item.title, description: item.summary, task_type: "action_item", status: "backlog", priority: item.priority === "critical" ? "urgent" : item.priority, source_type: "notification_inbox_item", source_id: item.id, created_by_user_id: c.userId, assigned_to_user_id: body.assignee_id || c.userId, due_at: item.action_deadline }).select().single(); if (error) throw error;
      const { data: updated } = await c.a.from("notification_inbox_items").update({ linked_task_id: task.id, assigned_to: body.assignee_id || c.userId, status: "in_progress" }).eq("id", item.id).select().single(); await audit(c, item.id, "task_created", item, updated); return R({ item: updated, task }, 201);
    }
    else if (action === "open_source") {
      if (ids.length !== 1) return R({ error: "Abra um item por vez." }, 400); const item = rows?.[0]; await audit(c, item.id, "source_opened", item, item); return R({ route: item.route, source_type: item.source_type, source_id: item.source_id, revalidate_source: true });
    }
    else return R({ error: "Ação inválida." }, 400);
    const { data, error } = await c.a.from("notification_inbox_items").update(patch).eq("organization_id", c.organizationId).in("id", ids).select(); if (error) throw error;
    await Promise.all((data || []).map((item: any) => audit(c, item.id, action, (rows || []).find((x: any) => x.id === item.id), item, body.reason)));
    return R({ items: data, source_entities_changed: false });
  } catch (error: any) { const message = error?.message || "Falha"; return R({ error: message }, message === "AUTH" ? 401 : message === "FORBIDDEN" ? 403 : 500); }
}
